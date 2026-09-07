use super::*;
use crate::{
    assessment::{self, TestState},
    coverage,
    execution::{CommandEvidence, cancellation_signal, classify, job, observe_node_loads},
};
use std::{
    io::{Read, Write},
    os::unix::fs::MetadataExt,
    process::Command,
    sync::{
        Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

const REPORT_LIMIT: u64 = 32 * 1024 * 1024;

struct Progress {
    enabled: bool,
    started: Instant,
}

impl Progress {
    fn phase(&self, message: std::fmt::Arguments<'_>) {
        if self.enabled {
            let _ = writeln!(
                std::io::stderr().lock(),
                "seshat: {:.1}s {message}",
                self.started.elapsed().as_secs_f64()
            );
        }
    }
}

#[derive(Default)]
struct MutationProgress {
    started: usize,
    completed: usize,
    last_output: Option<Instant>,
    timed_out: usize,
    execution_errors: usize,
    cancelled: usize,
    not_run: usize,
}

impl MutationProgress {
    fn update(
        &mut self,
        progress: &Progress,
        total: usize,
        finished: bool,
        states: &[TestState],
        setup_count: usize,
    ) {
        if finished {
            self.completed += 1;
            if states
                .iter()
                .any(|state| *state == TestState::ExecutionError)
            {
                self.execution_errors += 1;
            } else if states.iter().any(|state| *state == TestState::Cancelled) {
                self.cancelled += 1;
            } else if states.iter().any(|state| *state == TestState::TimedOut) {
                self.timed_out += 1;
            } else if states.len() < setup_count
                || states.iter().any(|state| *state == TestState::NotRun)
            {
                self.not_run += 1;
            }
        } else {
            self.started += 1;
        }
        // Event-driven and capped at four updates/second; no polling thread or test changes.
        if self
            .last_output
            .is_none_or(|last| last.elapsed() >= Duration::from_millis(250))
            || self.completed == total
        {
            progress.phase(format_args!(
                "mutation: completed {}/{total}, running {}, remaining {}, unresolved timed-out {}, execution-error {}, cancelled {}, not-run {}",
                self.completed,
                self.started - self.completed,
                total - self.started,
                self.timed_out,
                self.execution_errors,
                self.cancelled,
                self.not_run
            ));
            self.last_output = Some(Instant::now());
        }
    }
}

struct MutantExecution {
    row: Value,
    states: Vec<TestState>,
    jobs: usize,
    restoration_error: Option<String>,
}

enum JobKind<'a> {
    Test,
    Coverage(&'a Path),
    Typecheck,
}

// Never follow an output link when removing stale evidence or reading new data.
fn regular_path(root: &Path, path: &Path, missing_ok: bool) -> Result<(), String> {
    let root_type = fs::symlink_metadata(root)
        .map_err(|e| e.to_string())?
        .file_type();
    if !root_type.is_dir() {
        return Err("captured root is no longer a real directory".into());
    }
    let relative = path
        .strip_prefix(root)
        .map_err(|_| "path escapes captured project")?;
    let mut current = root.to_path_buf();
    for component in relative.components() {
        if !matches!(component, std::path::Component::Normal(_)) {
            return Err("non-normal path in captured project".into());
        }
        current.push(component);
        match fs::symlink_metadata(&current) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() || (current != path && !metadata.is_dir()) {
                    return Err(format!("unsafe path: {}", relative.display()));
                }
                if current == path && (!metadata.is_file() || metadata.nlink() != 1) {
                    return Err(format!(
                        "expected independent regular file: {}",
                        relative.display()
                    ));
                }
            }
            Err(error) if missing_ok && error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(());
            }
            Err(error) => return Err(format!("{}: {error}", relative.display())),
        }
    }
    Ok(())
}

fn read_report(root: &Path, path: &Path) -> Result<Value, String> {
    regular_path(root, path, false)?;
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|e| e.to_string())?
        .take(REPORT_LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > REPORT_LIMIT {
        return Err("report exceeds the 32 MiB proof limit".into());
    }
    serde_json::from_slice(&bytes).map_err(|e| format!("invalid report JSON: {e}"))
}

fn per_second(count: usize, wall_ms: f64) -> Value {
    if wall_ms.is_finite() && wall_ms > 0.0 {
        json!(count as f64 / (wall_ms / 1000.0))
    } else {
        Value::Null
    }
}

fn unresolved_breakdown(outcomes: &[Value]) -> Value {
    let mut timed_out = 0;
    let mut execution_errors = 0;
    let mut cancelled = 0;
    let mut not_run = 0;
    let mut unassessed = 0;
    for outcome in outcomes {
        match outcome["verdict"].as_str() {
            Some("timed-out") => timed_out += 1,
            Some("execution-error") => execution_errors += 1,
            Some("cancelled") => cancelled += 1,
            Some("not-run") => not_run += 1,
            Some("unassessed") => unassessed += 1,
            _ => {}
        }
    }
    json!({"timedOut":timed_out,"executionError":execution_errors,
        "cancelled":cancelled,"notRun":not_run,"unassessed":unassessed})
}

fn slowest_executions(outcomes: &[Value]) -> Value {
    let mut rows: Vec<_> = outcomes
        .iter()
        .filter_map(|outcome| {
            Some((
                outcome["executionMs"].as_f64()?,
                json!({
                    "id":outcome["id"],"path":outcome["path"],
                    "executionMs":outcome["executionMs"],"verdict":outcome["verdict"]
                }),
            ))
        })
        .collect();
    rows.sort_by(|(left, _), (right, _)| right.total_cmp(left));
    json!(
        rows.into_iter()
            .take(5)
            .map(|(_, row)| row)
            .collect::<Vec<_>>()
    )
}

