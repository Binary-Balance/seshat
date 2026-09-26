use super::*;
use std::sync::atomic::{AtomicBool, Ordering};
use windows_sys::Win32::{
    Foundation::WAIT_OBJECT_0,
    System::Threading::{OpenProcess, PROCESS_SYNCHRONIZE, WaitForSingleObject},
};

static SIGNALLED: AtomicBool = AtomicBool::new(false);

unsafe extern "system" fn fixture_signal(_: u32) -> i32 {
    SIGNALLED.store(true, Ordering::Relaxed);
    TRUE
}

// Invoked in separate processes by the native checks below, never as a normal test.
#[test]
#[ignore]
fn fixture() {
    let root = PathBuf::from(env::var_os("CONSOLE_FIXTURE_ROOT").unwrap());
    let mode = env::var("CONSOLE_FIXTURE_MODE").unwrap();
    // SAFETY: these calls change only this disposable fixture's console handlers.
    assert_ne!(unsafe { SetConsoleCtrlHandler(None, FALSE) }, FALSE);
    assert_ne!(
        unsafe { SetConsoleCtrlHandler(Some(fixture_signal), TRUE) },
        FALSE
    );
    fs::write(
        root.join(format!("{mode}.pid")),
        std::process::id().to_string(),
    )
    .unwrap();
    if mode != "descendant" && mode != "sentinel" {
        let _descendant = fixture_command(&root, "descendant").spawn().unwrap();
        until(|| root.join("descendant.pid").exists());
        println!("retained stdout");
        eprintln!("retained stderr");
        io::stdout().flush().unwrap();
        io::stderr().flush().unwrap();
        // Keep fixture identities alive until the test owns wait-only handles.
        until(|| root.join("observed").exists());
        // Stale readiness must not signal before this new marker is published.
        assert!(
            !SIGNALLED.load(Ordering::Relaxed),
            "signal arrived before fresh readiness"
        );
        if mode == "delayed-hang" {
            thread::sleep(Duration::from_secs(1));
        }
        if mode == "invalid-ready" {
            fs::create_dir(root.join("ready")).unwrap();
        } else if mode != "no-ready" && mode != "early-exit" {
            fs::write(root.join("ready"), "fresh").unwrap();
        }
        if mode == "early-exit" {
            return;
        }
    }
    let deadline = Instant::now() + Duration::from_secs(120);
    while Instant::now() < deadline && !root.join("stop").exists() {
        if mode == "exit-on-signal" && SIGNALLED.load(Ordering::Relaxed) {
            println!("received console signal");
            return;
        }
        thread::sleep(POLL);
    }
}

fn fixture_command(root: &Path, mode: &str) -> Command {
    let mut command = Command::new(env::current_exe().unwrap());
    command
        .args([
            "--exact",
            "windows::tests::fixture",
            "--ignored",
            "--nocapture",
        ])
        .env("CONSOLE_FIXTURE_ROOT", root)
        .env("CONSOLE_FIXTURE_MODE", mode)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command
}

fn until(mut condition: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !condition() {
        assert!(Instant::now() < deadline, "fixture timed out");
        thread::sleep(POLL);
    }
}

fn process_handle(path: &Path) -> OwnedHandle {
    let pid = fs::read_to_string(path).unwrap().parse().unwrap();
    // SAFETY: obtain a wait-only handle to this live fixture, never signal a saved PID.
    let handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, FALSE, pid) };
    assert!(
        !handle.is_null(),
        "open fixture: {}",
        io::Error::last_os_error()
    );
    // SAFETY: OpenProcess transferred ownership of this handle.
    unsafe { OwnedHandle::from_raw_handle(handle) }
}

fn exited(handle: &OwnedHandle) -> bool {
    // SAFETY: the handle remains owned throughout the wait.
    unsafe { WaitForSingleObject(handle.as_raw_handle(), 0) == WAIT_OBJECT_0 }
}

struct Fixture(PathBuf);
impl Fixture {
    fn new(name: &str) -> Self {
        let path = env::temp_dir().join(format!("seshat-console-{}-{name}", std::process::id()));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        // Fallback comes after assertions, so it cannot masquerade as helper cleanup.
        let _ = fs::write(self.0.join("stop"), "stop");
    }
}

fn helper() -> PathBuf {
    PathBuf::from(
        env::var_os("SESHAT_CONSOLE_HELPER_BINARY")
            .expect("set SESHAT_CONSOLE_HELPER_BINARY to the built native helper"),
    )
}

