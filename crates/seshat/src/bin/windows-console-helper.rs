#[cfg(windows)]
mod windows {
    use std::{
        env,
        fs::{self, File},
        io::{self, Read, Write},
        os::windows::{
            io::{AsRawHandle, FromRawHandle, OwnedHandle},
            process::CommandExt,
        },
        path::{Path, PathBuf},
        process::{Child, Command, ExitStatus, Stdio},
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
            JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
                JobObjectBasicAccountingInformation, JobObjectExtendedLimitInformation,
                QueryInformationJobObject, SetInformationJobObject, TerminateJobObject,
            },
            Threading::CREATE_NEW_PROCESS_GROUP,
        },
    };

    const POLL: Duration = Duration::from_millis(10);
    const DEADLINE: Duration = Duration::from_secs(30);
    const CLEANUP: Duration = Duration::from_secs(5);

    unsafe extern "system" fn preserve_helper(control: u32) -> i32 {
        if control == CTRL_C_EVENT || control == CTRL_BREAK_EVENT {
            TRUE
        } else {
            FALSE
        }
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

    fn fresh_readiness(path: &Path) -> Result<(), String> {
        match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("remove stale console readiness: {error}")),
        }
    }

    fn ready(path: &Path) -> Result<bool, String> {
        match fs::symlink_metadata(path) {
            Ok(metadata) if metadata.is_file() => Ok(true),
            Ok(_) => Err("console readiness is not a regular file".into()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(format!("inspect console readiness: {error}")),
        }
    }

    fn forward(path: &Path, mut output: impl Write) -> Result<(), String> {
        let mut file = File::open(path).map_err(|e| format!("read child output: {e}"))?;
        io::copy(&mut file, &mut output)
            .map(|_| ())
            .map_err(|e| format!("forward child output: {e}"))
    }

    fn outputs(
        stdout_path: &Path,
        stderr_path: &Path,
        stdout: impl Write,
        stderr: impl Write,
    ) -> Result<(), String> {
        let stdout = forward(stdout_path, stdout).map_err(|e| format!("stdout: {e}"));
        let stderr = forward(stderr_path, stderr).map_err(|e| format!("stderr: {e}"));
        combine(stdout, stderr)
    }

    fn combine<T>(result: Result<T, String>, next: Result<(), String>) -> Result<T, String> {
        match (result, next) {
            (Ok(value), Ok(())) => Ok(value),
            (Err(error), Ok(())) | (Ok(_), Err(error)) => Err(error),
            (Err(error), Err(next)) => Err(format!("{error}; {next}")),
        }
    }

    struct OwnedChild {
        child: Child,
        job: OwnedHandle,
        #[cfg(test)]
        fault: Option<&'static str>,
    }

    impl OwnedChild {
        fn launch(command: &mut Command) -> Result<Self, String> {
            // SAFETY: a null name creates a private, non-inheritable job.
            let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
            if handle.is_null() {
                return Err(format!(
                    "create console job: {}",
                    io::Error::last_os_error()
                ));
            }
            // SAFETY: CreateJobObjectW transferred this handle to us.
            let job = unsafe { OwnedHandle::from_raw_handle(handle) };
            let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            // SAFETY: the job and sized limits buffer remain valid for this call.
            if unsafe {
                SetInformationJobObject(
                    job.as_raw_handle(),
                    JobObjectExtendedLimitInformation,
                    (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                    size_of_val(&limits) as u32,
                )
            } == FALSE
            {
                return Err(format!(
                    "configure console job: {}",
                    io::Error::last_os_error()
                ));
            }
            let child = command
                .stdin(Stdio::piped())
                .spawn()
                .map_err(|e| format!("spawn console child: {e}"))?;
            let mut owned = Self {
                child,
                job,
                #[cfg(test)]
                fault: None,
            };
            let start = (|| {
                // The child blocks on stdin before it can launch the real command.
                // SAFETY: both handles are live and exclusively owned here.
                if unsafe {
                    AssignProcessToJobObject(owned.job.as_raw_handle(), owned.child.as_raw_handle())
                } == FALSE
                {
                    return Err(format!(
                        "assign console job: {}",
                        io::Error::last_os_error()
                    ));
                }
                owned
                    .child
                    .stdin
                    .take()
                    .ok_or("console gate is missing")?
                    .write_all(&[1])
                    .map_err(|e| format!("release console gate: {e}"))
            })();
            match start {
                Ok(()) => Ok(owned),
                Err(error) => Err(combine::<()>(Err(error), owned.cleanup()).unwrap_err()),
            }
        }

        fn poll(&mut self) -> Result<Option<ExitStatus>, String> {
            #[cfg(test)]
            if self.fault == Some("poll") {
                return Err("injected child poll failure".into());
            }
            self.child
                .try_wait()
                .map_err(|e| format!("inspect console child: {e}"))
        }

        fn signal(&self, ctrl_c: bool) -> Result<(), String> {
            #[cfg(test)]
            if self.fault == Some("signal") {
                return Err("injected signal failure".into());
            }
            let (event, group) = if ctrl_c {
                (CTRL_C_EVENT, 0)
            } else {
                (CTRL_BREAK_EVENT, self.child.id())
            };
            // SAFETY: this proof owns the isolated console or child process group.
            if unsafe { GenerateConsoleCtrlEvent(event, group) } == FALSE {
                return Err(format!(
                    "deliver console cancellation: {}",
                    io::Error::last_os_error()
                ));
            }
            Ok(())
        }

        fn active(&self) -> Result<u32, String> {
            #[cfg(test)]
            if self.fault == Some("query") {
                return Err("injected job query failure".into());
            }
            let mut accounting = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
            // SAFETY: the job is live and the output buffer has the documented size.
            if unsafe {
                QueryInformationJobObject(
                    self.job.as_raw_handle(),
                    JobObjectBasicAccountingInformation,
                    (&mut accounting as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
                    size_of_val(&accounting) as u32,
                    std::ptr::null_mut(),
                )
            } == FALSE
            {
                return Err(format!(
                    "inspect console job cleanup: {}",
                    io::Error::last_os_error()
                ));
            }
            Ok(accounting.ActiveProcesses)
        }

        fn terminate(&self) -> Result<(), String> {
            #[cfg(test)]
            if self.fault == Some("terminate") {
                return Err("injected job termination failure".into());
            }
            // SAFETY: this job contains only the gated child and its descendants.
            if unsafe { TerminateJobObject(self.job.as_raw_handle(), 1) } == FALSE {
                return Err(format!(
                    "terminate console job: {}",
                    io::Error::last_os_error()
                ));
            }
            Ok(())
        }

        fn kill(&mut self) -> Result<(), String> {
            #[cfg(test)]
            if self.fault == Some("kill") {
                return Err("injected child kill failure".into());
            }
            if let Err(error) = self.child.kill() {
                // Termination races a normal exit or the job-wide stop above.
                // A wait-only check can confirm that no further kill is needed.
                return match self.child.try_wait() {
                    Ok(Some(_)) => Ok(()),
                    Ok(None) => Err(format!("kill console child: {error}")),
                    Err(poll) => Err(format!(
                        "kill console child: {error}; inspect console child: {poll}"
                    )),
                };
            }
            Ok(())
        }

        fn cleanup(&mut self) -> Result<(), String> {
            let deadline = Instant::now() + CLEANUP;
            let mut errors = Vec::new();
            let mut record = |error| {
                if !errors.contains(&error) {
                    errors.push(error);
                }
            };
            if let Err(error) = self.terminate() {
                record(error);
            }
            // Also covers assignment failure, when the gated child is outside the job.
            if let Err(error) = self.kill() {
                record(error);
            }
            loop {
                // Inspect both even if polling one fails; never enter a blocking wait.
                let exited = match self.poll() {
                    Ok(status) => status.is_some(),
                    Err(error) => {
                        record(error);
                        false
                    }
                };
                let empty = match self.active() {
                    Ok(active) => active == 0,
                    Err(error) => {
                        record(error);
                        false
                    }
                };
                if exited && empty {
                    break;
                }
                if Instant::now() >= deadline {
                    record("console cleanup was not verified within 5 seconds".into());
                    break;
                }
                thread::sleep(POLL);
            }
            if errors.is_empty() {
                Ok(())
            } else {
                Err(errors.join("; "))
            }
        }
    }

    impl Drop for OwnedChild {
        fn drop(&mut self) {
            // Closing the job is the final fallback if termination or verification
            // failed. A pre-assignment child cannot launch after its gate closes.
            self.child.stdin.take();
            let _ = self.child.kill();
        }
    }

    fn supervise(owned: &mut OwnedChild, path: &Path, ctrl_c: bool) -> Result<i32, String> {
        let deadline = Instant::now() + DEADLINE;
        while !ready(path)? {
            if let Some(status) = owned.poll()? {
                return Err(format!("console child exited before ready: {status}"));
            }
            if Instant::now() >= deadline {
                return Err("console child did not become ready".into());
            }
            thread::sleep(POLL);
        }
        owned.signal(ctrl_c)?;
        // Keep the full cancellation budget independent of time spent becoming ready.
        let deadline = Instant::now() + DEADLINE;
        loop {
            if let Some(status) = owned.poll()? {
                return Ok(status.code().unwrap_or(1));
            }
            if Instant::now() >= deadline {
                return Err("console child did not finish cancellation".into());
            }
            thread::sleep(POLL);
        }
    }

    fn owned_child(mut args: impl Iterator<Item = std::ffi::OsString>) -> Result<i32, String> {
        let mut gate = [0];
        io::stdin()
            .read_exact(&mut gate)
            .map_err(|e| format!("read console gate: {e}"))?;
        if gate != [1] {
            return Err("invalid console gate".into());
        }
        // The callback is not inherited. Explicitly enable Ctrl+C first because a
        // process group or caller may have disabled it through the inheritable flag.
        // SAFETY: these calls change only this intermediate child's handlers.
        if unsafe { SetConsoleCtrlHandler(None, FALSE) } == FALSE
            || unsafe { SetConsoleCtrlHandler(Some(preserve_helper), TRUE) } == FALSE
        {
            return Err(format!(
                "register console gate handler: {}",
                io::Error::last_os_error()
            ));
        }
        let program = args.next().ok_or("child program is missing")?;
        let status = Command::new(program)
            .args(args)
            .stdin(Stdio::null())
            .status()
            .map_err(|e| format!("run console child: {e}"))?;
        Ok(status.code().unwrap_or(1))
    }

    fn run() -> Result<i32, String> {
        let mut args = env::args_os().skip(1);
        let first = args.next().ok_or("ready marker is missing")?;
        if first == "--owned-child" {
            return owned_child(args);
        }
        let ctrl_c = first == "--ctrl-c";
        let ready = PathBuf::from(if ctrl_c {
            args.next().ok_or("ready marker is missing")?
        } else {
            first
        });
        let stdout_path = PathBuf::from(args.next().ok_or("stdout path is missing")?);
        let stderr_path = PathBuf::from(args.next().ok_or("stderr path is missing")?);
        let program = args.next().ok_or("child program is missing")?;
        fresh_readiness(&ready)?;
        if ctrl_c {
            isolate_console()?;
        }
        let mut command =
            Command::new(env::current_exe().map_err(|e| format!("locate console helper: {e}"))?);
        command
            .arg("--owned-child")
            .arg(program)
            .args(args)
            .env("SESHAT_CONSOLE_READY", &ready)
            .stdout(Stdio::from(
                File::create(&stdout_path).map_err(|e| format!("create child stdout: {e}"))?,
            ))
            .stderr(Stdio::from(
                File::create(&stderr_path).map_err(|e| format!("create child stderr: {e}"))?,
            ));
        if !ctrl_c {
            command.creation_flags(CREATE_NEW_PROCESS_GROUP);
        }
        let result = OwnedChild::launch(&mut command).and_then(|mut owned| {
            let result = supervise(&mut owned, &ready, ctrl_c);
            combine(result, owned.cleanup())
        });
        combine(
            result,
            outputs(
                &stdout_path,
                &stderr_path,
                io::stdout().lock(),
                io::stderr().lock(),
            ),
        )
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

    #[cfg(test)]
    mod tests {
        include!("windows_console_helper/tests.rs");
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
