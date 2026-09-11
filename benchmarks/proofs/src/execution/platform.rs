use std::{
    io,
    process::{Child, ChildStderr, ChildStdout, Command, ExitStatus},
    sync::{Arc, atomic::AtomicUsize},
};

#[cfg(unix)]
mod unix {
    use super::*;
    use std::os::unix::process::CommandExt;

    pub(super) struct Supervisor {
        pid: u32,
        stopped: bool,
    }

    impl Supervisor {
        fn new(pid: u32) -> Self {
            Self {
                pid,
                stopped: false,
            }
        }

        fn stop(&mut self) -> Result<(), String> {
            if self.stopped {
                return Ok(());
            }
            let pid = i32::try_from(self.pid)
                .ok()
                .filter(|pid| *pid > 1)
                .ok_or("invalid owned process group")?;
            // SAFETY: process_group(0) gives the child a private group whose ID is its PID.
            if unsafe { libc::kill(-pid, libc::SIGKILL) } != 0 {
                let error = io::Error::last_os_error();
                if error.raw_os_error() != Some(libc::ESRCH) {
                    return Err(format!("stop owned process group: {error}"));
                }
            }
            self.stopped = true;
            Ok(())
        }
    }

    impl Drop for Supervisor {
        fn drop(&mut self) {
            let _ = self.stop();
        }
    }

    pub(super) fn install_cancellation(flag: Arc<AtomicUsize>) -> Result<(), String> {
        for signal in [signal_hook::consts::SIGINT, signal_hook::consts::SIGTERM] {
            signal_hook::flag::register_usize(signal, flag.clone(), signal as usize)
                .map_err(|e| format!("install cancellation handler: {e}"))?;
        }
        Ok(())
    }

    pub(super) fn spawn(command: &mut Command) -> Result<(Child, Supervisor), String> {
        command.process_group(0);
        let child = command.spawn().map_err(|e| format!("spawn: {e}"))?;
        let supervisor = Supervisor::new(child.id());
        Ok((child, supervisor))
    }

    pub(super) fn stop(supervisor: &mut Supervisor) -> Result<(), String> {
        supervisor.stop()
    }
}