#[test]
#[ignore = "requires a built native helper; run the dedicated Windows proof"]
fn native_console_helper() {
    closed_gate_never_launches_command();
    isolate_console().unwrap();
    let sentinel_root = Fixture::new("sentinel");
    let mut sentinel = fixture_command(&sentinel_root.0, "sentinel")
        .spawn()
        .unwrap();
    until(|| sentinel_root.0.join("sentinel.pid").exists());
    let sentinel_handle = process_handle(&sentinel_root.0.join("sentinel.pid"));
    // Actual helper entry point, both event routes and the full timeout budgets.
    for (name, mode, ctrl_c, expected) in [
        ("stale-break", "exit-on-signal", false, None),
        ("stale-ctrl-c", "exit-on-signal", true, None),
        ("missing", "no-ready", false, Some("did not become ready")),
        (
            "non-exit",
            "delayed-hang",
            false,
            Some("did not finish cancellation"),
        ),
        (
            "invalid",
            "invalid-ready",
            false,
            Some("not a regular file"),
        ),
        ("early", "early-exit", false, Some("exited before ready")),
    ] {
        let fixture = Fixture::new(name);
        let root = &fixture.0;
        let ready = root.join("ready");
        fs::write(&ready, "stale").unwrap();
        let stdout_path = root.join("stdout");
        let stderr_path = root.join("stderr");
        let mut command = Command::new(helper());
        if ctrl_c {
            command.arg("--ctrl-c");
        }
        command
            .arg(&ready)
            .arg(&stdout_path)
            .arg(&stderr_path)
            .arg(env::current_exe().unwrap())
            .args([
                "--exact",
                "windows::tests::fixture",
                "--ignored",
                "--nocapture",
            ])
            .env("CONSOLE_FIXTURE_ROOT", root)
            .env("CONSOLE_FIXTURE_MODE", mode)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let started = Instant::now();
        let mut child = command.spawn().unwrap();
        until(|| root.join("descendant.pid").exists());
        let leader = process_handle(&root.join(format!("{mode}.pid")));
        let descendant = process_handle(&root.join("descendant.pid"));
        fs::write(root.join("observed"), "observed").unwrap();
        let deadline = started + Duration::from_secs(42);
        while child.try_wait().unwrap().is_none() && Instant::now() < deadline {
            thread::sleep(POLL);
        }
        if child.try_wait().unwrap().is_none() {
            child.kill().unwrap();
            panic!("{name}: helper exceeded its bound");
        }
        let output = child.wait_with_output().unwrap();
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(
            stdout.contains("retained stdout"),
            "{name}: {stdout} {stderr}"
        );
        assert!(stderr.contains("retained stderr"), "{name}: {stderr}");
        if let Some(expected) = expected {
            assert_eq!(output.status.code(), Some(1), "{name}: {stderr}");
            assert!(stderr.contains(expected), "{name}: {stderr}");
        } else {
            assert!(output.status.success(), "{name}: {stderr}");
            assert!(
                stdout.contains("received console signal"),
                "{name}: stale readiness was accepted"
            );
            assert_eq!(fs::read_to_string(&ready).unwrap(), "fresh");
        }
        if name == "missing" || name == "non-exit" {
            assert!(
                started.elapsed() >= DEADLINE,
                "{name}: shortened 30-second deadline"
            );
        }
        if name == "non-exit" {
            assert!(
                started.elapsed() >= DEADLINE + Duration::from_secs(1),
                "readiness consumed the post-signal budget"
            );
        }
        assert!(exited(&leader), "{name}: leader survived helper cleanup");
        assert!(
            exited(&descendant),
            "{name}: descendant survived helper cleanup"
        );
        assert!(!exited(&sentinel_handle), "{name}: unrelated process died");
        println!(
            "console helper {name}: passed, {:.2}s",
            started.elapsed().as_secs_f64()
        );
        fs::remove_dir_all(root).unwrap();
    }

    // Inject OS failures at the actual shared supervisor/cleanup seam. These hooks
    // are compiled only in this test executable, never into the shipped helper.
    for fault in ["poll", "signal", "kill", "terminate", "query"] {
        let fixture = Fixture::new(fault);
        let root = &fixture.0;
        let mut command = Command::new(helper());
        command
            .arg("--owned-child")
            .arg(env::current_exe().unwrap())
            .args([
                "--exact",
                "windows::tests::fixture",
                "--ignored",
                "--nocapture",
            ])
            .env("CONSOLE_FIXTURE_ROOT", root)
            .env("CONSOLE_FIXTURE_MODE", "hang")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NEW_PROCESS_GROUP);
        let mut owned = OwnedChild::launch(&mut command).unwrap();
        until(|| root.join("descendant.pid").exists());
        let leader = process_handle(&root.join("hang.pid"));
        let descendant = process_handle(&root.join("descendant.pid"));
        fs::write(root.join("observed"), "observed").unwrap();
        until(|| root.join("ready").exists());
        owned.fault = Some(fault);
        let started = Instant::now();
        let result = if fault == "poll" || fault == "signal" {
            supervise(&mut owned, &root.join("ready"), false)
        } else {
            Err("primary proof failure".into())
        };
        let error = combine(result, owned.cleanup()).unwrap_err();
        drop(owned);
        assert!(error.contains("injected"), "{fault}: {error}");
        if fault == "kill" || fault == "terminate" || fault == "query" {
            assert!(error.contains("primary proof failure"));
        }
        if fault == "poll" || fault == "terminate" || fault == "query" {
            assert!(error.contains("not verified within 5 seconds"));
        }
        assert!(
            started.elapsed() < Duration::from_secs(8),
            "{fault}: unbounded cleanup"
        );
        until(|| exited(&leader) && exited(&descendant));
        assert!(!exited(&sentinel_handle), "{fault}: unrelated process died");
        println!("console helper {fault} failure: {error}; owned tree stopped");
        fs::remove_dir_all(root).unwrap();
    }
    fs::write(sentinel_root.0.join("stop"), "stop").unwrap();
    until(|| sentinel.try_wait().unwrap().is_some());
    fs::remove_dir_all(&sentinel_root.0).unwrap();
}

