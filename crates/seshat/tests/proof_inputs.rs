use serde_json::{Value, json};
use std::{
    ffi::OsString,
    fs, io,
    path::PathBuf,
    process::{Command, Output, Stdio},
    sync::atomic::{AtomicUsize, Ordering},
};

const BINARY: &str = env!("CARGO_BIN_EXE_seshat-proofs");
static NEXT: AtomicUsize = AtomicUsize::new(0);

struct Fixture {
    root: PathBuf,
    config: Value,
}

impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "seshat-proof-input-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        // Node resolves source paths through aliases such as macOS's /var -> /private/var.
        #[cfg(unix)]
        let root = root.canonicalize().unwrap();
        fs::create_dir(root.join("input")).unwrap();
        fs::create_dir(root.join("scratch")).unwrap();
        fs::write(
            root.join("input/subject.ts"),
            "export const ready = 1 === 1;\n",
        )
        .unwrap();
        let config = json!({
            "template":root.join("input"), "scratch":root.join("scratch"),
            "source":"subject.ts", "runner":"observed", "limit":1,
            "test":node("require('fs').writeFileSync(process.env.SESHAT_RECEIPT, JSON.stringify({complete:true,passed:1,failed:0,errors:0,timeouts:0}))")
        });
        Self { root, config }
    }

    fn execute(&self, strategy: &str) -> Command {
        let path = self.root.join("config.json");
        fs::write(&path, self.config.to_string()).unwrap();
        let mut command = Command::new(BINARY);
        command.args(["execute"]).arg(path).arg(strategy);
        command
    }

    fn clean(&self) {
        assert_eq!(fs::read_dir(self.root.join("scratch")).unwrap().count(), 0);
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.root).unwrap();
    }
}

fn node(script: &str) -> Value {
    json!(["node", "-e", script])
}

fn report(output: &Output, status: i32) -> Value {
    assert_eq!(
        output.status.code(),
        Some(status),
        "stdout: {}\nstderr: {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(!String::from_utf8_lossy(&output.stderr).contains("panicked"));
    serde_json::from_slice(&output.stdout).unwrap()
}

#[test]
fn invalid_configuration_never_starts_an_earlier_command() {
    let mut fixture = Fixture::new();
    let marker = fixture.root.join("started");
    fixture.config["typecheck"] = node(&format!(
        "require('fs').writeFileSync({}, 'started')",
        json!(marker)
    ));
    let original = fixture.config.clone();
    for (key, value) in [
        ("runner", Value::Null),
        ("runner", json!("unknown")),
        ("runner", json!(3)),
        ("test", Value::Null),
        ("test", json!([])),
        ("test", json!(["node", 3])),
        ("test", json!([" "])),
        ("test", json!(["node", "bad\0arg"])),
        ("build", json!(false)),
        ("typecheck", json!([])),
        ("timeoutMs", json!(0)),
        ("timeoutMs", json!("100")),
        ("limit", json!(-1)),
        ("scenario", json!(false)),
        ("scenario", json!("bad\0scenario")),
    ] {
        fixture.config = original.clone();
        fixture.config[key] = value;
        let output = fixture.execute("replace").output().unwrap();
        let value = report(&output, 2);
        assert_eq!(value["complete"], false, "{key}: {value}");
        assert!(value["error"].is_string(), "{key}: {value}");
        assert!(!marker.exists(), "{key}: validation ran a command");
        fixture.clean();
    }
    fixture.config = original;
    let output = fixture.execute("unknown").output().unwrap();
    assert_eq!(report(&output, 2)["complete"], false);
    assert!(!marker.exists(), "invalid strategy ran a command");
    fixture.clean();
}

#[test]
fn non_utf8_arguments_return_a_controlled_error() {
    #[cfg(unix)]
    let argument = {
        use std::os::unix::ffi::OsStringExt;
        OsString::from_vec(vec![0xff])
    };
    #[cfg(windows)]
    let argument = {
        use std::os::windows::ffi::OsStringExt;
        OsString::from_wide(&[0xd800])
    };
    let output = Command::new(BINARY).arg(argument).output().unwrap();
    let value = report(&output, 2);
    assert_eq!(value["complete"], false);
    assert!(value["error"].as_str().unwrap().contains("UTF-8"));
}

#[test]
fn closed_stdout_returns_an_output_error_without_panicking() {
    let fixture = Fixture::new();
    let (reader, writer) = io::pipe().unwrap();
    drop(reader);
    let output = Command::new(BINARY)
        .arg("inspect")
        .arg(fixture.root.join("input/subject.ts"))
        .stdout(Stdio::from(writer))
        .stderr(Stdio::piped())
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("write report"), "{stderr}");
    assert!(!stderr.contains("panicked"), "{stderr}");
}

#[test]
fn successful_transform_commands_need_no_complete_field() {
    let fixture = Fixture::new();
    let source = fixture.root.join("input/subject.ts");
    for mode in ["inspect", "prepare", "replace"] {
        let mut command = Command::new(BINARY);
        command.arg(mode).arg(&source);
        if mode != "inspect" {
            command.arg(fixture.root.join("output.ts"));
        }
        if mode == "replace" {
            command.arg("0");
        }
        let value = report(&command.output().unwrap(), 0);
        assert!(value.get("complete").is_none(), "{mode}: {value}");
    }
}

