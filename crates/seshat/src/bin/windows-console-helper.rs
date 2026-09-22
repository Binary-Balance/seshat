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
        Foundation::{FALSE, TRUE},
        System::{
            Console::{
                AllocConsole, CTRL_BREAK_EVENT, CTRL_C_EVENT, FreeConsole,
                GenerateConsoleCtrlEvent, GetStdHandle, STD_ERROR_HANDLE, STD_OUTPUT_HANDLE,
                SetConsoleCtrlHandler, SetStdHandle,
            },
            Threading::CREATE_NEW_PROCESS_GROUP,
        },
    };

    unsafe extern "system" fn preserve_helper(control: u32) -> i32 {
        if control == CTRL_C_EVENT { TRUE } else { FALSE }
    }

    fn isolate_console() -> Result<(), String> {
        // Ctrl+C cannot target a process group. Give this proof its own console so
        // broadcasting it cannot cancel the runner or unrelated processes.
        // SAFETY: these calls change only this helper's console and standard handles.
        unsafe {
            let stdout = GetStdHandle(STD_OUTPUT_HANDLE);
            let stderr = GetStdHandle(STD_ERROR_HANDLE);
            FreeConsole();
            if AllocConsole() == FALSE
                || SetStdHandle(STD_OUTPUT_HANDLE, stdout) == FALSE
                || SetStdHandle(STD_ERROR_HANDLE, stderr) == FALSE
                || SetConsoleCtrlHandler(None, FALSE) == FALSE
                || SetConsoleCtrlHandler(Some(preserve_helper), TRUE) == FALSE
            {
                return Err(format!(
                    "isolate Ctrl+C console: {}",
                    io::Error::last_os_error()
                ));
            }
        }
        Ok(())
    }

    fn forward(path: &PathBuf, mut output: impl Write) -> Result<(), String> {
        let bytes = fs::read(path).map_err(|e| format!("read child output: {e}"))?;
        output
            .write_all(&bytes)
            .map_err(|e| format!("forward child output: {e}"))
    }

    fn run() -> Result<i32, String> {
        let mut args = env::args_os().skip(1);
        let first = args.next().ok_or("ready marker is missing")?;
        let ctrl_c = first == "--ctrl-c";
        let ready = PathBuf::from(if ctrl_c {
            args.next().ok_or("ready marker is missing")?
        } else {
            first
        });
        let stdout_path = PathBuf::from(args.next().ok_or("stdout path is missing")?);
        let stderr_path = PathBuf::from(args.next().ok_or("stderr path is missing")?);
        let program = args.next().ok_or("child program is missing")?;
        let child_args: Vec<_> = args.collect();
        if ctrl_c {
            isolate_console()?;
        }
        let mut child = Command::new(program);
        if !ctrl_c {
            // A new process group suppresses Ctrl+C, so use it only for Ctrl+Break.
            child.creation_flags(CREATE_NEW_PROCESS_GROUP);
        }
        child
            .args(child_args)
            .env("SESHAT_CONSOLE_READY", &ready)
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
        // Readiness follows native handler registration. Ctrl+C uses the isolated
        // console; Ctrl+Break targets the group created above.
        let (event, group) = if ctrl_c {
            (CTRL_C_EVENT, 0)
        } else {
            (CTRL_BREAK_EVENT, child.id())
        };
        // SAFETY: the target is this proof's console or its owned child group.
        if unsafe { GenerateConsoleCtrlEvent(event, group) } == FALSE {
            let error = io::Error::last_os_error();
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("deliver console cancellation: {error}"));
        }
        let deadline = Instant::now() + Duration::from_secs(30);
        let status = loop {
            if let Some(status) = child
                .try_wait()
                .map_err(|e| format!("wait console child: {e}"))?
            {
                break status;
            }
            if Instant::now() >= deadline {
                let _ = child.kill();
                let _ = child.wait();
                return Err("console child did not finish cancellation".into());
            }
            thread::sleep(Duration::from_millis(10));
        };
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
