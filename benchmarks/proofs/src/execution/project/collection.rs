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
}

impl MutationProgress {
    fn update(&mut self, progress: &Progress, total: usize, finished: bool) {
        if finished {
            self.completed += 1;
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
                "mutation: completed {}/{total}, running {}, remaining {}",
                self.completed,
                self.started - self.completed,
                total - self.started
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

impl CapturedProject {
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
        let mut state = if result["cancelled"] == true {
            TestState::Cancelled
        } else if matches!(kind, JobKind::Typecheck) {
            // A compiler's exit code is validation evidence, never a mutant kill.
            if result["timedOut"] == true {
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
                    if result["overflow"] == true || !result["pipeError"].is_null() {
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
                    if result["timedOut"] == true {
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
        progress.phase(format_args!(
            "mutation finished: completed {}/{}, running 0, not run {}, resolved {}, unresolved {}",
            completed,
            plan.len(),
            plan.len() - completed,
            resolved,
            plan.len() - resolved
        ));
        json!({"strategy":"replace","complete":complete,"planned":plan.len(),
            "killed":assessed.killed,"survived":assessed.survived,
            "score":if complete {assessed.score} else {None},"outcomes":outcomes,
            "jobsAttempted":jobs_attempted,"executionMs":started.elapsed().as_secs_f64()*1000.0,
            "workersRequested":self.config.workers,"workersUsed":workers_used,
            "workerBaselineJobs":baseline_jobs,"workerBaselines":worker_baselines,
            "workerPreparationMs":preparation_ms,"mutationWallMs":scheduling_ms,
            "workerCleanupMs":cleanup_ms,"completed":completed,"notRun":plan.len()-completed,"unresolved":plan.len()-resolved,
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
        let mut result = json!({"phase":match mode { AssessmentMode::Check=>"check",AssessmentMode::Crap=>"crap",AssessmentMode::Mutate=>"mutate" },"complete":complete,"jobsAttempted":commands_run,
            "sources":sources,"setups":setups,"phaseTimings":timings,"executionMs":started.elapsed().as_secs_f64()*1000.0});
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
}