#[cfg(windows)]
mod windows {
    use super::*;
    #[cfg(test)]
    use std::sync::{
        Mutex,
        atomic::{AtomicBool, AtomicU32, Ordering},
    };
    use std::{
        ffi::c_void,
        mem::size_of,
        os::windows::io::AsRawHandle,
        ptr::null_mut,
        sync::OnceLock,
        thread,
        time::{Duration, Instant},
    };
    #[cfg(test)]
    use windows_sys::Win32::Foundation::WAIT_OBJECT_0;
    use windows_sys::Win32::{
        Foundation::{CloseHandle, ERROR_NO_MORE_FILES, FALSE, HANDLE, INVALID_HANDLE_VALUE, TRUE},
        System::{
            Console::{CTRL_BREAK_EVENT, CTRL_C_EVENT, SetConsoleCtrlHandler},
            Diagnostics::ToolHelp::{
                CreateToolhelp32Snapshot, TH32CS_SNAPTHREAD, THREADENTRY32, Thread32First,
                Thread32Next,
            },
            JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
                JobObjectBasicAccountingInformation, JobObjectExtendedLimitInformation,
                QueryInformationJobObject, SetInformationJobObject, TerminateJobObject,
            },
            Threading::{
                CREATE_SUSPENDED, OpenThread, ResumeThread, THREAD_SUSPEND_RESUME, TerminateProcess,
            },
        },
    };

    static CONSOLE_FLAG: OnceLock<Arc<AtomicUsize>> = OnceLock::new();
    static CONSOLE_INSTALL: OnceLock<Result<(), String>> = OnceLock::new();

    #[cfg(test)]
    pub(super) static TEST_DISCOVERY_FAILURE: AtomicBool = AtomicBool::new(false);
    #[cfg(test)]
    pub(super) static TEST_ASSIGNMENT_FAILURE: AtomicBool = AtomicBool::new(false);
    #[cfg(test)]
    pub(super) static TEST_POST_ASSIGNMENT_FAILURE: AtomicBool = AtomicBool::new(false);
    #[cfg(test)]
    pub(super) static TEST_LAST_SPAWN_PID: AtomicU32 = AtomicU32::new(0);
    #[cfg(test)]
    static TEST_SPAWN_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    #[cfg(test)]
    pub(super) fn test_spawn_lock() -> &'static Mutex<()> {
        TEST_SPAWN_LOCK.get_or_init(|| Mutex::new(()))
    }

    unsafe extern "system" fn console_handler(control: u32) -> i32 {
        if matches!(control, CTRL_C_EVENT | CTRL_BREAK_EVENT) {
            if let Some(flag) = CONSOLE_FLAG.get() {
                flag.store(2, std::sync::atomic::Ordering::Relaxed);
                return TRUE;
            }
        }
        FALSE
    }

    pub(super) fn install_cancellation(flag: Arc<AtomicUsize>) -> Result<(), String> {
        CONSOLE_INSTALL
            .get_or_init(|| {
                if CONSOLE_FLAG.set(flag).is_err() {
                    return Err(
                        "Windows console cancellation handler already has a different flag".into(),
                    );
                }
                // SAFETY: console_handler is a static function pointer and the flag is process-owned.
                if unsafe { SetConsoleCtrlHandler(Some(console_handler), TRUE) } == FALSE {
                    return Err(format!(
                        "install Windows console cancellation handler: {}",
                        io::Error::last_os_error()
                    ));
                }
                Ok(())
            })
            .clone()
    }

    struct Job(HANDLE);

    impl Job {
        fn create() -> Result<Self, String> {
            // SAFETY: null attributes and name request an unnamed private job.
            let handle = unsafe { CreateJobObjectW(null_mut(), std::ptr::null()) };
            if handle.is_null() {
                return Err(format!(
                    "create Windows job: {}",
                    io::Error::last_os_error()
                ));
            }
            let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            // SAFETY: limits is a valid structure for the selected information class.
            let set = unsafe {
                SetInformationJobObject(
                    handle,
                    JobObjectExtendedLimitInformation,
                    (&mut limits as *mut JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast::<c_void>(),
                    size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                )
            };
            if set == FALSE {
                // SAFETY: handle was returned by CreateJobObjectW and is not shared.
                unsafe { CloseHandle(handle) };
                return Err(format!(
                    "configure Windows job: {}",
                    io::Error::last_os_error()
                ));
            }
            Ok(Self(handle))
        }

        fn active_processes(&self) -> Result<u32, String> {
            let mut accounting = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
            let mut returned = 0;
            // SAFETY: accounting points to writable storage of the documented size and the job
            // handle is owned by this value with query access.
            if unsafe {
                QueryInformationJobObject(
                    self.0,
                    JobObjectBasicAccountingInformation,
                    (&mut accounting as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION)
                        .cast::<c_void>(),
                    size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
                    &mut returned,
                )
            } == FALSE
            {
                return Err(format!(
                    "query Windows job process count: {}",
                    io::Error::last_os_error()
                ));
            }
            Ok(accounting.ActiveProcesses)
        }

        fn wait_empty(&self) -> Result<(), String> {
            let deadline = Instant::now() + Duration::from_secs(5);
            loop {
                if self.active_processes()? == 0 {
                    return Ok(());
                }
                if Instant::now() >= deadline {
                    return Err("wait for Windows job processes to exit timed out".into());
                }
                thread::sleep(Duration::from_millis(2));
            }
        }

        fn stop(&self) -> Result<(), String> {
            if self.active_processes()? == 0 {
                return Ok(());
            }
            // SAFETY: self.0 is a live job handle while Job is held.
            if unsafe { TerminateJobObject(self.0, 1) } == FALSE {
                if self.active_processes()? == 0 {
                    return Ok(());
                }
                return Err(format!(
                    "terminate Windows job: {}",
                    io::Error::last_os_error()
                ));
            }
            self.wait_empty()
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            // KILL_ON_JOB_CLOSE is the crash/unwind fallback for an attached child tree.
            // SAFETY: self.0 is owned by this value and is closed exactly once.
            unsafe { CloseHandle(self.0) };
        }
    }

    pub(super) struct Supervisor {
        job: Job,
        stopped: bool,
    }

    impl Supervisor {
        fn stop(&mut self) -> Result<(), String> {
            if self.stopped {
                return Ok(());
            }
            self.job.stop()?;
            self.stopped = true;
            Ok(())
        }
    }

    impl Drop for Supervisor {
        fn drop(&mut self) {
            let _ = self.stop();
        }
    }

    struct SpawnGuard {
        child: Option<Child>,
        job: Option<Job>,
        assigned: bool,
    }

    impl SpawnGuard {
        fn cleanup(&mut self) -> Result<(), String> {
            let Some(mut child) = self.child.take() else {
                return Ok(());
            };
            let stop = if self.assigned {
                match self.job.as_ref() {
                    Some(job) => match job.stop() {
                        Ok(()) => Ok(()),
                        Err(error) => {
                            // Keep the leader cleanup attempt even if accounting failed. The job
                            // handle remains owned until its drop fallback closes the tree.
                            let fallback =
                                unsafe { TerminateProcess(child.as_raw_handle() as HANDLE, 1) };
                            if fallback == FALSE {
                                Err(format!(
                                    "{error}; terminate leader fallback: {}",
                                    io::Error::last_os_error()
                                ))
                            } else {
                                Err(error)
                            }
                        }
                    },
                    None => Err("assigned child has no Windows job".into()),
                }
            } else {
                // The process is still suspended and outside the job at this point.
                // SAFETY: std::process::Child owns a process handle with terminate access.
                if unsafe { TerminateProcess(child.as_raw_handle() as HANDLE, 1) } == FALSE {
                    let error = io::Error::last_os_error();
                    match child.kill() {
                        Ok(()) => Err(format!("terminate suspended child: {error}")),
                        Err(fallback) => Err(format!(
                            "terminate suspended child: {error}; fallback: {fallback}"
                        )),
                    }
                } else {
                    Ok(())
                }
            };
            let wait = child
                .wait()
                .map(|_| ())
                .map_err(|e| format!("reap suspended child: {e}"));
            if wait.is_ok() {
                stop
            } else {
                let error = match stop {
                    Ok(()) => wait.unwrap_err(),
                    Err(stop) => format!("{stop}; {}", wait.unwrap_err()),
                };
                self.child = Some(child);
                Err(error)
            }
        }

        fn fail(mut self, error: String) -> String {
            match self.cleanup() {
                Ok(()) => error,
                Err(cleanup) => format!("{error}; cleanup failed: {cleanup}"),
            }
        }
    }

    impl Drop for SpawnGuard {
        fn drop(&mut self) {
            if let Err(error) = self.cleanup() {
                eprintln!("spawn cleanup failed: {error}");
            }
        }
    }

    fn primary_thread_id(pid: u32) -> Result<u32, String> {
        // SAFETY: thread snapshots are system-wide and require no target process handle.
        let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) };
        if snapshot == INVALID_HANDLE_VALUE {
            return Err(format!(
                "snapshot child threads: {}",
                io::Error::last_os_error()
            ));
        }
        let result = (|| {
            let mut entry = THREADENTRY32 {
                dwSize: size_of::<THREADENTRY32>() as u32,
                ..Default::default()
            };
            // SAFETY: snapshot is valid and entry points to writable storage of the documented size.
            if unsafe { Thread32First(snapshot, &mut entry) } == FALSE {
                return Err(format!(
                    "enumerate child threads: {}",
                    io::Error::last_os_error()
                ));
            }
            let mut matches = Vec::new();
            loop {
                if entry.th32OwnerProcessID == pid {
                    matches.push(entry.th32ThreadID);
                }
                entry.dwSize = size_of::<THREADENTRY32>() as u32;
                // SAFETY: snapshot and entry remain valid for the enumeration.
                if unsafe { Thread32Next(snapshot, &mut entry) } == FALSE {
                    let error = io::Error::last_os_error();
                    if error.raw_os_error() != Some(ERROR_NO_MORE_FILES as i32) {
                        return Err(format!("continue child thread enumeration: {error}"));
                    }
                    break;
                }
            }
            match matches.as_slice() {
                [thread_id] => Ok(*thread_id),
                [] => Err("suspended child has no discoverable primary thread".into()),
                _ => Err("suspended child has multiple discoverable threads".into()),
            }
        })();
        // SAFETY: snapshot is no longer used after the enumeration closure.
        unsafe { CloseHandle(snapshot) };
        result
    }

    pub(super) fn spawn(command: &mut Command) -> Result<(Child, Supervisor), String> {
        let job = Job::create()?;
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_SUSPENDED);
        let child = match command.spawn() {
            Ok(child) => child,
            Err(error) => return Err(format!("spawn: {error}")),
        };
        let mut guard = SpawnGuard {
            child: Some(child),
            job: Some(job),
            assigned: false,
        };
        let pid = guard.child.as_ref().unwrap().id();
        #[cfg(test)]
        TEST_LAST_SPAWN_PID.store(pid, Ordering::Relaxed);
        #[cfg(test)]
        if TEST_DISCOVERY_FAILURE.swap(false, Ordering::Relaxed) {
            return Err(guard.fail("injected child-thread discovery failure".into()));
        }
        let thread_id = match primary_thread_id(pid) {
            Ok(thread_id) => thread_id,
            Err(error) => return Err(guard.fail(error)),
        };
        // SAFETY: the thread ID came from a snapshot entry owned by this suspended child.
        let thread = unsafe { OpenThread(THREAD_SUSPEND_RESUME, FALSE, thread_id) };
        if thread.is_null() {
            return Err(guard.fail(format!(
                "open suspended child thread: {}",
                io::Error::last_os_error()
            )));
        }
        #[cfg(test)]
        let assign = if TEST_ASSIGNMENT_FAILURE.swap(false, Ordering::Relaxed) {
            FALSE
        } else {
            // SAFETY: both handles are owned by the spawn guard and the process remains suspended.
            unsafe {
                AssignProcessToJobObject(
                    guard.job.as_ref().unwrap().0,
                    guard.child.as_ref().unwrap().as_raw_handle() as HANDLE,
                )
            }
        };
        #[cfg(not(test))]
        let assign = {
            // SAFETY: both handles are owned by the spawn guard and the process remains suspended.
            unsafe {
                AssignProcessToJobObject(
                    guard.job.as_ref().unwrap().0,
                    guard.child.as_ref().unwrap().as_raw_handle() as HANDLE,
                )
            }
        };
        if assign == FALSE {
            // SAFETY: thread is an owned handle opened above.
            unsafe { CloseHandle(thread) };
            return Err(guard.fail(format!(
                "assign child to Windows job: {}",
                io::Error::last_os_error()
            )));
        }
        guard.assigned = true;
        #[cfg(test)]
        if TEST_POST_ASSIGNMENT_FAILURE.swap(false, Ordering::Relaxed) {
            // SAFETY: thread is an owned handle opened above.
            unsafe { CloseHandle(thread) };
            return Err(guard.fail("injected post-assignment failure".into()));
        }
        // SAFETY: thread has THREAD_SUSPEND_RESUME and remains suspended until this call.
        let previous = unsafe { ResumeThread(thread) };
        // SAFETY: thread is no longer needed after ResumeThread returns.
        unsafe { CloseHandle(thread) };
        if previous != 1 {
            return Err(guard.fail(if previous == u32::MAX {
                format!("resume suspended child: {}", io::Error::last_os_error())
            } else {
                format!("resume suspended child returned unexpected count {previous}")
            }));
        }
        let child = guard.child.take().unwrap();
        let supervisor = Supervisor {
            job: guard.job.take().unwrap(),
            stopped: false,
        };
        Ok((child, supervisor))
    }

    pub(super) fn stop(supervisor: &mut Supervisor) -> Result<(), String> {
        supervisor.stop()
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use windows_sys::Win32::System::Threading::{
            OpenProcess, PROCESS_SYNCHRONIZE, WaitForSingleObject,
        };

        #[test]
        fn console_control_event_sets_cancellation_flag() {
            let flag = Arc::new(AtomicUsize::new(0));
            let _ = CONSOLE_FLAG.set(flag.clone());
            // SAFETY: this invokes the same process-owned handler registered with Windows.
            assert_eq!(unsafe { console_handler(CTRL_C_EVENT) }, TRUE);
            assert_eq!(flag.load(std::sync::atomic::Ordering::Relaxed), 2);
        }

        #[test]
        fn pre_resume_failure_terminates_suspended_child() {
            let _lock = test_spawn_lock().lock().unwrap();
            use std::os::windows::process::CommandExt;

            let mut command = Command::new("node.exe");
            command
                .args(["-e", "setInterval(() => {}, 1000)"])
                .creation_flags(CREATE_SUSPENDED);
            let child = command.spawn().unwrap();
            let pid = child.id();
            // SAFETY: the handle is opened only to retain a waitable reference while the guard
            // closes the Child-owned process handle during fail-closed cleanup.
            let wait_handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, FALSE, pid) };
            assert!(!wait_handle.is_null());
            let guard = SpawnGuard {
                child: Some(child),
                job: Some(Job::create().unwrap()),
                assigned: false,
            };
            assert_eq!(
                guard.fail("forced pre-resume failure".into()),
                "forced pre-resume failure"
            );
            // SAFETY: wait_handle is a live process handle with synchronize access.
            assert_eq!(
                unsafe { WaitForSingleObject(wait_handle, 3_000) },
                WAIT_OBJECT_0
            );
            // SAFETY: wait_handle is closed exactly once.
            unsafe { CloseHandle(wait_handle) };
        }
    }
}