fn mutation_diagnostics(outcomes: &[Value], completed: usize, jobs: usize, wall_ms: f64) -> Value {
    let worker_time_ms: f64 = outcomes
        .iter()
        .filter_map(|outcome| outcome["executionMs"].as_f64())
        .sum();
    json!({
        "throughput": {
            "completedMutantsPerSecond": per_second(completed, wall_ms),
            "jobsPerSecond": per_second(jobs, wall_ms),
        },
        "workerTimeMs": worker_time_ms,
        "slowestExecutions": slowest_executions(outcomes),
        "unresolvedBreakdown": unresolved_breakdown(outcomes),
    })
}

fn exact_version(value: &str) -> bool {
    let parts: Vec<_> = value.split('.').collect();
    parts.len() == 3
        && parts
            .iter()
            .all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()))
}

fn version_comparison(actual: Option<&str>, expected: Option<&str>) -> &'static str {
    let (Some(actual), Some(expected)) = (actual, expected) else {
        return "unavailable";
    };
    if actual == expected {
        "match"
    } else if exact_version(expected) {
        "mismatch"
    } else {
        "not-comparable"
    }
}

fn json_file(root: &Path, path: &Path) -> Option<Value> {
    regular_path(root, path, false).ok()?;
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

fn nearest_json(root: &Path, cwd: &str, name: &str) -> Option<(PathBuf, Value)> {
    let mut directory = root.join(cwd);
    loop {
        let path = directory.join(name);
        if let Some(value) = json_file(root, &path) {
            return Some((directory, value));
        }
        if directory == root || !directory.pop() {
            return None;
        }
    }
}

fn declared_version<'a>(package: &'a Value, name: &str) -> Option<&'a str> {
    [
        "dependencies",
        "devDependencies",
        "optionalDependencies",
        "peerDependencies",
    ]
    .iter()
    .find_map(|section| package[*section][name].as_str())
}

fn locked_version(
    root: &Path,
    setup_cwd: &str,
    lock_directory: &Path,
    lock: &Value,
    name: &str,
) -> Option<String> {
    if let Some(version) = lock["dependencies"][name]["version"].as_str() {
        return Some(version.to_string());
    }
    let packages = lock["packages"].as_object()?;
    let setup = root.join(setup_cwd);
    let prefix = setup.strip_prefix(lock_directory).ok()?.to_str()?;
    let prefix = prefix.trim_matches('/');
    let prefix = if prefix == "." { "" } else { prefix };
    let mut keys = vec![format!("node_modules/{name}")];
    if !prefix.is_empty() {
        keys.insert(0, format!("{prefix}/node_modules/{name}"));
    }
    let versions: BTreeSet<_> = keys
        .iter()
        .filter_map(|key| packages.get(key)?.get("version")?.as_str())
        .collect();
    (versions.len() == 1).then(|| versions.into_iter().next().unwrap().to_string())
}

fn receipt_report<'a>(setup: &'a Value) -> Option<&'a Value> {
    ["baseline", "coverage"].iter().find_map(|key| {
        setup[*key]["report"]
            .as_object()
            .map(|_| &setup[*key]["report"])
    })
}

fn actual_version<'a>(report: Option<&'a Value>, runner: Runner, package: &str) -> Option<&'a str> {
    let report = report?;
    match (runner, package) {
        (Runner::Jest, "jest") => report["jest"].as_str(),
        (Runner::Jest, "jest-expo") => report["expo"].as_str(),
        (Runner::Vitest, "vitest") => report["vitest"].as_str(),
        _ => None,
    }
}

fn runner_packages(runner: Runner) -> &'static [&'static str] {
    match runner {
        Runner::Node => &[],
        Runner::Jest => &["jest", "jest-expo"],
        Runner::Vitest => &["vitest"],
    }
}

fn numeric_flag(args: &[String], name: &str) -> Option<Option<usize>> {
    let prefix = format!("{name}=");
    let mut found = false;
    let mut value = None;
    let mut conflict = false;
    for (index, arg) in args.iter().enumerate() {
        let parsed = if arg == name {
            Some(
                args.get(index + 1)
                    .and_then(|value| value.parse::<usize>().ok())
                    .filter(|value| *value > 0),
            )
        } else if let Some(raw) = arg.strip_prefix(&prefix) {
            Some(raw.parse::<usize>().ok().filter(|value| *value > 0))
        } else {
            None
        };
        if let Some(parsed) = parsed {
            if found && value != parsed {
                conflict = true;
            }
            found = true;
            value = parsed;
        }
    }
    if conflict {
        Some(None)
    } else {
        found.then_some(value)
    }
}

fn runner_invocation(runner: Runner, args: &[String]) -> bool {
    match runner {
        Runner::Node => args.iter().any(|arg| arg == "--test"),
        Runner::Jest => args
            .iter()
            .any(|arg| arg == "jest" || arg.ends_with("/jest") || arg.ends_with("/jest.js")),
        Runner::Vitest => args
            .iter()
            .any(|arg| arg == "vitest" || arg.ends_with("/vitest") || arg.ends_with("/vitest.mjs")),
    }
}