#[test]
fn invalid_receipts_fail_closed_and_remove_scratch() {
    let mut fixture = Fixture::new();
    assert_eq!(
        report(&fixture.execute("replace").output().unwrap(), 0)["complete"],
        true
    );
    fixture.config["test"] = node(
        "require('fs').writeFileSync(process.env.SESHAT_RECEIPT, JSON.stringify({complete:true,passed:1,failed:0,errors:0,timeouts:0}) + ' '.repeat(32*1024*1024))",
    );
    let value = report(&fixture.execute("replace").output().unwrap(), 2);
    assert_eq!(value["complete"], false);
    assert_eq!(value["evidence"]["state"], "execution-error");
    assert!(
        value["evidence"]["evidenceError"]
            .as_str()
            .unwrap()
            .contains("32 MiB")
    );
    fixture.clean();
    for (script, expected) in [
        (
            "require('fs').writeFileSync(process.env.SESHAT_RECEIPT, 'not JSON')",
            Some("invalid report JSON"),
        ),
        (
            "require('fs').mkdirSync(process.env.SESHAT_RECEIPT)",
            Some("regular file"),
        ),
        ("", None),
    ] {
        fixture.config["test"] = node(script);
        let value = report(&fixture.execute("replace").output().unwrap(), 2);
        assert_eq!(value["evidence"]["state"], "execution-error");
        let error = value["evidence"]["evidenceError"].as_str().unwrap();
        if let Some(expected) = expected {
            assert!(error.contains(expected), "{error}");
        }
        fixture.clean();
    }
}

#[test]
fn proof_commands_clear_ambient_node_options_and_use_private_scratch() {
    let mut fixture = Fixture::new();
    let marker = fixture.root.join("preloaded");
    let preload = fixture.root.join("preload.cjs");
    fs::write(
        &preload,
        format!(
            "require('fs').writeFileSync({}, 'preloaded')",
            json!(marker)
        ),
    )
    .unwrap();
    let script = "const fs=require('fs'); if(process.env.NODE_OPTIONS || process.env.NODE_PATH) throw Error('ambient Node configuration'); if(process.platform!=='win32' && (fs.statSync('.').mode & 0o777)!==0o700) throw Error('scratch permissions'); fs.writeFileSync(process.env.SESHAT_RECEIPT, JSON.stringify({complete:true,passed:1,failed:0,errors:0,timeouts:0}));";
    for key in ["typecheck", "build", "test"] {
        fixture.config[key] = node(script);
    }
    let output = fixture
        .execute("replace")
        .env("NODE_OPTIONS", format!("--require={}", json!(preload)))
        .env("NODE_PATH", fixture.root.join("ambient-modules"))
        .output()
        .unwrap();
    assert_eq!(report(&output, 0)["complete"], true);
    assert!(!marker.exists(), "ambient preload executed");
    fixture.clean();

    fs::write(
        fixture.root.join("input/package.json"),
        r#"{"type":"module"}"#,
    )
    .unwrap();
    fs::write(
        fixture.root.join("input/subject.ts"),
        "export const ready = 1 === 1; if (!ready) throw new Error('application guard');\n",
    )
    .unwrap();
    fs::write(
        fixture.root.join("input/reporter.mjs"),
        include_str!("../../../benchmarks/proofs/node-reporter.mjs"),
    )
    .unwrap();
    fs::write(fixture.root.join("input/check.mjs"), "import {test} from 'node:test'; import assert from 'node:assert/strict'; import {existsSync} from 'node:fs'; import './subject.ts'; test('own observer',()=>{assert.match(process.env.NODE_OPTIONS, /^--import=/); assert.ok(existsSync(process.env.SESHAT_LOAD_CONTEXT)); assert.equal(process.env.NODE_PATH, undefined);});").unwrap();
    fixture.config["runner"] = json!("node");
    fixture.config["test"] = json!([
        "node",
        "--test",
        "--test-reporter=./reporter.mjs",
        "check.mjs"
    ]);
    let output = fixture
        .execute("replace")
        .env("NODE_OPTIONS", format!("--require={}", json!(preload)))
        .env("NODE_PATH", fixture.root.join("ambient-modules"))
        .output()
        .unwrap();
    let value: Value = serde_json::from_slice(&output.stdout).unwrap();
    let observed = matches!(
        value["baseline"]["report"]["node"].as_str(),
        Some("24.20.0" | "24.21.0")
    );
    let value = report(&output, if observed { 0 } else { 2 });
    assert_eq!(value["baseline"]["state"], "passed");
    assert_eq!(
        value["outcomes"][0]["evidence"]["report"]["moduleFailures"]
            .as_array()
            .unwrap()
            .len(),
        usize::from(observed)
    );
    assert!(
        !marker.exists(),
        "ambient preload executed alongside the observer"
    );
    fixture.clean();
}

#[cfg(unix)]
#[test]
fn wait_and_cleanup_errors_keep_partial_output() {
    use std::os::unix::process::CommandExt;
    let mut fixture = Fixture::new();
    fixture.config["test"] = node(
        "process.stdout.write('stdout before exit'); process.stderr.write('stderr before exit'); require('fs').writeFileSync(process.env.SESHAT_RECEIPT, JSON.stringify({complete:true,passed:1,failed:0,errors:0,timeouts:0}));",
    );
    let mut command = fixture.execute("replace");
    // This disposable proof process auto-reaps its children, injecting ECHILD at
    // the real wait boundary without changing the test process's signal handling.
    unsafe {
        command.pre_exec(|| {
            if libc::signal(libc::SIGCHLD, libc::SIG_IGN) == libc::SIG_ERR {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        });
    }
    let value = report(&command.output().unwrap(), 2);
    let evidence = &value["evidence"];
    assert_eq!(evidence["state"], "execution-error", "{value}");
    assert!(evidence["error"].is_string(), "{value}");
    assert!(evidence["cleanupError"].is_string(), "{value}");
    let diagnostic = evidence["diagnostic"].as_str().unwrap();
    assert!(diagnostic.contains("stdout before exit"), "{value}");
    assert!(diagnostic.contains("stderr before exit"), "{value}");
    fixture.clean();
}