#[cfg(all(test, windows))]
mod windows_tests {
    use super::windows::{
        TEST_ASSIGNMENT_FAILURE, TEST_DISCOVERY_FAILURE, TEST_LAST_SPAWN_PID,
        TEST_POST_ASSIGNMENT_FAILURE, test_spawn_lock,
    };
    use super::*;
    use std::{
        fs,
        io::Read,
        path::PathBuf,
        sync::atomic::Ordering,
        thread,
        time::{Duration, SystemTime, UNIX_EPOCH},
    };
    use windows_sys::Win32::{
        Foundation::{CloseHandle, FALSE, WAIT_OBJECT_0},
        System::Threading::{OpenProcess, PROCESS_SYNCHRONIZE, WaitForSingleObject},
    };

    fn temporary_directory(label: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("seshat-{label}-{}-{stamp}", std::process::id()));
        fs::create_dir(&path).unwrap();
        path
    }

    fn wait_for_pid(path: &PathBuf) -> u32 {
        for _ in 0..500 {
            if let Ok(value) = fs::read_to_string(path) {
                if let Ok(pid) = value.trim().parse() {
                    return pid;
                }
            }
            thread::sleep(Duration::from_millis(10));
        }
        panic!("child did not publish its descendant PID");
    }

    fn exited(pid: u32) -> bool {
        // SAFETY: SYNCHRONIZE is sufficient for waiting and the PID came from the child.
        let process = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, FALSE, pid) };
        if process.is_null() {
            return true;
        }
        // SAFETY: process is a live handle returned by OpenProcess.
        let result = unsafe { WaitForSingleObject(process, 3_000) };
        // SAFETY: process is closed exactly once after the wait.
        unsafe { CloseHandle(process) };
        result == WAIT_OBJECT_0
    }

    #[test]
    fn job_contains_immediate_descendant_and_closes_pipes() {
        let _lock = test_spawn_lock().lock().unwrap();
        let directory = temporary_directory("tree path 🎸");
        let pid_file = directory.join("descendant.pid");
        let sentinel = directory.join("sentinel.txt");
        fs::write(&sentinel, "survive\n").unwrap();
        let script = r#"
const fs = require('node:fs');
const {spawn} = require('node:child_process');
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: 'inherit', windowsHide: true});
fs.writeFileSync(process.env.SESHAT_DESCENDANT_PID, String(child.pid));
setInterval(() => {}, 1000);
"#;
        let mut command = Command::new("node.exe");
        command
            .args(["-e", script])
            .env("SESHAT_DESCENDANT_PID", &pid_file)
            .current_dir(&directory)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        let mut sentinel_process = {
            let mut command = Command::new("node.exe");
            command
                .args(["-e", "setInterval(() => {}, 1000)"])
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null());
            ManagedChild::spawn(&mut command).unwrap()
        };
        let descendant = {
            let mut child = ManagedChild::spawn(&mut command).unwrap();
            let pid = wait_for_pid(&pid_file);
            assert!(sentinel.try_exists().unwrap());
            let stdout = child.take_stdout().unwrap();
            let stderr = child.take_stderr().unwrap();
            child.stop_tree().unwrap();
            child.wait().unwrap();
            let mut stdout = stdout;
            let mut stderr = stderr;
            let mut output = Vec::new();
            let mut errors = Vec::new();
            stdout.read_to_end(&mut output).unwrap();
            stderr.read_to_end(&mut errors).unwrap();
            pid
        };
        assert!(exited(descendant));
        assert!(sentinel_process.try_wait().unwrap().is_none());
        sentinel_process.stop_tree().unwrap();
        sentinel_process.wait().unwrap();
        assert_eq!(fs::read_to_string(&sentinel).unwrap(), "survive\n");
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn leader_exit_still_allows_job_cleanup() {
        let _lock = test_spawn_lock().lock().unwrap();
        let directory = temporary_directory("leader-exit");
        let pid_file = directory.join("descendant.pid");
        let script = r#"
const fs = require('node:fs');
const {spawn} = require('node:child_process');
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: 'inherit', windowsHide: true});
fs.writeFileSync(process.env.SESHAT_DESCENDANT_PID, String(child.pid));
process.exit(0);
"#;
        let mut command = Command::new("node.exe");
        command
            .args(["-e", script])
            .env("SESHAT_DESCENDANT_PID", &pid_file)
            .current_dir(&directory)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        let mut child = ManagedChild::spawn(&mut command).unwrap();
        let descendant = wait_for_pid(&pid_file);
        let mut leader_exited = false;
        for _ in 0..500 {
            if child.try_wait().unwrap().is_some() {
                leader_exited = true;
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
        assert!(leader_exited);
        let mut stdout = child.take_stdout().unwrap();
        let mut stderr = child.take_stderr().unwrap();
        child.stop_tree().unwrap();
        child.wait().unwrap();
        assert!(exited(descendant));
        let mut output = Vec::new();
        let mut errors = Vec::new();
        stdout.read_to_end(&mut output).unwrap();
        stderr.read_to_end(&mut errors).unwrap();
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn command_arguments_environment_and_stdio_are_preserved() {
        let _lock = test_spawn_lock().lock().unwrap();
        let mut command = Command::new("node.exe");
        command
            .args([
                "-e",
                "process.stdout.write(process.env.SESHAT_ARG + ':' + process.argv[1]); process.stderr.write('stderr 🎸')",
            ])
            .arg("space 🎸.txt")
            .env("SESHAT_ARG", "value 🎸")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        let mut child = ManagedChild::spawn(&mut command).unwrap();
        let mut stdout = child.take_stdout().unwrap();
        let mut stderr = child.take_stderr().unwrap();
        let mut bytes = Vec::new();
        let mut errors = Vec::new();
        child.wait().unwrap();
        stdout.read_to_end(&mut bytes).unwrap();
        stderr.read_to_end(&mut errors).unwrap();
        child.stop_tree().unwrap();
        assert_eq!(String::from_utf8(bytes).unwrap(), "value 🎸:space 🎸.txt");
        assert_eq!(String::from_utf8(errors).unwrap(), "stderr 🎸");
    }

    #[test]
    fn invalid_executable_does_not_leave_a_suspended_process() {
        let _lock = test_spawn_lock().lock().unwrap();
        let mut command = Command::new("seshat-command-that-does-not-exist.exe");
        assert!(ManagedChild::spawn(&mut command).is_err());
    }

    fn assert_last_spawn_exited() {
        let pid = TEST_LAST_SPAWN_PID.load(Ordering::Relaxed);
        assert_ne!(pid, 0);
        // SAFETY: the PID was recorded immediately after this test's native spawn.
        let process = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, FALSE, pid) };
        assert!(!process.is_null());
        // SAFETY: process is a live handle returned by OpenProcess.
        assert_eq!(
            unsafe { WaitForSingleObject(process, 3_000) },
            WAIT_OBJECT_0
        );
        // SAFETY: process is closed exactly once after the wait.
        unsafe { CloseHandle(process) };
    }

    #[test]
    fn injected_spawn_failures_reap_children_before_and_after_assignment() {
        let _lock = test_spawn_lock().lock().unwrap();
        for (failure, message) in [
            (&TEST_DISCOVERY_FAILURE, "child-thread discovery"),
            (&TEST_ASSIGNMENT_FAILURE, "assign child"),
            (&TEST_POST_ASSIGNMENT_FAILURE, "post-assignment"),
        ] {
            failure.store(true, Ordering::Relaxed);
            let mut command = Command::new("node.exe");
            command.args(["-e", "setInterval(() => {}, 1000)"]);
            let error = match ManagedChild::spawn(&mut command) {
                Ok(_) => panic!("injected spawn failure was ignored"),
                Err(error) => error,
            };
            assert!(error.contains(message), "{error}");
            assert_last_spawn_exited();
        }
    }

    #[test]
    fn repeated_immediate_spawns_are_cleaned() {
        let _lock = test_spawn_lock().lock().unwrap();
        let directory = temporary_directory("repeated-spawn");
        for attempt in 0..4 {
            let pid_file = directory.join(format!("descendant-{attempt}.pid"));
            let script = r#"
const fs = require('node:fs');
const {spawn} = require('node:child_process');
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: 'inherit', windowsHide: true});
fs.writeFileSync(process.env.SESHAT_DESCENDANT_PID, String(child.pid));
setInterval(() => {}, 1000);
"#;
            let mut command = Command::new("node.exe");
            command
                .args(["-e", script])
                .env("SESHAT_DESCENDANT_PID", &pid_file)
                .current_dir(&directory)
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped());
            let mut child = ManagedChild::spawn(&mut command).unwrap();
            let descendant = wait_for_pid(&pid_file);
            child.stop_tree().unwrap();
            child.wait().unwrap();
            assert!(exited(descendant));
        }
        fs::remove_dir_all(directory).unwrap();
    }
}