fn runner_concurrency(setup: &Setup, args: &[String], command: &str) -> Value {
    let (value, source) = if !runner_invocation(setup.runner.clone(), args) {
        (None, None)
    } else {
        match setup.runner {
            Runner::Node => (
                numeric_flag(args, "--test-concurrency"),
                Some("--test-concurrency"),
            ),
            Runner::Jest => {
                let in_band = args.iter().any(|arg| arg == "--runInBand" || arg == "-i");
                let max_workers = numeric_flag(args, "--maxWorkers");
                let value = match (in_band, max_workers) {
                    (true, None) => Some(Some(1)),
                    (true, Some(_)) => Some(None),
                    (false, value) => value,
                };
                (
                    value,
                    Some(if in_band {
                        "--runInBand"
                    } else {
                        "--maxWorkers"
                    }),
                )
            }
            Runner::Vitest => (
                numeric_flag(args, "--maxWorkers").or_else(|| numeric_flag(args, "--max-workers")),
                Some("--maxWorkers"),
            ),
        }
    };
    let effective = value.flatten();
    json!({"setup":setup.name,"runner":setup.runner.label(),"command":command,
        "effectiveWorkers":effective,"state":if effective.is_some() {"known"} else {"unavailable"},
        "source":if value.is_some() {source} else {None}})
}

impl CapturedProject {
    fn diagnostics(&self, setups: &[Value], mutation: Option<&Value>) -> Value {
        let mut runner_versions = Vec::new();
        let mut concurrency = Vec::new();
        for (config, result) in self.config.setups.iter().zip(setups) {
            let report = receipt_report(result);
            let package = nearest_json(&self.directory.0, &config.cwd, "package.json");
            let lock = nearest_json(&self.directory.0, &config.cwd, "package-lock.json");
            let node = report.and_then(|value| value["node"].as_str());
            let node_declared = package
                .as_ref()
                .and_then(|(_, value)| value["engines"]["node"].as_str());
            let packages = runner_packages(config.runner.clone())
                .iter()
                .map(|name| {
                    let actual = actual_version(report, config.runner.clone(), name);
                    let declared = package
                        .as_ref()
                        .and_then(|(_, value)| declared_version(value, name));
                    let locked = lock.as_ref().and_then(|(directory, value)| {
                        locked_version(&self.directory.0, &config.cwd, directory, value, name)
                    });
                    json!({"name":name,"actual":actual,"declared":declared,"locked":locked,
                        "declaredComparison":version_comparison(actual, declared),
                        "lockedComparison":version_comparison(actual, locked.as_deref())})
                })
                .collect::<Vec<_>>();
            runner_versions.push(json!({
                "setup":config.name,
                "runner":config.runner.label(),
                "runtime":{"node":node,"declared":node_declared,
                    "declaredComparison":version_comparison(node,node_declared)},
                "packages":packages,
            }));
            concurrency.push(runner_concurrency(config, &config.test, "test"));
            concurrency.push(runner_concurrency(
                config,
                &config.coverage.command,
                "coverage",
            ));
        }
        let (effective, state) = mutation
            .and_then(|value| value["workersUsed"].as_u64())
            .map_or((Value::Null, "not-requested"), |workers| {
                (json!(workers), "known")
            });
        json!({
            "runnerVersions":runner_versions,
            "concurrency":{
                "seshat":{"configuredWorkers":self.config.workers,
                    "effectiveWorkers":effective,"state":state},
                "runners":concurrency,
            }
        })
    }

    fn prepare_evidence(&self) -> Result<OwnedDirectory, String> {
        let evidence = OwnedDirectory::create(self.directory.0.parent().unwrap())?;
        for (name, content) in [
            (
                "node-reporter.mjs",
                include_str!("../../../node-reporter.mjs"),
            ),
            (
                "vitest-reporter.mjs",
                include_str!("../../../vitest-reporter.mjs"),
            ),
            (
                "vitest-runner.mjs",
                include_str!("../../../vitest-runner.mjs"),
            ),
            (
                "jest-reporter.cjs",
                include_str!("../../../jest-reporter.cjs"),
            ),
            (
                "jest-expo-environment.cjs",
                include_str!("../../../jest-expo-environment.cjs"),
            ),
        ] {
            fs::write(evidence.0.join(name), content).map_err(|e| e.to_string())?;
        }
        let paths: Vec<_> = self
            .sources
            .iter()
            .map(|(path, _)| self.directory.0.join(path))
            .collect();
        fs::write(
            evidence.0.join("sources.json"),
            serde_json::to_vec(&paths).unwrap(),
        )
        .map_err(|e| e.to_string())?;
        Ok(evidence)
    }

    fn unchanged(&self) -> Result<(), String> {
        for (index, (relative, original)) in self.sources.iter().enumerate() {
            let expected = match &self.active_edit {
                Some((active, source)) if *active == index => source,
                _ => original,
            };
            let path = self.directory.0.join(relative);
            regular_path(&self.directory.0, &path, false)?;
            if fs::read(&path).map_err(|e| e.to_string())? != expected.as_bytes() {
                return Err(format!(
                    "captured source changed during execution: {}",
                    relative.display()
                ));
            }
        }
        Ok(())
    }

