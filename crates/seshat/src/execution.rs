// Platform process supervision for controlled, disposable proof fixtures.
mod files;
mod job;
mod platform;
mod project;
use crate::{analysis::Analysis, assessment};
use assessment::TestState;
use files::RegularFile;
use percent_encoding::{AsciiSet, CONTROLS, percent_encode};
pub use project::{AssessmentMode, CapturedProject, Thresholds};
use serde_json::{Value, json};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        Arc, OnceLock,
        atomic::{AtomicUsize, Ordering},
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[cfg(unix)]
use std::os::unix::fs::DirBuilderExt;

fn epoch_nanos(now: SystemTime) -> Result<u128, String> {
    now.duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .map_err(|error| format!("system clock precedes Unix epoch: {error}"))
}

fn validate_command(args: &[String], label: &str) -> Result<(), String> {
    if args.first().is_none_or(|arg| arg.trim().is_empty())
        || args.iter().any(|arg| arg.contains('\0'))
    {
        return Err(format!(
            "{label} must be a non-empty argument array without NUL characters"
        ));
    }
    if ["{seshatReporter}", "{seshatEnvironment}"]
        .iter()
        .any(|placeholder| args[0].contains(placeholder))
    {
        return Err(format!(
            "{label} placeholders belong in arguments, not the program"
        ));
    }
    Ok(())
}

fn proof_command(config: &Value, key: &str) -> Result<Vec<String>, String> {
    let args: Vec<String> = serde_json::from_value(config[key].clone())
        .map_err(|_| format!("{key} must be an array of strings"))?;
    validate_command(&args, key)?;
    Ok(args)
}

fn read_json_report(path: &Path) -> Result<Value, String> {
    const REPORT_LIMIT: u64 = 32 * 1024 * 1024;
    let bytes = RegularFile::open(path, false)?.read(REPORT_LIMIT + 1)?;
    if bytes.len() as u64 > REPORT_LIMIT {
        return Err("report exceeds the 32 MiB proof limit".into());
    }
    serde_json::from_slice(&bytes).map_err(|e| format!("invalid report JSON: {e}"))
}

// ponytail: one CLI run per process; pass cancellation explicitly if this becomes a library.
static CANCEL_SIGNAL: OnceLock<Arc<AtomicUsize>> = OnceLock::new();

fn stable_path(path: &Path) -> Result<String, String> {
    project::validate_path(path)?;
    let value = path.to_str().unwrap();
    #[cfg(windows)]
    {
        return Ok(value.replace('\\', "/"));
    }
    #[cfg(not(windows))]
    {
        Ok(value.to_owned())
    }
}

const FILE_URL_SEGMENT: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'"')
    .add(b'#')
    .add(b'%')
    .add(b'<')
    .add(b'>')
    .add(b'?')
    .add(b'[')
    .add(b']')
    .add(b'`')
    .add(b'{')
    .add(b'}');

fn encode_file_url_path(path: &str) -> String {
    path.split('/')
        .map(|part| percent_encode(part.as_bytes(), FILE_URL_SEGMENT).to_string())
        .collect::<Vec<_>>()
        .join("/")
}

// Node's inherited --import option is resolved from every descendant's cwd. A file URL keeps
// that preload independent of cwd and lets the URL encoder handle spaces, Unicode and '#'.
fn module_file_url(path: &Path) -> Result<String, String> {
    let value = path.to_str().ok_or("module path is not valid UTF-8")?;
    if !path.is_absolute() {
        return Err("module paths must be absolute".into());
    }
    #[cfg(windows)]
    {
        let value = if let Some(rest) = value.strip_prefix("\\\\?\\UNC\\") {
            format!("\\\\{rest}")
        } else {
            value.strip_prefix("\\\\?\\").unwrap_or(value).to_owned()
        };
        let value = value.replace('\\', "/");
        if value.starts_with("//") {
            return Ok(format!("file:{}", encode_file_url_path(&value)));
        }
        if value.as_bytes().get(1) == Some(&b':') && value.as_bytes().get(2) == Some(&b'/') {
            return Ok(format!("file:///{}", encode_file_url_path(&value)));
        }
        return Err("module path is not a supported Windows absolute path".into());
    }
    #[cfg(not(windows))]
    {
        Ok(format!("file://{}", encode_file_url_path(value)))
    }
}