#[cfg(unix)]
use unix as native;
#[cfg(windows)]
use windows as native;

#[cfg(all(test, unix))]
mod unix_tests {
    use super::*;
    use std::process::Command;

    #[test]
    fn dropping_managed_child_reaps_the_leader() {
        let pid = {
            let mut command = Command::new("sh");
            command.args(["-c", "sleep 60"]);
            let child = ManagedChild::spawn(&mut command).unwrap();
            child.child.id()
        };
        let mut status = 0;
        // ManagedChild::drop must wait for the leader after stopping its process group.
        let result = unsafe { libc::waitpid(pid as i32, &mut status, libc::WNOHANG) };
        assert_eq!(result, -1);
        assert_eq!(
            io::Error::last_os_error().raw_os_error(),
            Some(libc::ECHILD)
        );
    }
}

pub(super) struct ManagedChild {
    supervisor: native::Supervisor,
    child: Child,
}

impl ManagedChild {
    pub(super) fn spawn(command: &mut Command) -> Result<Self, String> {
        let (child, supervisor) = native::spawn(command)?;
        Ok(Self { supervisor, child })
    }

    pub(super) fn take_stdout(&mut self) -> Option<ChildStdout> {
        self.child.stdout.take()
    }

    pub(super) fn take_stderr(&mut self) -> Option<ChildStderr> {
        self.child.stderr.take()
    }