    fn run_job(
        &self,
        setup: &Setup,
        args: &[String],
        evidence: &Path,
        id: &str,
        kind: JobKind<'_>,
    ) -> Result<CommandEvidence, String> {
        if cancellation_signal() != 0 {
            return Ok(CommandEvidence {
                state: TestState::Cancelled,
                details: json!({"cancelled":true}),
            });
        }
        self.unchanged()?;
        let cwd = fs::canonicalize(self.directory.0.join(&setup.cwd)).map_err(|e| e.to_string())?;
        if !cwd.starts_with(&self.directory.0) || !cwd.is_dir() {
            return Err("setup cwd escaped captured project".into());
        }
        let reporter = evidence.join(match setup.runner {
            Runner::Jest => "jest-reporter.cjs",
            Runner::Vitest => "vitest-reporter.mjs",
            Runner::Node => "node-reporter.mjs",
        });
        let receipt = evidence.join(format!("{id}.json"));
        let args: Vec<_> = args
            .iter()
            .map(|arg| {
                arg.replace("{seshatReporter}", reporter.to_str().unwrap())
                    .replace(
                        "{seshatEnvironment}",
                        evidence.join("jest-expo-environment.cjs").to_str().unwrap(),
                    )
            })
            .collect();
        let mut command = Command::new(&args[0]);
        command
            .args(&args[1..])
            .current_dir(&cwd)
            .env("PWD", &cwd)
            .env_remove("NODE_OPTIONS")
            .env_remove("NODE_PATH")
            .env_remove("SESHAT_MUTANT_ID")
            .env_remove("SESHAT_LOAD_CONTEXT")
            .env_remove("SESHAT_COVERAGE_REPORT")
            .env("SESHAT_EXECUTION_ID", id)
            .env("SESHAT_RECEIPT", &receipt)
            .env("SESHAT_NODE_REPORTER", &reporter)
            .env("SESHAT_VITEST_RUNNER", evidence.join("vitest-runner.mjs"))
            .env("SESHAT_SOURCES", evidence.join("sources.json"));
        if let JobKind::Coverage(path) = kind {
            command.env("SESHAT_COVERAGE_REPORT", path);
        }
        if matches!(setup.runner, Runner::Node) && !matches!(kind, JobKind::Typecheck) {
            // Keep the observer present in baseline, coverage and mutant processes.
            let (index, source) = self
                .active_edit
                .as_ref()
                .map(|(index, source)| (*index, source))
                .unwrap_or((0, &self.sources[0].1));
            observe_node_loads(
                &mut command,
                &self.directory.0.join(&self.sources[index].0),
                source,
                &receipt,
                id,
            )?;
        }
        let mut result = job::run(&mut command, Duration::from_millis(setup.timeout_ms))?;
        let mut state = if matches!(kind, JobKind::Typecheck) {
            // A compiler's exit code is validation evidence, never a mutant kill.
            if result["cancelled"] == true {
                TestState::Cancelled
            } else if result["timedOut"] == true {
                TestState::TimedOut
            } else if result["exit"] == 0
                && result["overflow"] == false
                && result["pipeError"].is_null()
            {
                TestState::Passed
            } else {
                TestState::ExecutionError
            }
        } else {
            match read_report(evidence, &receipt) {
                Ok(report)
                    if report["version"] == 1
                        && report["executionId"] == id
                        && report["node"] == "24.20.0"
                        && match setup.runner {
                            Runner::Node => report.get("runner").is_none(),
                            Runner::Jest => {
                                report["runner"] == "jest"
                                    && report["jest"] == "29.7.0"
                                    && report["expo"] == "57.0.5"
                            }
                            Runner::Vitest => {
                                report["runner"] == "vitest" && report["vitest"] == "5.0.0"
                            }
                        } =>
                {
                    result["report"] = report;
                    if result["cancelled"] == true {
                        TestState::Cancelled
                    } else if result["overflow"] == true || !result["pipeError"].is_null() {
                        TestState::ExecutionError
                    } else {
                        classify(
                            match setup.runner {
                                Runner::Node => "node",
                                _ => "observed",
                            },
                            &result,
                        )
                    }
                }
                other => {
                    result["evidenceError"] = json!(match other {
                    Err(error) => error,
                    Ok(_) => "runner receipt has wrong execution identity, format or unsupported runner version".into(),
                });
                    if result["cancelled"] == true {
                        TestState::Cancelled
                    } else if result["timedOut"] == true {
                        TestState::TimedOut
                    } else {
                        TestState::ExecutionError
                    }
                }
            }
        };
        if let Err(error) = self.unchanged() {
            state = TestState::ExecutionError;
            result["sourceError"] = json!(error);
        }
        // Keep successful runs compact and avoid printing ordinary test logs by default.
        if state == TestState::Passed {
            result.as_object_mut().unwrap().remove("diagnostic");
        }
        Ok(CommandEvidence {
            state,
            details: result,
        })
    }

    fn replace_source(&mut self, index: usize, replacement: Option<String>) -> Result<(), String> {
        let (relative, original) = &self.sources[index];
        let path = self.directory.0.join(relative);
        // Recheck before both mutation and restoration; a test may have replaced a path.
        regular_path(&self.directory.0, &path, false)?;
        fs::write(&path, replacement.as_deref().unwrap_or(original)).map_err(|e| e.to_string())?;
        self.active_edit = replacement.map(|source| (index, source));
        Ok(())
    }

    fn run_mutant(
        &mut self,
        analysis: &Analysis,
        source_index: usize,
        local_id: usize,
        evidence: &Path,
        mut row: Value,
    ) -> MutantExecution {
        let started = Instant::now();
        let prepared = self
            .unchanged()
            .and_then(|()| analysis.replace(&self.sources[source_index].1, local_id))
            .and_then(|source| self.replace_source(source_index, Some(source)));
        if let Err(error) = prepared {
            row["preparationError"] = json!(error);
            row["executionMs"] = json!(started.elapsed().as_secs_f64() * 1000.0);
            return MutantExecution {
                row,
                states: vec![TestState::ExecutionError; self.config.setups.len()],
                jobs: 0,
                restoration_error: None,
            };
        }
        let mut states = Vec::new();
        for (index, setup) in self.config.setups.iter().enumerate() {
            if cancellation_signal() != 0 {
                break;
            }
            let id = format!(
                "{}-mutant-{}-{index}",
                evidence.file_name().unwrap().to_str().unwrap(),
                row["id"]
            );
            let observed = self
                .run_job(setup, &setup.test, evidence, &id, JobKind::Test)
                .unwrap_or_else(CommandEvidence::error);
            states.push(observed.state);
            let mut setup_row = observed.into_json();
            setup_row["name"] = json!(setup.name);
            row["setups"][index] = setup_row;
        }
        // Restore after every outcome, but never follow a rewritten source link.
        let restoration_error = self
            .replace_source(source_index, None)
            .and_then(|()| self.unchanged())
            .err();
        row["executionMs"] = json!(started.elapsed().as_secs_f64() * 1000.0);
        MutantExecution {
            row,
            jobs: states.len(),
            states,
            restoration_error,
        }
    }

