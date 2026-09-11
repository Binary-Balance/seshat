// Platform process supervision for controlled, disposable proof fixtures.
mod job;
mod platform;
mod project;
use crate::{analysis::Analysis, assessment};
use assessment::TestState;
use percent_encoding::{AsciiSet, CONTROLS, percent_encode};
pub use project::{AssessmentMode, CapturedProject, Thresholds};
use serde_json::{Value, json};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        Arc, OnceLock,
        atomic::{AtomicUsize, Ordering},
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

// ponytail: one CLI run per process; pass cancellation explicitly if this becomes a library.
static CANCEL_SIGNAL: OnceLock<Arc<AtomicUsize>> = OnceLock::new();

fn stable_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    #[cfg(windows)]
    {
        return value.replace('\\', "/");
    }
    #[cfg(not(windows))]
    {
        value.into_owned()
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
) -> Result<(), String> {
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
            let analysis = Analysis::inspect(&stable_path(source_path), source)?;
            Ok::<_, String>(json!({
                "source":stable_path(source_path),
                "sites":analysis.load_failure_sites(source),
            }))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let context = if let [source_context] = source_contexts.as_slice() {
        json!({"version":1,"executionId":id,"source":stable_path(sources[0].0),"sites":source_context["sites"]})
    } else {
        json!({"version":1,"executionId":id,"sources":source_contexts})
    };
    for (path, bytes) in [
        (
            &observer,
            include_str!("../node-load-observer.mjs")
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
        .env("SESHAT_LOAD_CONTEXT", context_path)
        .env("SESHAT_EXECUTION_ID", id);
    Ok(())
}

impl CommandEvidence {
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
        let template = Path::new(config["template"].as_str().ok_or("missing template")?);
        let parent = Path::new(config["scratch"].as_str().ok_or("missing scratch")?);
        let source_file = match config.get("source") {
            None => "subject.tsx",
            Some(value) => match value.as_str() {
                Some("subject.ts") => "subject.ts",
                Some("subject.tsx") => "subject.tsx",
                _ => return Err("proof source must be subject.ts or subject.tsx".into()),
            },
        };
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = parent.join(format!("session-{}-{stamp}", std::process::id()));
        fs::create_dir(&root).map_err(|e| e.to_string())?;
        let mut session = Self {
            source_path: root.join(source_file),
            root,
            config: config.clone(),
            source: String::new(),
        };
        for entry in fs::read_dir(template).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if !entry.file_type().map_err(|e| e.to_string())?.is_file() {
                return Err("proof template must contain only regular files".into());
            }
            fs::copy(entry.path(), session.root.join(entry.file_name()))
                .map_err(|e| e.to_string())?;
        }
        session.source = fs::read_to_string(&session.source_path).map_err(|e| e.to_string())?;
        Ok(session)
    }

    fn command(&self, key: &str, id: Option<usize>) -> Result<CommandEvidence, String> {
        // Direct-loading runners have no separate build process.
        if key == "build" && self.config.get(key).is_none() {
            return Ok(CommandEvidence {
                state: TestState::Passed,
                details: json!({"skipped":true,"ms":0}),
            });
        }
        let args = self.config[key].as_array().ok_or("missing command")?;
        let args: Vec<_> = args
            .iter()
            .map(|v| {
                v.as_str()
                    .ok_or("command arguments must be strings")
                    .map(|s| s.replace("@ROOT@", self.root.to_str().unwrap()))
            })
            .collect::<Result<_, _>>()?;
        let (program, args) = args.split_first().ok_or("empty command")?;
        let receipt = self.root.join("receipt.json");
        if receipt.exists() {
            fs::remove_file(&receipt).map_err(|e| e.to_string())?;
        }
        let stdout = fs::File::create(self.root.join("stdout.log")).map_err(|e| e.to_string())?;
        let stderr = fs::File::create(self.root.join("stderr.log")).map_err(|e| e.to_string())?;
        let mut command = Command::new(program);
        command
            .args(args)
            .current_dir(&self.root)
            .env(
                "SESHAT_MUTANT_ID",
                id.map(|n| n.to_string()).unwrap_or_else(|| "-1".into()),
            )
            .env("SESHAT_RECEIPT", &receipt)
            .env(
                "SESHAT_PROOF_SCENARIO",
                self.config["scenario"].as_str().unwrap_or("normal"),
            )
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr));
        let start = Instant::now();
        if key == "test" && self.config["runner"] == "node" {
            let source = fs::read_to_string(&self.source_path).map_err(|e| e.to_string())?;
            let id = format!(
                "{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            );
            let sources = [(self.source_path.as_path(), source.as_str())];
            observe_node_loads(&mut command, &sources, &receipt, &id)?;
        }
        let mut child = platform::ManagedChild::spawn(&mut command)?;
        let timeout = Duration::from_millis(self.config["timeoutMs"].as_u64().unwrap_or(10000));
        let mut timed_out = false;
        let status = loop {
            if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
                break status;
            }
            if start.elapsed() >= timeout {
                timed_out = true;
                break child.kill_tree()?;
            }
            thread::sleep(Duration::from_millis(2));
        };
        // The leader can finish while descendants are still alive. The supervisor targets only
        // this invocation's owned process tree.
        child.stop_tree()?;
        let report = if receipt.exists() {
            let raw = fs::read_to_string(&receipt).map_err(|e| e.to_string())?;
            serde_json::from_str::<Value>(&raw).ok()
        } else {
            None
        };
        let mut evidence = json!({"exit":status.code(),"timedOut":timed_out,"ms":start.elapsed().as_secs_f64()*1000.0,"report":report});
        let state = if key != "test" {
            if status.success() && !timed_out {
                TestState::Passed
            } else {
                TestState::ExecutionError
            }
        } else {
            classify(self.config["runner"].as_str().unwrap(), &evidence)
        };
        if state == TestState::ExecutionError {
            let mut log = fs::read_to_string(self.root.join("stderr.log")).unwrap_or_default();
            log.push_str(&fs::read_to_string(self.root.join("stdout.log")).unwrap_or_default());
            log.truncate(
                log.char_indices()
                    .nth(2000)
                    .map(|(i, _)| i)
                    .unwrap_or(log.len()),
            );
            evidence["diagnostic"] = json!(log);
        }
        Ok(CommandEvidence {
            state,
            details: evidence,
        })
    }

    pub fn execute(self, strategy: &str) -> Result<Value, String> {
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
            fs::write(&self.source_path, analysis.switched(&self.source)?)
                .map_err(|e| e.to_string())?;
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
        } else if strategy != "replace" {
            return Err("unknown execution strategy".into());
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
            if strategy == "replace" {
                fs::write(&self.source_path, analysis.replace(&self.source, id)?)
                    .map_err(|e| e.to_string())?;
                let build = self.command("build", Some(id))?;
                builds += usize::from(build.details["skipped"] != true);
                if build.state != TestState::Passed {
                    executions.push(vec![build.state]);
                    evidence.push(build.into_json());
                    continue;
                }
            }
            let test = self.command("test", Some(id))?;
            executions.push(vec![test.state]);
            evidence.push(test.into_json());
        }
        let assessed = assessment::mutation(&[baseline.state], count, &executions);
        let outcomes: Vec<_> = assessed.outcomes.iter().zip(evidence).enumerate()
            .map(|(id, (verdict, evidence))| json!({"id":id,"verdict":verdict.label(),"evidence":evidence}))
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
            eprintln!("proof cleanup failed for {}: {e}", self.root.display());
        }
    }
}

#[test]
fn exit_code_is_not_a_verdict() {
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