// Jest and Vitest accept absolute filesystem references, but Windows' verbatim prefix is a Node
// package specifier rather than a filesystem path. Keep each runner's resolver base intact.
fn module_path(path: &Path) -> Result<String, String> {
    if !path.is_absolute() {
        return Err("module paths must be absolute".into());
    }
    let value = path.to_str().ok_or("module path is not valid UTF-8")?;
    #[cfg(windows)]
    {
        if let Some(rest) = value.strip_prefix("\\\\?\\UNC\\") {
            return Ok(format!("\\\\{rest}"));
        }
        return Ok(value.strip_prefix("\\\\?\\").unwrap_or(value).to_owned());
    }
    #[cfg(not(windows))]
    {
        Ok(value.to_owned())
    }
}

pub fn install_cancellation() -> Result<(), String> {
    let flag = CANCEL_SIGNAL.get_or_init(|| Arc::new(AtomicUsize::new(0)));
    platform::install_cancellation(flag.clone())
}

pub fn cancellation_signal() -> usize {
    CANCEL_SIGNAL
        .get()
        .map_or(0, |flag| flag.load(Ordering::Relaxed))
}

fn check_cancellation() -> Result<(), String> {
    if cancellation_signal() != 0 {
        Err("cancelled".into())
    } else {
        Ok(())
    }
}

pub struct Session {
    root: PathBuf,
    config: Value,
    source: String,
    source_path: PathBuf,
}

struct CommandEvidence {
    state: TestState,
    details: Value,
}