    fn mutate(
        &mut self,
        facts: &[Result<Analysis, String>],
        baselines: &[TestState],
        evidence: &Path,
        ready: bool,
        progress: &Progress,
    ) -> Value {
        let started = Instant::now();
        let mut plan = Vec::new();
        let mut outcomes = Vec::new();
        for (source_index, fact) in facts.iter().enumerate() {
            if let Ok(analysis) = fact {
                for definition in analysis.json()["mutants"].as_array().unwrap() {
                    let local_id = definition["id"].as_u64().unwrap() as usize;
                    let mut row = definition.clone();
                    row["id"] = json!(plan.len());
                    row["localId"] = json!(local_id);
                    row["path"] = json!(self.sources[source_index].0);
                    row["setups"] = json!(
                        self.config
                            .setups
                            .iter()
                            .map(|setup| json!({"name":setup.name,"state":"not-run"}))
                            .collect::<Vec<_>>()
                    );
                    outcomes.push(row);
                    plan.push((source_index, local_id));
                }
            }
        }
        let mut executions = vec![Vec::new(); plan.len()];
        let mut jobs_attempted = 0;
        let mut run_error = None;
        let worker_limit = self.config.workers.min(plan.len());
        progress.phase(format_args!(
            "worker preparation: {} mutant(s), {} worker(s) requested",
            plan.len(),
            self.config.workers
        ));
        let preparation_started = Instant::now();
        let mut workers = Vec::new();
        let mut worker_baselines = Vec::new();
        let mut baseline_jobs = 0;
        let mut worker_ready = ready;
        if ready {
            for worker_id in 1..worker_limit {
                progress.phase(format_args!("preparing worker {worker_id}"));
                let prepared = (|| {
                    self.unchanged()?;
                    let worker = self.copy_worker()?;
                    let receipts = worker.prepare_evidence()?;
                    Ok::<_, String>((worker, receipts))
                })();
                let (worker, receipts) = match prepared {
                    Ok(prepared) => prepared,
                    Err(error) => {
                        run_error = Some(error);
                        worker_ready = false;
                        break;
                    }
                };
                for (index, setup) in worker.config.setups.iter().enumerate() {
                    if cancellation_signal() != 0 {
                        worker_ready = false;
                        break;
                    }
                    let id = format!(
                        "{}-worker-{worker_id}-baseline-{index}",
                        receipts.0.file_name().unwrap().to_str().unwrap()
                    );
                    baseline_jobs += 1;
                    progress.phase(format_args!("worker {worker_id} baseline {:?}", setup.name));
                    let checked = worker
                        .run_job(setup, &setup.test, &receipts.0, &id, JobKind::Test)
                        .unwrap_or_else(CommandEvidence::error);
                    worker_ready &= checked.state == TestState::Passed;
                    let mut row = checked.into_json();
                    row["worker"] = json!(worker_id);
                    row["name"] = json!(setup.name);
                    worker_baselines.push(row);
                    if !worker_ready {
                        break;
                    }
                }
                workers.push((worker, receipts));
                if !worker_ready {
                    break;
                }
            }
        }
        let preparation_ms = preparation_started.elapsed().as_secs_f64() * 1000.0;
        let next = AtomicUsize::new(0);
        let stopped = AtomicBool::new(!worker_ready);
        let setup_count = self.config.setups.len();
        let workers_used = if worker_ready && cancellation_signal() == 0 {
            worker_limit
        } else {
            0
        };
        let scheduling_started = Instant::now();
        progress.phase(format_args!(
            "mutation: {} worker(s) used, {} planned",
            workers_used,
            plan.len()
        ));
        let live = Mutex::new(MutationProgress::default());
        if workers_used > 0 {
            let run_worker = |project: &mut CapturedProject, receipts: &Path| {
                let mut finished = Vec::new();
                while !stopped.load(Ordering::Relaxed) && cancellation_signal() == 0 {
                    let id = next.fetch_add(1, Ordering::Relaxed);
                    let Some(&(source_index, local_id)) = plan.get(id) else {
                        break;
                    };
                    if stopped.load(Ordering::Relaxed) || cancellation_signal() != 0 {
                        break;
                    }
                    if progress.enabled {
                        live.lock().unwrap_or_else(|e| e.into_inner()).update(
                            progress,
                            plan.len(),
                            false,
                            &[],
                            setup_count,
                        );
                    }
                    let result = project.run_mutant(
                        facts[source_index].as_ref().unwrap(),
                        source_index,
                        local_id,
                        receipts,
                        outcomes[id].clone(),
                    );
                    if progress.enabled {
                        live.lock().unwrap_or_else(|e| e.into_inner()).update(
                            progress,
                            plan.len(),
                            true,
                            &result.states,
                            setup_count,
                        );
                    }
                    if result.restoration_error.is_some()
                        || result
                            .states
                            .iter()
                            .any(|state| !matches!(state, TestState::Passed | TestState::Failed))
                    {
                        stopped.store(true, Ordering::Relaxed);
                    }
                    finished.push(result);
                }
                finished
            };
            let finished = thread::scope(|scope| {
                let mut handles = Vec::new();
                for (worker, receipts) in &mut workers {
                    let run_worker = &run_worker;
                    match thread::Builder::new()
                        .spawn_scoped(scope, move || run_worker(worker, &receipts.0))
                    {
                        Ok(handle) => handles.push(handle),
                        Err(error) => {
                            stopped.store(true, Ordering::Relaxed);
                            run_error = Some(format!("start worker: {error}"));
                            break;
                        }
                    }
                }
                let mut finished = run_worker(self, evidence);
                for handle in handles {
                    match handle.join() {
                        Ok(results) => finished.extend(results),
                        Err(_) => {
                            run_error = Some("mutation worker panicked".into());
                        }
                    }
                }
                finished
            });
            for result in finished {
                let id = result.row["id"].as_u64().unwrap() as usize;
                executions[id] = result.states;
                outcomes[id] = result.row;
                jobs_attempted += result.jobs;
                if let Some(error) = result.restoration_error {
                    outcomes[id]["restorationError"] = json!(error);
                    run_error = Some(error);
                }
            }
        }
        let scheduling_ms = scheduling_started.elapsed().as_secs_f64() * 1000.0;
        let cleanup_started = Instant::now();
        for (worker, receipts) in workers {
            for directory in [receipts, worker.directory] {
                if let Err(error) = directory.close() {
                    run_error = Some(error);
                }
            }
        }
        let cleanup_ms = cleanup_started.elapsed().as_secs_f64() * 1000.0;
        let assessed = assessment::mutation(baselines, plan.len(), &executions);
        for (row, verdict) in outcomes.iter_mut().zip(assessed.outcomes) {
            row["verdict"] = json!(verdict.label());
        }
        let complete =
            worker_ready && assessed.complete && run_error.is_none() && cancellation_signal() == 0;
        let restoration_error = outcomes.iter().find_map(|row| row.get("restorationError"));
        let completed = outcomes
            .iter()
            .filter(|row| row.get("executionMs").is_some())
            .count();
        let resolved = assessed.killed + assessed.survived;
        let diagnostics = mutation_diagnostics(&outcomes, completed, jobs_attempted, scheduling_ms);
        progress.phase(format_args!(
            "mutation finished: completed {}/{}, running 0, not run {}, resolved {}, unresolved {} (timed-out {}, execution-error {}, cancelled {}, not-run {}, unassessed {})",
            completed,
            plan.len(),
            plan.len() - completed,
            resolved,
            plan.len() - resolved,
            diagnostics["unresolvedBreakdown"]["timedOut"],
            diagnostics["unresolvedBreakdown"]["executionError"],
            diagnostics["unresolvedBreakdown"]["cancelled"],
            diagnostics["unresolvedBreakdown"]["notRun"],
            diagnostics["unresolvedBreakdown"]["unassessed"]
        ));
        json!({"strategy":"replace","complete":complete,"planned":plan.len(),
            "killed":assessed.killed,"survived":assessed.survived,
            "score":if complete {assessed.score} else {None},"outcomes":outcomes,
            "jobsAttempted":jobs_attempted,"executionMs":started.elapsed().as_secs_f64()*1000.0,
            "workersRequested":self.config.workers,"workersUsed":workers_used,
            "workerBaselineJobs":baseline_jobs,"workerBaselines":worker_baselines,
            "workerPreparationMs":preparation_ms,"mutationWallMs":scheduling_ms,
            "workerCleanupMs":cleanup_ms,"completed":completed,"notRun":plan.len()-completed,"unresolved":plan.len()-resolved,
            "diagnostics":diagnostics,
            "error":run_error,"restorationError":restoration_error})
    }