    pub(super) fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
        self.child.try_wait()
    }

    pub(super) fn wait(&mut self) -> io::Result<ExitStatus> {
        self.child.wait()
    }

    pub(super) fn kill_leader(&mut self) -> io::Result<()> {
        self.child.kill()
    }

    pub(super) fn stop_tree(&mut self) -> Result<(), String> {
        native::stop(&mut self.supervisor)
    }

    pub(super) fn kill_tree(&mut self) -> Result<ExitStatus, String> {
        self.stop_tree()?;
        self.wait().map_err(|e| e.to_string())
    }

    pub(super) fn force_cleanup(&mut self) -> Result<(), String> {
        let mut errors = Vec::new();
        if let Err(error) = self.stop_tree() {
            errors.push(format!("stop tree: {error}"));
            if let Err(error) = self.kill_leader() {
                errors.push(format!("terminate leader fallback: {error}"));
            }
        }
        if let Err(error) = self.wait().map(|_| ()).map_err(|e| e.to_string()) {
            errors.push(format!("reap leader: {error}"));
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors.join("; "))
        }
    }
}

impl Drop for ManagedChild {
    fn drop(&mut self) {
        if let Err(error) = self.force_cleanup() {
            eprintln!("managed child cleanup failed: {error}");
        }
    }
}

pub(super) fn install_cancellation(flag: Arc<AtomicUsize>) -> Result<(), String> {
    native::install_cancellation(flag)
}