#[test]
fn readiness_and_output_errors() {
    let fixture = Fixture::new("io");
    let path = fixture.0.join("ready");
    assert!(!ready(&path).unwrap());
    fs::write(&path, "stale").unwrap();
    fresh_readiness(&path).unwrap();
    assert!(!ready(&path).unwrap());
    fs::create_dir(&path).unwrap();
    assert!(fresh_readiness(&path).unwrap_err().contains("remove stale"));
    assert!(ready(&path).unwrap_err().contains("not a regular file"));
    // An invalid Windows path must not be mistaken for absent readiness.
    let invalid = Path::new("invalid\0path");
    assert!(ready(invalid).is_err());
    assert!(fresh_readiness(invalid).is_err());

    struct Broken;
    impl Write for Broken {
        fn write(&mut self, _: &[u8]) -> io::Result<usize> {
            Err(io::Error::other("broken writer"))
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }
    let out = fixture.0.join("stdout");
    let err = fixture.0.join("stderr");
    fs::write(&out, "stdout proof").unwrap();
    fs::write(&err, "stderr proof").unwrap();
    let mut retained = Vec::new();
    assert!(
        outputs(&out, &err, Broken, &mut retained)
            .unwrap_err()
            .contains("stdout")
    );
    assert_eq!(retained, b"stderr proof");
    let error = outputs(&out, &err, Broken, Broken).unwrap_err();
    assert!(error.contains("stdout") && error.contains("stderr"));
    fs::remove_file(&out).unwrap();
    retained.clear();
    assert!(outputs(&out, &err, Broken, &mut retained).is_err());
    assert_eq!(retained, b"stderr proof");
    fs::remove_dir_all(&fixture.0).unwrap();
}

fn closed_gate_never_launches_command() {
    let fixture = Fixture::new("gate");
    let mut child = Command::new(helper())
        .arg("--owned-child")
        .arg(env::current_exe().unwrap())
        .args([
            "--exact",
            "windows::tests::fixture",
            "--ignored",
            "--nocapture",
        ])
        .env("CONSOLE_FIXTURE_ROOT", &fixture.0)
        .env("CONSOLE_FIXTURE_MODE", "sentinel")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    until(|| child.try_wait().unwrap().is_some());
    assert_eq!(child.try_wait().unwrap().unwrap().code(), Some(1));
    assert!(!fixture.0.join("sentinel.pid").exists());
    fs::remove_dir_all(&fixture.0).unwrap();
}