    pub fn collect(self, mutate: bool) -> Result<Value, String> {
        let mut result = self.assess(
            if mutate {
                AssessmentMode::Check
            } else {
                AssessmentMode::Crap
            },
            false,
        )?;
        if !mutate {
            result["phase"] = json!("collect");
        }
        Ok(result)
    }

    pub fn assess(mut self, mode: AssessmentMode, show_progress: bool) -> Result<Value, String> {
        let mutate = mode != AssessmentMode::Crap;
        let with_coverage = mode != AssessmentMode::Mutate;
        if mutate
            && self
                .config
                .setups
                .iter()
                .any(|setup| setup.typecheck.is_none())
        {
            return Err("check/mutate require an explicit typecheck command in every setup".into());
        }
        let started = Instant::now();
        let progress = Progress {
            enabled: show_progress,
            started,
        };
        progress.phase(format_args!(
            "analysis: {} source file(s)",
            self.sources.len()
        ));
        let facts: Vec<_> = self
            .sources
            .iter()
            .map(|(path, source)| Analysis::inspect(path.to_str().unwrap(), source))
            .collect();
        let mut timings = json!({"analysisMs":started.elapsed().as_secs_f64()*1000.0,
            "preparationMs":null,"typecheckMs":null,"baselineMs":null,"coverageMs":null,"attributionMs":null,"cleanupMs":null});
        let mut complete = facts.iter().all(Result::is_ok);
        progress.phase(format_args!("preparing runner evidence"));
        let preparation_started = Instant::now();
        let evidence = self.prepare_evidence()?;
        timings["preparationMs"] = json!(preparation_started.elapsed().as_secs_f64() * 1000.0);
        let mut setups: Vec<_> = self.config.setups.iter().map(|setup| json!({"name":setup.name,"typecheck":{"state":"not-run"},"baseline":{"state":"not-run"},"coverage":{"state":"not-run"}})).collect();
        if !with_coverage {
            for setup in &mut setups {
                setup["coverage"]["state"] = json!("not-requested");
            }
        }
        for setup in &mut setups {
            setup["timings"] = json!({"typecheckMs":null,"baselineMs":null,"coverageMs":null});
        }
        let mut baselines = vec![TestState::NotRun; setups.len()];
        let mut reports = Vec::new();
        let mut commands_run = 0;
        for (index, setup) in self.config.setups.iter().enumerate() {
            if cancellation_signal() != 0 {
                complete = false;
            }
            if !complete {
                break;
            }
            if let Some(args) = &setup.typecheck {
                progress.phase(format_args!("typecheck {:?}", setup.name));
                let phase_started = Instant::now();
                let id = format!(
                    "{}-{index}-typecheck",
                    evidence.0.file_name().unwrap().to_str().unwrap()
                );
                commands_run += 1;
                let checked = self
                    .run_job(setup, args, &evidence.0, &id, JobKind::Typecheck)
                    .unwrap_or_else(CommandEvidence::error);
                complete = checked.state == TestState::Passed;
                setups[index]["typecheck"] = checked.into_json();
                setups[index]["timings"]["typecheckMs"] =
                    json!(phase_started.elapsed().as_secs_f64() * 1000.0);
                if !complete {
                    break;
                }
            }
            let run = || -> Result<CommandEvidence, String> {
                let id = format!(
                    "{}-{index}-baseline",
                    evidence.0.file_name().unwrap().to_str().unwrap()
                );
                self.run_job(setup, &setup.test, &evidence.0, &id, JobKind::Test)
            };
            commands_run += 1;
            progress.phase(format_args!("baseline {:?}", setup.name));
            let phase_started = Instant::now();
            let baseline = run().unwrap_or_else(CommandEvidence::error);
            setups[index]["timings"]["baselineMs"] =
                json!(phase_started.elapsed().as_secs_f64() * 1000.0);
            baselines[index] = baseline.state;
            setups[index]["baseline"] = baseline.into_json();
            if setups[index]["baseline"]["state"] != "passed" {
                complete = false;
                break;
            }
            if !with_coverage {
                continue;
            }
            let collect = || -> Result<(Value, Value), String> {
                let cwd = fs::canonicalize(self.directory.0.join(&setup.cwd))
                    .map_err(|e| e.to_string())?;
                let path = cwd.join(&setup.coverage.report);
                regular_path(&self.directory.0, &path, true)?;
                if self
                    .sources
                    .iter()
                    .any(|(source, _)| self.directory.0.join(source) == path)
                {
                    return Err("coverage report destination is assessment source".into());
                }
                // Only discard the configured output inside our copy, never in the checkout.
                if path.exists() {
                    fs::remove_file(&path).map_err(|e| e.to_string())?;
                }
                let id = format!(
                    "{}-{index}-coverage",
                    evidence.0.file_name().unwrap().to_str().unwrap()
                );
                let mut result = self
                    .run_job(
                        setup,
                        &setup.coverage.command,
                        &evidence.0,
                        &id,
                        JobKind::Coverage(&path),
                    )?
                    .into_json();
                if result["state"] != "passed" {
                    return Ok((result, Value::Null));
                }
                let validated = || -> Result<Value, String> {
                    let report = read_report(&self.directory.0, &path)?;
                    let entries = report
                        .as_object()
                        .ok_or("coverage report must be an Istanbul file map")?;
                    for (name, file) in entries {
                        if !Path::new(name).starts_with(&self.directory.0) || file["path"] != *name
                        {
                            return Err("coverage contains a path outside the captured project or a mismatched file identity".into());
                        }
                        regular_path(&self.directory.0, Path::new(name), false)?;
                    }
                    Ok(report)
                };
                match validated() {
                    Ok(report) => Ok((result, report)),
                    Err(error) => {
                        result["state"] = json!("execution-error");
                        result["coverageError"] = json!(error);
                        Ok((result, Value::Null))
                    }
                }
            };
            commands_run += 1;
            progress.phase(format_args!("coverage {:?}", setup.name));
            let phase_started = Instant::now();
            match collect() {
                Ok((result, report)) => {
                    complete = result["state"] == "passed";
                    setups[index]["coverage"] = result;
                    if complete {
                        reports.push(report);
                    }
                }
                Err(error) => {
                    complete = false;
                    setups[index]["coverage"] = json!({"state":"execution-error","error":error});
                }
            }
            setups[index]["timings"]["coverageMs"] =
                json!(phase_started.elapsed().as_secs_f64() * 1000.0);
        }
        for key in ["typecheckMs", "baselineMs", "coverageMs"] {
            let measured = setups
                .iter()
                .filter_map(|setup| setup["timings"][key].as_f64())
                .reduce(|sum, ms| sum + ms);
            timings[key] = json!(measured);
        }
        if with_coverage {
            progress.phase(format_args!("coverage attribution"));
        }
        let attribution_started = Instant::now();
        let sources: Vec<_> = self
            .sources
            .iter()
            .zip(&facts)
            .map(|((relative, source), analysis)| {
                let path = self.directory.0.join(relative);
                match analysis {
                    Err(error) => json!({"path":relative,"error":error}),
                    Ok(_) if !with_coverage => json!({"path":relative}),
                    Ok(analysis) => {
                        // A setup may cover a different package. Merge only its entries for this file;
                        // failed collection still makes the whole run incomplete above.
                        let applicable = reports
                            .iter()
                            .filter(|report| report.get(path.to_str().unwrap()).is_some());
                        let measured = coverage::attribute(
                            analysis,
                            path.to_str().unwrap(),
                            source,
                            applicable,
                        );
                        if measured["complete"] != true {
                            complete = false;
                        }
                        json!({"path":relative,"result":measured})
                    }
                }
            })
            .collect();
        if with_coverage {
            timings["attributionMs"] = json!(attribution_started.elapsed().as_secs_f64() * 1000.0);
        }
        let mutation = if mutate {
            let measured = self.mutate(&facts, &baselines, &evidence.0, complete, &progress);
            complete &= measured["complete"] == true;
            commands_run += measured["jobsAttempted"].as_u64().unwrap();
            commands_run += measured["workerBaselineJobs"].as_u64().unwrap();
            Some(measured)
        } else {
            None
        };
        let diagnostics = self.diagnostics(&setups, mutation.as_ref());
        let mut result = json!({"phase":match mode { AssessmentMode::Check=>"check",AssessmentMode::Crap=>"crap",AssessmentMode::Mutate=>"mutate" },"complete":complete,"jobsAttempted":commands_run,
            "sources":sources,"setups":setups,"phaseTimings":timings,
            "diagnostics":diagnostics,"executionMs":started.elapsed().as_secs_f64()*1000.0});
        if let Some(mutation) = mutation {
            result["mutation"] = mutation;
        }
        progress.phase(format_args!("cleanup"));
        let cleanup_started = Instant::now();
        for directory in [evidence, self.directory] {
            if let Err(error) = directory.close() {
                result["complete"] = json!(false);
                result["cleanupError"] = json!(error);
                if mutate {
                    result["mutation"]["complete"] = json!(false);
                    result["mutation"]["score"] = Value::Null;
                }
            }
        }
        result["phaseTimings"]["cleanupMs"] =
            json!(cleanup_started.elapsed().as_secs_f64() * 1000.0);
        progress.phase(format_args!(
            "assessment finished: complete={}",
            result["complete"]
        ));
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn report_paths_reject_links_before_removal_or_reading() {
        let directory = OwnedDirectory::create(&std::env::temp_dir()).unwrap();
        let root = &directory.0;
        fs::write(root.join("original.json"), "{}").unwrap();
        fs::create_dir(root.join("reports")).unwrap();
        symlink("original.json", root.join("linked.json")).unwrap();
        symlink("reports", root.join("linked-parent")).unwrap();
        fs::hard_link(root.join("original.json"), root.join("hard.json")).unwrap();
        for relative in [
            "linked.json",
            "linked-parent/missing.json",
            "hard.json",
            "../outside.json",
        ] {
            for missing_ok in [true, false] {
                assert!(regular_path(root, &root.join(relative), missing_ok).is_err());
            }
        }
        assert!(regular_path(root, &root.join("reports/new.json"), true).is_ok());
        assert_eq!(
            fs::read_to_string(root.join("original.json")).unwrap(),
            "{}"
        );
        directory.close().unwrap();
    }

    #[test]
    fn diagnostics_keep_ranges_unknown_and_incomplete_work_distinct() {
        assert_eq!(version_comparison(Some("29.7.0"), Some("29.7.0")), "match");
        assert_eq!(
            version_comparison(Some("29.8.0"), Some("29.7.0")),
            "mismatch"
        );
        assert_eq!(
            version_comparison(Some("29.8.0"), Some("^29.7.0")),
            "not-comparable"
        );
        assert_eq!(version_comparison(None, Some("29.7.0")), "unavailable");

        let mut setup = Setup {
            name: "unit".into(),
            runner: Runner::Jest,
            cwd: ".".into(),
            test: vec!["node".into(), "jest".into(), "--runInBand".into()],
            typecheck: None,
            coverage: CoverageCommand {
                command: vec!["node".into(), "coverage.mjs".into()],
                report: "coverage.json".into(),
            },
            timeout_ms: 1000,
        };
        assert_eq!(
            runner_concurrency(&setup, &setup.test, "test")["effectiveWorkers"],
            1
        );
        setup.test.push("--maxWorkers=1".into());
        assert_eq!(
            runner_concurrency(&setup, &setup.test, "test")["state"],
            "unavailable"
        );
        setup.test.pop();
        assert_eq!(
            runner_concurrency(&setup, &setup.coverage.command, "coverage")["state"],
            "unavailable"
        );
        setup.test = vec![
            "node".into(),
            "node_modules/jest/bin/jest.js".into(),
            "--maxWorkers=1".into(),
            "--maxWorkers=2".into(),
        ];
        assert_eq!(
            runner_concurrency(&setup, &setup.test, "test")["state"],
            "unavailable"
        );
        setup.test = vec!["npm".into(), "test".into()];
        assert_eq!(
            runner_concurrency(&setup, &setup.test, "test")["state"],
            "unavailable"
        );

        let outcomes = vec![
            json!({"id":0,"path":"a.ts","executionMs":20.0,"verdict":"cancelled"}),
            json!({"id":1,"path":"a.ts","executionMs":5.0,"verdict":"not-run"}),
            json!({"id":2,"path":"a.ts","executionMs":10.0,"verdict":"killed"}),
        ];
        let diagnostics = mutation_diagnostics(&outcomes, 3, 4, 100.0);
        assert_eq!(diagnostics["unresolvedBreakdown"]["cancelled"], 1);
        assert_eq!(diagnostics["unresolvedBreakdown"]["notRun"], 1);
        assert_eq!(diagnostics["slowestExecutions"][0]["id"], 0);
        assert_eq!(diagnostics["throughput"]["completedMutantsPerSecond"], 30.0);
        assert_eq!(diagnostics["workerTimeMs"], 35.0);
    }
}
