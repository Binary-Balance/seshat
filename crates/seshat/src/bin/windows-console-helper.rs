#[cfg(windows)]
mod windows {
    use std::{
        env,
        fs::{self, File},
        io::{self, Write},
        os::windows::process::CommandExt,
        path::PathBuf,
        process::{Command, Stdio},
        thread,
        time::{Duration, Instant},
    };
    use windows_sys::Win32::{
        Foundation::FALSE,
        System::{
            Console::{CTRL_BREAK_EVENT, GenerateConsoleCtrlEvent},
            Threading::CREATE_NEW_PROCESS_GROUP,
        },
    };

    fn forward(path: &PathBuf, mut output: impl Write) -> Result<(), String> {
        let bytes = fs::read(path).map_err(|e| format!("read child output: {e}"))?;
        output
            .write_all(&bytes)
            .map_err(|e| format!("forward child output: {e}"))
    }

    fn run() -> Result<i32, String> {
        let mut args = env::args_os().skip(1);
        let ready = PathBuf::from(args.next().ok_or("ready marker is missing")?);
        let stdout_path = PathBuf::from(args.next().ok_or("stdout path is missing")?);
        let stderr_path = PathBuf::from(args.next().ok_or("stderr path is missing")?);
        let program = args.next().ok_or("child program is missing")?;
        let child_args: Vec<_> = args.collect();
        let mut child = Command::new(program);
        child
            .args(child_args)
            .env("SESHAT_CONSOLE_READY", &ready)
            .creation_flags(CREATE_NEW_PROCESS_GROUP)
            .stdin(Stdio::null())
            .stdout(Stdio::from(
                File::create(&stdout_path).map_err(|e| format!("create child stdout: {e}"))?,
            ))
            .stderr(Stdio::from(
                File::create(&stderr_path).map_err(|e| format!("create child stderr: {e}"))?,
            ));
        let mut child = child
            .spawn()
            .map_err(|e| format!("spawn console child: {e}"))?;
        let deadline = Instant::now() + Duration::from_secs(30);
        while !ready.exists() {
            if let Some(status) = child
                .try_wait()
                .map_err(|e| format!("inspect console child: {e}"))?
            {
                return Err(format!("console child exited before ready: {status}"));
            }
            if Instant::now() >= deadline {
                let _ = child.kill();
                let _ = child.wait();
                return Err("console child did not become ready".into());
            }
            thread::sleep(Duration::from_millis(10));
        }
        // CTRL_BREAK_EVENT is delivered by the Windows console to the child's real process
        // group. The target CLI registered its native handler before starting the fixture.
        // SAFETY: the group ID is the PID of the child created with CREATE_NEW_PROCESS_GROUP.
        if unsafe { GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT, child.id()) } == FALSE {
            let error = io::Error::last_os_error();
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("deliver console cancellation: {error}"));
        }
        let status = child
            .wait()
            .map_err(|e| format!("wait console child: {e}"))?;
        forward(&stdout_path, io::stdout().lock())?;
        forward(&stderr_path, io::stderr().lock())?;
        Ok(status.code().unwrap_or(1))
    }

    pub(super) fn main() {
        match run() {
            Ok(status) => std::process::exit(status),
            Err(error) => {
                eprintln!("{error}");
                std::process::exit(1);
            }
        }
    }
}

#[cfg(windows)]
fn main() {
    windows::main();
}

#[cfg(not(windows))]
fn main() {
    eprintln!("windows-console-helper requires Windows");
    std::process::exit(1);
}