fn observe_node_loads(
    command: &mut Command,
    sources: &[(&Path, &str)],
    receipt: &Path,
    id: &str,
) -> Result<[PathBuf; 2], String> {
    if sources.is_empty() {
        return Err("load evidence requires at least one source".into());
    }
    let directory = receipt.parent().unwrap();
    if !fs::symlink_metadata(directory)
        .map_err(|e| e.to_string())?
        .is_dir()
    {
        return Err("load evidence directory is no longer a real directory".into());
    }
    let observer = directory.join(format!("node-load-{id}.mjs"));
    let context_path = directory.join(format!("node-load-{id}.json"));
    let source_contexts = sources
        .iter()
        .map(|(source_path, source)| {
            let source_path = stable_path(source_path)?;
            let analysis = Analysis::inspect(&source_path, source)?;
            Ok::<_, String>(json!({
                "source":source_path,
                "sites":analysis.load_failure_sites(source),
            }))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let context = if let [source_context] = source_contexts.as_slice() {
        json!({"version":1,"executionId":id,"source":source_context["source"],"sites":source_context["sites"]})
    } else {
        json!({"version":1,"executionId":id,"sources":source_contexts})
    };
    for (path, bytes) in [
        (
            &observer,
            include_str!("../../../benchmarks/proofs/node-load-observer.mjs")
                .as_bytes()
                .to_vec(),
        ),
        (&context_path, serde_json::to_vec(&context).unwrap()),
    ] {
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .and_then(|mut file| file.write_all(&bytes))
            .map_err(|e| e.to_string())?;
    }
    command
        .env(
            "NODE_OPTIONS",
            format!("--import={}", module_file_url(&observer)?),
        )
        .env("SESHAT_LOAD_CONTEXT", &context_path)
        .env("SESHAT_EXECUTION_ID", id);
    Ok([observer, context_path])
}

impl CommandEvidence {
    fn clear_job_artifacts(&mut self, receipt: &Path, observer: Option<&[PathBuf; 2]>) {
        // Unconfirmed process cleanup means a reporter may still need these files.
        if !self.details["cleanupError"].is_null() {
            return;
        }
        let remove = || -> Result<(), String> {
            let name = receipt.file_name().unwrap().to_str().unwrap();
            let load_prefix = format!("{name}.load-");
            let event_prefix = format!("{name}.events-");
            for entry in fs::read_dir(receipt.parent().unwrap()).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                let path = entry.path();
                let sidecar = entry.file_name().to_str().is_some_and(|name| {
                    name.starts_with(&load_prefix) || name.starts_with(&event_prefix)
                });
                if path == receipt || observer.is_some_and(|paths| paths.contains(&path)) || sidecar
                {
                    match fs::remove_file(&path) {
                        Ok(()) => {}
                        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                        Err(error) => return Err(format!("{}: {error}", path.display())),
                    }
                }
            }
            Ok(())
        };
        if let Err(error) = remove() {
            self.details["cleanupError"] = json!(format!("job artifacts: {error}"));
            if matches!(self.state, TestState::Passed | TestState::Failed) {
                self.state = TestState::ExecutionError;
            }
        }
    }

    fn error(error: String) -> Self {
        Self {
            state: TestState::ExecutionError,
            details: json!({"error":error}),
        }
    }

    fn into_json(mut self) -> Value {
        self.details["state"] = json!(self.state.label());
        self.details
    }
}

impl Session {
    pub fn capture(config: Value) -> Result<Self, String> {
        check_cancellation()?;
        if !matches!(
            config["runner"].as_str(),
            Some("node" | "observed" | "jest" | "vitest")
        ) {
            return Err("runner must be node, observed, jest or vitest".into());
        }
        for key in ["test", "build", "typecheck"] {
            if key == "test" || config.get(key).is_some() {
                proof_command(&config, key)?;
            }
        }
        if let Some(timeout) = config.get("timeoutMs") {
            if timeout.as_u64().is_none_or(|value| value == 0) {
                return Err("timeoutMs must be a positive integer".into());
            }
        }
        if let Some(limit) = config.get("limit") {
            if limit
                .as_u64()
                .and_then(|value| usize::try_from(value).ok())
                .is_none()
            {
                return Err("limit must be a non-negative integer that fits this platform".into());
            }
        }
        if config.get("scenario").is_some_and(|value| {
            value
                .as_str()
                .is_none_or(|scenario| scenario.contains('\0'))
        }) {
            return Err("scenario must be a string without NUL characters".into());
        }
        for key in ["template", "scratch"] {
            if config[key]
                .as_str()
                .is_none_or(|path| path.is_empty() || path.contains('\0'))
            {
                return Err(format!(
                    "{key} must be a non-empty path without NUL characters"
                ));
            }
        }
        let template = fs::canonicalize(config["template"].as_str().ok_or("missing template")?)
            .map_err(|e| e.to_string())?;
        let parent = fs::canonicalize(config["scratch"].as_str().ok_or("missing scratch")?)
            .map_err(|e| e.to_string())?;
        let source_file = match config.get("source") {
            None => "subject.tsx",
            Some(value) => match value.as_str() {
                Some("subject.ts") => "subject.ts",
                Some("subject.tsx") => "subject.tsx",
                _ => return Err("proof source must be subject.ts or subject.tsx".into()),
            },
        };
        let stamp = epoch_nanos(SystemTime::now())?;
        let root = parent.join(format!("session-{}-{stamp}", std::process::id()));
        let builder = fs::DirBuilder::new();
        #[cfg(unix)]
        let builder = {
            let mut builder = builder;
            builder.mode(0o700);
            builder
        };
        builder.create(&root).map_err(|e| e.to_string())?;
        let mut session = Self {
            source_path: root.join(source_file),
            root,
            config: config.clone(),
            source: String::new(),
        };
        for entry in fs::read_dir(template).map_err(|e| e.to_string())? {
            check_cancellation()?;
            let entry = entry.map_err(|e| e.to_string())?;
            if !entry.file_type().map_err(|e| e.to_string())?.is_file() {
                return Err("proof template must contain only regular files".into());
            }
            RegularFile::open(&entry.path(), false)?
                .copy_to(&session.root.join(entry.file_name()))?;
        }
        session.source =
            String::from_utf8(RegularFile::open(&session.source_path, false)?.read(u64::MAX)?)
                .map_err(|e| e.to_string())?;
        Ok(session)
    }

    fn command(&self, key: &str, id: Option<usize>) -> Result<CommandEvidence, String> {
        if cancellation_signal() != 0 {
            return Ok(CommandEvidence {
                state: TestState::Cancelled,
                details: json!({"cancelled":true,"exit":null,"ms":0}),
            });
        }
        // Direct-loading runners have no separate build process.
        if key == "build" && self.config.get(key).is_none() {
            return Ok(CommandEvidence {
                state: TestState::Passed,
                details: json!({"skipped":true,"ms":0}),
            });
        }
        // Commands append paths such as @ROOT@/check.cjs; Node rejects that
        // mixed separator form after a Windows verbatim prefix.
        let root = module_path(&self.root)?;
        let args: Vec<_> = proof_command(&self.config, key)?
            .iter()
            .map(|arg| arg.replace("@ROOT@", &root))
            .collect();
        let (program, args) = args.split_first().ok_or("empty command")?;
        let receipt = self.root.join("receipt.json");
        if receipt.exists() {
            fs::remove_file(&receipt).map_err(|e| e.to_string())?;
        }
        let mut command = Command::new(program);
        command
            .args(args)
            .current_dir(&self.root)
            .env_remove("NODE_OPTIONS")
            .env_remove("NODE_PATH")
            .env(
                "SESHAT_MUTANT_ID",
                id.map(|n| n.to_string()).unwrap_or_else(|| "-1".into()),
            )
            .env("SESHAT_RECEIPT", &receipt)
            .env(
                "SESHAT_PROOF_SCENARIO",
                self.config["scenario"].as_str().unwrap_or("normal"),
            );
        let observer = if key == "test" && self.config["runner"] == "node" {
            let source =
                String::from_utf8(RegularFile::open(&self.source_path, false)?.read(u64::MAX)?)
                    .map_err(|e| e.to_string())?;
            let id = format!("{}-{}", std::process::id(), epoch_nanos(SystemTime::now())?);
            let sources = [(self.source_path.as_path(), source.as_str())];
            Some(observe_node_loads(&mut command, &sources, &receipt, &id)?)
        } else {
            None
        };
        let timeout = Duration::from_millis(self.config["timeoutMs"].as_u64().unwrap_or(10000));
        let mut evidence = job::run(&mut command, timeout)?;
        evidence["report"] = Value::Null;
        if evidence["cancelled"] != true && (key == "test" || receipt.exists()) {
            match read_json_report(&receipt) {
                Ok(report) => evidence["report"] = report,
                Err(error) => evidence["evidenceError"] = json!(error),
            }
        }
        let state = if evidence["cancelled"] == true {
            TestState::Cancelled
        } else if key != "test" {
            if evidence["exit"] == 0
                && evidence["timedOut"] != true
                && evidence["overflow"] != true
                && evidence["pipeError"].is_null()
                && evidence["error"].is_null()
                && evidence["cleanupError"].is_null()
                && evidence["evidenceError"].is_null()
            {
                TestState::Passed
            } else {
                TestState::ExecutionError
            }
        } else {
            classify(self.config["runner"].as_str().unwrap(), &evidence)
        };
        let mut outcome = CommandEvidence {
            state,
            details: evidence,
        };
        outcome.clear_job_artifacts(&receipt, observer.as_ref());
        Ok(outcome)
    }

    pub fn execute(self, strategy: &str) -> Result<Value, String> {
        if !matches!(strategy, "switch" | "replace") {
            return Err("unknown execution strategy".into());
        }
        let analysis = Analysis::inspect(self.source_path.to_str().unwrap(), &self.source)?;
        let started = Instant::now();
        let typecheck = if self.config.get("typecheck").is_some() {
            let check = self.command("typecheck", None)?;
            if check.state != TestState::Passed {
                return Ok(
                    json!({"complete":false,"phase":"original-typecheck","evidence":check.into_json()}),
                );
            }
            Some(check.into_json())
        } else {
            None
        };
        let build = self.command("build", None)?;
        if build.state != TestState::Passed {
            return Ok(
                json!({"complete":false,"phase":"original-build","evidence":build.into_json()}),
            );
        }
        let baseline = self.command("test", None)?;
        if baseline.state != TestState::Passed {
            return Ok(
                json!({"complete":false,"phase":"original-baseline","evidence":baseline.into_json()}),
            );
        }
        let mut builds = usize::from(build.details["skipped"] != true);
        let mut prepared_baseline = None;
        if strategy == "switch" {
            RegularFile::open(&self.source_path, true)?
                .write(analysis.switched(&self.source)?.as_bytes())?;
            let prepared = self.command("build", None)?;
            builds += usize::from(prepared.details["skipped"] != true);
            if prepared.state != TestState::Passed {
                return Ok(
                    json!({"complete":false,"phase":"prepared-build","evidence":prepared.into_json()}),
                );
            }
            let baseline = self.command("test", None)?;
            if baseline.state != TestState::Passed {
                return Ok(
                    json!({"complete":false,"phase":"prepared-baseline","evidence":baseline.into_json()}),
                );
            }
            prepared_baseline = Some(baseline.into_json());
        }
        let mut executions = Vec::new();
        let mut evidence = Vec::new();
        let execution_start = Instant::now();
        let count = self.config["limit"]
            .as_u64()
            .map(|n| n as usize)
            .unwrap_or(analysis.count())
            .min(analysis.count());
        for id in 0..count {
            if cancellation_signal() != 0 {
                break;
            }
            if strategy == "replace" {
                RegularFile::open(&self.source_path, true)?
                    .write(analysis.replace(&self.source, id)?.as_bytes())?;
                let build = self.command("build", Some(id))?;
                builds += usize::from(build.details["skipped"] != true);
                if build.state != TestState::Passed {
                    executions.push(vec![build.state]);
                    let cleanup_failed = !build.details["cleanupError"].is_null();
                    evidence.push(build.into_json());
                    if cleanup_failed {
                        break;
                    }
                    continue;
                }
            }
            let test = self.command("test", Some(id))?;
            executions.push(vec![test.state]);
            let cleanup_failed = !test.details["cleanupError"].is_null();
            evidence.push(test.into_json());
            if cleanup_failed {
                break;
            }
        }
        let assessed = assessment::mutation(&[baseline.state], count, &executions);
        let outcomes: Vec<_> = assessed.outcomes.iter().enumerate()
            .map(|(id, verdict)| json!({"id":id,"verdict":verdict.label(),"evidence":evidence.get(id)}))
            .collect();
        let mut result = json!({"complete":assessed.complete,"killed":assessed.killed,
            "survived":assessed.survived,"score":assessed.score,"outcomes":outcomes});
        result["executionMs"] = json!(execution_start.elapsed().as_secs_f64() * 1000.0);
        result["totalMs"] = json!(started.elapsed().as_secs_f64() * 1000.0);
        result["builds"] = json!(builds);
        result["baseline"] = baseline.into_json();
        result["preparedBaseline"] = json!(prepared_baseline);
        result["typecheck"] = json!(typecheck);
        result["strategy"] = json!(strategy);
        result["runner"] = self.config["runner"].clone();
        Ok(result)
    }
}

fn classify(runner: &str, evidence: &Value) -> TestState {
    if evidence["cancelled"] == true {
        return TestState::Cancelled;
    }
    // ponytail: legacy Jest/Vitest use single-test totals; captured jobs require observed receipts.
    if evidence["timedOut"] == true {
        return TestState::TimedOut;
    }
    if evidence["overflow"] == true
        || !evidence["pipeError"].is_null()
        || !evidence["error"].is_null()
        || !evidence["cleanupError"].is_null()
    {
        return TestState::ExecutionError;
    }
    let report = &evidence["report"];
    let (passed, failed, errors) = if matches!(runner, "node" | "observed") {
        if report["complete"] != true {
            return TestState::ExecutionError;
        }
        if runner == "observed" {
            match report["timeouts"].as_u64() {
                Some(0) => {}
                Some(_) => return TestState::TimedOut,
                None => return TestState::ExecutionError,
            }
        }
        (
            report["passed"].as_u64(),
            report["failed"].as_u64(),
            report["errors"].as_u64(),
        )
    } else {
        let failed = report["numFailedTests"].as_u64();
        let suites = report["numFailedTestSuites"].as_u64();
        (
            report["numPassedTests"].as_u64(),
            failed,
            suites.map(|n| if failed == Some(0) { n } else { 0 }),
        )
    };
    match (passed, failed, errors, evidence["exit"].as_i64()) {
        (Some(p), Some(0), Some(0), Some(0)) if p > 0 => TestState::Passed,
        (Some(_), Some(f), Some(0), Some(1)) if f > 0 => TestState::Failed,
        _ => TestState::ExecutionError,
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        if let Err(e) = fs::remove_dir_all(&self.root) {
            let _ = writeln!(
                std::io::stderr().lock(),
                "proof cleanup failed for {}: {e}",
                self.root.display()
            );
        }
    }
}

#[test]
fn exit_code_is_not_a_verdict() {
    for failure in [
        json!({"overflow":true}),
        json!({"pipeError":"read failed"}),
        json!({"error":"wait failed"}),
        json!({"cleanupError":"child may remain"}),
    ] {
        let mut evidence =
            json!({"exit":0,"report":{"complete":true,"passed":1,"failed":0,"errors":0}});
        evidence
            .as_object_mut()
            .unwrap()
            .extend(failure.as_object().unwrap().clone());
        assert_eq!(classify("node", &evidence), TestState::ExecutionError);
        evidence["cancelled"] = json!(true);
        assert_eq!(classify("node", &evidence), TestState::Cancelled);
    }
    assert_eq!(
        classify("node", &json!({"exit":1,"timedOut":true,"cancelled":true})),
        TestState::Cancelled
    );
    assert_eq!(
        classify("node", &json!({"exit":1,"timedOut":false})),
        TestState::ExecutionError
    );
    assert_eq!(
        classify("node", &json!({"exit":1,"timedOut":true})),
        TestState::TimedOut
    );
    assert_eq!(
        classify(
            "node",
            &json!({"exit":0,"report":{"complete":true,"passed":0,"failed":0,"errors":0}})
        ),
        TestState::ExecutionError
    );
}

#[test]
fn observed_failures_require_complete_hook_evidence() {
    let evidence =
        json!({"exit":1,"report":{"complete":true,"passed":0,"failed":1,"errors":0,"timeouts":0}});
    assert_eq!(classify("observed", &evidence), TestState::Failed);
    for (field, value, expected) in [
        ("errors", json!(1), TestState::ExecutionError),
        ("complete", json!(false), TestState::ExecutionError),
        ("timeouts", json!(1), TestState::TimedOut),
        ("timeouts", Value::Null, TestState::ExecutionError),
    ] {
        let mut changed = evidence.clone();
        changed["report"][field] = value;
        assert_eq!(classify("observed", &changed), expected);
    }
}

#[test]
fn module_file_urls_encode_paths_and_are_absolute() {
    let target = std::env::temp_dir()
        .join("input path 🎸")
        .join("node#reporter.mjs");
    let url = module_file_url(&target).unwrap();
    assert!(url.starts_with("file://"));
    assert!(url.contains("input%20path%20%F0%9F%8E%B8"));
    assert!(url.contains("node%23reporter.mjs"));
    assert_eq!(module_path(&target).unwrap(), target.to_str().unwrap());
}

#[test]
fn proof_clock_before_epoch_is_a_controlled_error() {
    assert_eq!(epoch_nanos(UNIX_EPOCH).unwrap(), 0);
    assert!(
        epoch_nanos(UNIX_EPOCH - Duration::from_secs(1))
            .unwrap_err()
            .contains("clock")
    );
}
