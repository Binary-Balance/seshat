use std::{
    io::{self, Write},
    process::{Child, ChildStderr, ChildStdout, Command, ExitStatus},
    sync::{Arc, atomic::AtomicUsize},
    thread,
    time::{Duration, Instant},
};

// Cleanup retries, fallback reaping and Drop share this budget.
const CLEANUP_TIMEOUT: Duration = Duration::from_secs(5);

fn wait_until(child: &mut Child, deadline: Instant) -> io::Result<ExitStatus> {
    loop {
        if let Some(status) = child.try_wait()? {
            return Ok(status);
        }
        if Instant::now() >= deadline {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "cleanup deadline expired; child exit is unconfirmed and processes may remain",
            ));
        }
        thread::sleep(Duration::from_millis(2));
    }
}

#[cfg(unix)]
mod unix {
    use super::*;
    use std::{
        os::unix::process::CommandExt,
        thread,
        time::{Duration, Instant},
    };

    // macOS can report EPERM while an exited group is being reaped. Keep the
    // read-only settlement bounded and preserve EPERM if the group remains.
    const GROUP_SETTLEMENT_TIMEOUT: Duration = Duration::from_millis(100);
    const GROUP_SETTLEMENT_POLL: Duration = Duration::from_millis(2);

    pub(super) struct Supervisor {
        pid: u32,
        stopped: bool,
        released: bool,
        #[cfg(test)]
        fail_next_stop: bool,
        #[cfg(test)]
        stop_attempts: usize,
        #[cfg(test)]
        stop_after_reap: bool,
    }

    impl Supervisor {
        fn new(pid: u32) -> Self {
            Self {
                pid,
                stopped: false,
                released: false,
                #[cfg(test)]
                fail_next_stop: false,
                #[cfg(test)]
                stop_attempts: 0,
                #[cfg(test)]
                stop_after_reap: false,
            }
        }

        fn stop(&mut self) -> Result<(), String> {
            if self.stopped {
                return Ok(());
            }
            if self.released {
                return Err("cannot signal process group after releasing its leader".into());
            }
            #[cfg(test)]
            {
                self.stop_attempts += 1;
                // SAFETY: observe this child into writable storage without consuming its status.
                let mut info = std::mem::MaybeUninit::<libc::siginfo_t>::zeroed();
                let result = unsafe {
                    libc::waitid(
                        libc::P_PID,
                        self.pid,
                        info.as_mut_ptr(),
                        libc::WEXITED | libc::WNOHANG | libc::WNOWAIT,
                    )
                };
                self.stop_after_reap |=
                    result == -1 && io::Error::last_os_error().raw_os_error() == Some(libc::ECHILD);
                if self.fail_next_stop {
                    self.fail_next_stop = false;
                    return Err(
                        "stop owned process group: Operation not permitted (os error 1)".into(),
                    );
                }
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

        fn leader_exited(&mut self) -> io::Result<bool> {
            loop {
                let mut info = std::mem::MaybeUninit::<libc::siginfo_t>::zeroed();
                // SAFETY: info is writable and initialized for WNOHANG's no-status case.
                // WNOWAIT retains the child, preventing PID reuse until group cleanup.
                let result = unsafe {
                    libc::waitid(
                        libc::P_PID,
                        self.pid as libc::id_t,
                        info.as_mut_ptr(),
                        libc::WEXITED | libc::WNOHANG | libc::WNOWAIT,
                    )
                };
                if result == 0 {
                    // SAFETY: waitid succeeded; zero initialization covers no available status.
                    return Ok(unsafe { info.assume_init().si_pid() } != 0);
                }
                let error = io::Error::last_os_error();
                if error.raw_os_error() == Some(libc::ECHILD) {
                    // Ownership is lost if another reaper or SIGCHLD disposition consumed it.
                    self.released = true;
                }
                if error.kind() != io::ErrorKind::Interrupted {
                    return Err(error);
                }
            }
        }

        // Return natural exits only after group cleanup, before std::process reaps the PID.
        pub(super) fn try_wait(&mut self, child: &mut Child) -> io::Result<Option<ExitStatus>> {
            if !self.stopped && !self.released {
                if !self.leader_exited()? {
                    return Ok(None);
                }
                if let Err(error) = self.stop() {
                    return self
                        .settle_after_stop_error(
                            child,
                            error,
                            Instant::now() + GROUP_SETTLEMENT_TIMEOUT,
                        )
                        .map(Some)
                        .map_err(io::Error::other);
                }
            }
            child.try_wait()
        }

        pub(super) fn wait(
            &mut self,
            child: &mut Child,
            deadline: Instant,
        ) -> io::Result<ExitStatus> {
            let result = wait_until(child, deadline);
            // A successful reap or ECHILD releases ownership. A timeout does not:
            // retain the leader so fallback cleanup can still signal the owned group.
            if result.is_ok()
                || result
                    .as_ref()
                    .is_err_and(|error| error.raw_os_error() == Some(libc::ECHILD))
            {
                self.released = true;
            }
            result
        }

        pub(super) fn kill_leader(&mut self, child: &mut Child) -> io::Result<()> {
            if self.released {
                return Err(io::Error::other(
                    "cannot signal child after releasing its ownership",
                ));
            }
            child.kill()
        }

        fn settle_after_stop_error(
            &mut self,
            child: &mut Child,
            stop_error: String,
            cleanup_deadline: Instant,
        ) -> Result<ExitStatus, String> {
            let deadline = cleanup_deadline.min(Instant::now() + GROUP_SETTLEMENT_TIMEOUT);
            // A prior settlement may have reaped the leader. Child caches that status;
            // only the read-only group check remains, with signals still disabled.
            while !self.released
                && !self
                    .leader_exited()
                    .map_err(|e| format!("{stop_error}; observe leader: {e}"))?
            {
                if Instant::now() >= deadline {
                    return Err(stop_error);
                }
                thread::sleep(GROUP_SETTLEMENT_POLL);
            }
            let status = self
                .wait(child, deadline)
                .map_err(|e| format!("{stop_error}; reap leader: {e}"))?;
            loop {
                if owned_group_is_gone(self.pid) {
                    self.stopped = true;
                    return Ok(status);
                }
                if Instant::now() >= deadline {
                    return Err(stop_error);
                }
                thread::sleep(GROUP_SETTLEMENT_POLL);
            }
        }

        #[cfg(test)]
        pub(super) fn test_fail_next_stop(&mut self) {
            self.fail_next_stop = true;
        }

        #[cfg(test)]
        pub(super) fn test_stop_after_reap(&self) -> bool {
            self.stop_after_reap
        }

        #[cfg(test)]
        pub(super) fn test_stop_attempts(&self) -> usize {
            self.stop_attempts
        }
    }

    fn owned_group_is_gone(pid: u32) -> bool {
        let Ok(pid) = i32::try_from(pid) else {
            return false;
        };
        if pid <= 1 {
            return false;
        }
        // SAFETY: signal zero only probes the dedicated process group's existence.
        if unsafe { libc::kill(-pid, 0) } == 0 {
            return false;
        }
        io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH)
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

    pub(super) fn stop(supervisor: &mut Supervisor, _deadline: Instant) -> Result<(), String> {
        supervisor.stop()
    }

    pub(super) fn settle(
        supervisor: &mut Supervisor,
        child: &mut Child,
        stop_error: String,
        deadline: Instant,
    ) -> Result<ExitStatus, String> {
        supervisor.settle_after_stop_error(child, stop_error, deadline)
    }
}

#[cfg(windows)]
mod windows {
    use super::*;
    #[cfg(test)]
    use std::{
        cell::RefCell,
        os::windows::io::{FromRawHandle, OwnedHandle},
        sync::Mutex,
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
    #[cfg(test)]
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_SYNCHRONIZE};
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
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub(super) enum TestFailure {
        Discovery,
        ExtraThread,
        Assignment,
        PostAssignment,
    }

    #[cfg(test)]
    #[derive(Default)]
    struct TestSpawnState {
        failure: Option<TestFailure>,
        wait_handle: HANDLE,
        extra_thread: Option<OwnedHandle>,
    }

    #[cfg(test)]
    thread_local! {
        static TEST_SPAWN_STATE: RefCell<TestSpawnState> = RefCell::new(TestSpawnState::default());
    }

    #[cfg(test)]
    static TEST_SPAWN_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    #[cfg(test)]
    fn test_record_spawn(pid: u32) {
        TEST_SPAWN_STATE.with(|state| {
            let mut state = state.borrow_mut();
            if state.failure.is_some() {
                // SAFETY: the child PID was returned by Command::spawn and the handle is retained
                // until the injecting test waits for cleanup to finish.
                state.wait_handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, FALSE, pid) };
            }
        });
    }

    #[cfg(test)]
    fn test_take_failure(failure: TestFailure) -> bool {
        TEST_SPAWN_STATE.with(|state| {
            let mut state = state.borrow_mut();
            if state.failure == Some(failure) {
                state.failure = None;
                true
            } else {
                false
            }
        })
    }

    #[cfg(test)]
    pub(super) fn test_inject_failure(failure: TestFailure) {
        TEST_SPAWN_STATE.with(|state| state.borrow_mut().failure = Some(failure));
    }

    #[cfg(test)]
    pub(super) fn test_take_spawn_wait_handle() -> HANDLE {
        TEST_SPAWN_STATE.with(|state| {
            let mut state = state.borrow_mut();
            std::mem::replace(&mut state.wait_handle, null_mut())
        })
    }

    #[cfg(test)]
    pub(super) fn test_take_extra_thread() -> OwnedHandle {
        TEST_SPAWN_STATE.with(|state| state.borrow_mut().extra_thread.take().unwrap())
    }

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

    #[cfg(test)]
    thread_local! {
        static TEST_JOB_QUERIES: RefCell<std::collections::VecDeque<Result<u32, i32>>> = RefCell::new(std::collections::VecDeque::new());
        static TEST_JOB_TERMINATION: RefCell<Option<i32>> = const { RefCell::new(None) };
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
                let error = io::Error::last_os_error();
                // SAFETY: handle was returned by CreateJobObjectW and is not shared.
                unsafe { CloseHandle(handle) };
                return Err(format!("configure Windows job: {error}"));
            }
            Ok(Self(handle))
        }

        fn active_processes(&self) -> Result<u32, String> {
            #[cfg(test)]
            if let Some(result) = TEST_JOB_QUERIES.with(|queries| queries.borrow_mut().pop_front())
            {
                // Deliberately overwrite last-error even on successful queries.
                unsafe { windows_sys::Win32::Foundation::SetLastError(6) };
                return result.map_err(|code| {
                    format!(
                        "query Windows job process count: {}",
                        io::Error::from_raw_os_error(code)
                    )
                });
            }
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

        fn wait_empty(&self, deadline: Instant) -> Result<(), String> {
            loop {
                if self.active_processes()? == 0 {
                    return Ok(());
                }
                if Instant::now() >= deadline {
                    return Err("cleanup deadline expired; Windows job exit is unconfirmed and processes may remain".into());
                }
                thread::sleep(Duration::from_millis(2));
            }
        }

        fn terminate(&self) -> io::Result<()> {
            #[cfg(test)]
            if let Some(code) = TEST_JOB_TERMINATION.with(|failure| failure.borrow_mut().take()) {
                return Err(io::Error::from_raw_os_error(code));
            }
            // SAFETY: self.0 is a live, owned job handle.
            if unsafe { TerminateJobObject(self.0, 1) } == FALSE {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        }

        fn stop(&self, deadline: Instant) -> Result<(), String> {
            if self.active_processes()? == 0 {
                return Ok(());
            }
            if let Err(termination) = self.terminate() {
                return match self.active_processes() {
                    Ok(0) => Ok(()),
                    Ok(_) => Err(format!("terminate Windows job: {termination}")),
                    Err(query) => Err(format!("terminate Windows job: {termination}; {query}")),
                };
            }
            self.wait_empty(deadline)
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
        fn stop(&mut self, deadline: Instant) -> Result<(), String> {
            if self.stopped {
                return Ok(());
            }
            self.job.stop(deadline)?;
            self.stopped = true;
            Ok(())
        }
    }

    struct SpawnGuard {
        child: Option<Child>,
        job: Option<Job>,
        assigned: bool,
        cleanup_deadline: Option<Instant>,
    }

    impl SpawnGuard {
        fn cleanup(&mut self) -> Result<(), String> {
            let Some(mut child) = self.child.take() else {
                return Ok(());
            };
            let deadline = *self
                .cleanup_deadline
                .get_or_insert_with(|| Instant::now() + CLEANUP_TIMEOUT);
            let stop = if self.assigned {
                match self.job.as_ref() {
                    Some(job) => match job.stop(deadline) {
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
            let wait = wait_until(&mut child, deadline)
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
                let _ = writeln!(io::stderr().lock(), "spawn cleanup failed: {error}");
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
            cleanup_deadline: None,
        };
        let pid = guard.child.as_ref().unwrap().id();
        #[cfg(test)]
        test_record_spawn(pid);
        #[cfg(test)]
        if test_take_failure(TestFailure::Discovery) {
            return Err(guard.fail("injected child-thread discovery failure".into()));
        }
        #[cfg(test)]
        if test_take_failure(TestFailure::ExtraThread) {
            use windows_sys::Win32::System::Threading::CreateRemoteThread;

            // Reproduce an extra thread without running injected or project code. Windows
            // defers validation of the start address until execution; this thread has no
            // entry point and must remain suspended until process cleanup terminates it.
            // SAFETY: the guard owns this child, and CREATE_SUSPENDED prevents execution.
            let extra_thread = unsafe {
                CreateRemoteThread(
                    guard.child.as_ref().unwrap().as_raw_handle() as HANDLE,
                    std::ptr::null(),
                    0,
                    None,
                    std::ptr::null(),
                    CREATE_SUSPENDED,
                    null_mut(),
                )
            };
            if extra_thread.is_null() {
                return Err(guard.fail(format!(
                    "create extra suspended child thread: {}",
                    io::Error::last_os_error()
                )));
            }
            // SAFETY: CreateRemoteThread returned an owned handle. Keep it for the test
            // to verify termination; OwnedHandle also closes it if an assertion panics.
            let extra_thread = unsafe { OwnedHandle::from_raw_handle(extra_thread) };
            TEST_SPAWN_STATE.with(|state| state.borrow_mut().extra_thread = Some(extra_thread));
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
        let assign = if test_take_failure(TestFailure::Assignment) {
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
            let error = io::Error::last_os_error();
            // SAFETY: thread is an owned handle opened above.
            unsafe { CloseHandle(thread) };
            return Err(guard.fail(format!("assign child to Windows job: {error}")));
        }
        guard.assigned = true;
        #[cfg(test)]
        if test_take_failure(TestFailure::PostAssignment) {
            // SAFETY: thread is an owned handle opened above.
            unsafe { CloseHandle(thread) };
            return Err(guard.fail("injected post-assignment failure".into()));
        }
        // SAFETY: thread has THREAD_SUSPEND_RESUME and remains suspended until this call.
        let previous = unsafe { ResumeThread(thread) };
        let resume_error = io::Error::last_os_error();
        // SAFETY: thread is no longer needed after ResumeThread returns.
        unsafe { CloseHandle(thread) };
        if previous != 1 {
            return Err(guard.fail(if previous == u32::MAX {
                format!("resume suspended child: {resume_error}")
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

    pub(super) fn stop(supervisor: &mut Supervisor, deadline: Instant) -> Result<(), String> {
        supervisor.stop(deadline)
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use windows_sys::Win32::System::Threading::{
            OpenProcess, PROCESS_SYNCHRONIZE, WaitForSingleObject,
        };

        #[test]
        fn job_stop_preserves_termination_and_query_errors() {
            for (queries, termination, expected) in [
                (vec![Err(6)], None, vec!["query Windows job", "os error 6"]),
                (
                    vec![Ok(1), Ok(1)],
                    Some(5),
                    vec!["terminate Windows job", "os error 5"],
                ),
                (
                    vec![Ok(1), Err(6)],
                    Some(5),
                    vec![
                        "terminate Windows job",
                        "os error 5",
                        "query Windows job",
                        "os error 6",
                    ],
                ),
                (vec![Ok(1), Ok(0)], Some(5), vec![]),
            ] {
                TEST_JOB_QUERIES.with(|state| *state.borrow_mut() = queries.into());
                TEST_JOB_TERMINATION.with(|state| *state.borrow_mut() = termination);
                let job = Job::create().unwrap();
                let result = job.stop(Instant::now() + CLEANUP_TIMEOUT);
                if expected.is_empty() {
                    assert!(result.is_ok(), "{result:?}");
                } else {
                    let error = result.unwrap_err();
                    for text in expected {
                        assert!(error.contains(text), "{error}");
                    }
                }
            }
        }

        #[test]
        fn job_exit_wait_obeys_the_existing_deadline() {
            TEST_JOB_QUERIES.with(|state| *state.borrow_mut() = vec![Ok(1); 10].into());
            let job = Job::create().unwrap();
            let error = job.wait_empty(Instant::now()).unwrap_err();
            assert!(error.contains("processes may remain"), "{error}");
            TEST_JOB_QUERIES.with(|state| state.borrow_mut().clear());
        }

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
                cleanup_deadline: None,
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
        TestFailure, test_inject_failure, test_spawn_lock, test_take_extra_thread,
        test_take_spawn_wait_handle,
    };
    use super::*;
    use std::{
        fs,
        io::Read,
        os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
        path::PathBuf,
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
        // The test hook retains this handle before injected cleanup closes the Child-owned handle.
        let process = test_take_spawn_wait_handle();
        assert!(!process.is_null());
        // SAFETY: the hook transfers its owned OpenProcess handle to this test.
        let process = unsafe { OwnedHandle::from_raw_handle(process) };
        // SAFETY: process remains a live handle for the wait, including on assertion failure.
        assert_eq!(
            unsafe { WaitForSingleObject(process.as_raw_handle(), 3_000) },
            WAIT_OBJECT_0
        );
    }

    #[test]
    fn extra_suspended_thread_reproduces_discovery_failure_without_running_child() {
        let _lock = test_spawn_lock().lock().unwrap();
        let directory = temporary_directory("extra-suspended-thread");
        let marker = directory.join("project-ran.txt");
        for _ in 0..4 {
            test_inject_failure(TestFailure::ExtraThread);
            let mut command = Command::new("node.exe");
            command
                .args([
                    "-e",
                    "require('node:fs').writeFileSync(process.env.SESHAT_PROJECT_MARKER, 'ran')",
                ])
                .env("SESHAT_PROJECT_MARKER", &marker);
            let result = ManagedChild::spawn(&mut command);
            // A signaled process handle proves that all its threads have terminated.
            assert_last_spawn_exited();
            let error = match result {
                Ok(_) => panic!("expected multiple-thread discovery failure"),
                Err(error) => error,
            };
            assert_eq!(error, "suspended child has multiple discoverable threads");
            let extra_thread = test_take_extra_thread();
            // SAFETY: the injected thread handle is retained until after this wait.
            assert_eq!(
                unsafe { WaitForSingleObject(extra_thread.as_raw_handle(), 0) },
                WAIT_OBJECT_0
            );
            assert!(
                !marker.try_exists().unwrap(),
                "project code ran before cleanup"
            );
        }
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn injected_spawn_failures_reap_children_before_and_after_assignment() {
        let _lock = test_spawn_lock().lock().unwrap();
        for (failure, message) in [
            (TestFailure::Discovery, "child-thread discovery"),
            (TestFailure::Assignment, "assign child"),
            (TestFailure::PostAssignment, "post-assignment"),
        ] {
            test_inject_failure(failure);
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
    fn kill_tree_settles_stop_error_without_retrying_group_signal() {
        let mut command = Command::new("sh");
        command.args(["-c", "exit 0"]);
        let mut child = ManagedChild::spawn(&mut command).unwrap();
        child.test_fail_next_stop();
        let status = child.kill_tree().unwrap();
        assert_eq!(status.code(), Some(0));
        assert_eq!(child.test_stop_attempts(), 1);
        child.force_cleanup().unwrap();
        assert_eq!(child.test_stop_attempts(), 1);
    }

    #[test]
    fn natural_exit_never_signals_a_released_process_group() {
        let mut command = Command::new("sh");
        command.args(["-c", "exit 7"]);
        let mut child = ManagedChild::spawn(&mut command).unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            if let Some(status) = child.try_wait().unwrap() {
                assert_eq!(status.code(), Some(7));
                break;
            }
            assert!(std::time::Instant::now() < deadline);
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        child.force_cleanup().unwrap();
        child.force_cleanup().unwrap();
        assert!(
            !child.supervisor.test_stop_after_reap(),
            "group signal attempted after the leader's PID was released"
        );
    }

    #[test]
    fn stop_failure_can_retry_while_the_leader_is_retained() {
        let mut command = Command::new("sh");
        command.args(["-c", "exec sleep 60"]);
        let mut child = ManagedChild::spawn(&mut command).unwrap();
        child.test_fail_next_stop();
        assert!(child.kill_tree().is_err());
        child.force_cleanup().unwrap();
        assert_eq!(child.test_stop_attempts(), 2);
        assert!(!child.supervisor.test_stop_after_reap());
    }

    #[test]
    fn failed_settlement_never_retries_signals_after_reaping() {
        use std::os::unix::process::CommandExt;
        // This member is our direct child, so its guard can safely kill/reap it even
        // if an assertion fails after the tested supervisor has released ownership.
        struct Member(Child);
        impl Drop for Member {
            fn drop(&mut self) {
                let _ = self.0.kill();
                let _ = self.0.wait();
            }
        }
        let mut command = Command::new("sh");
        command.args(["-c", "exec sleep 60"]);
        let mut child = ManagedChild::spawn(&mut command).unwrap();
        let mut member_command = Command::new("sh");
        member_command
            .args(["-c", "exec sleep 60"])
            .process_group(child.child.id().try_into().unwrap());
        let mut member = Member(member_command.spawn().unwrap());
        child.kill_leader().unwrap();
        child.test_fail_next_stop();
        // The leader exits, but this live group member prevents read-only settlement.
        assert!(child.kill_tree().is_err());
        assert!(child.force_cleanup().is_err());
        assert!(child.force_cleanup().is_err());
        assert_eq!(child.test_stop_attempts(), 1);
        assert!(!child.supervisor.test_stop_after_reap());
        assert!(member.0.try_wait().unwrap().is_none());
        member.0.kill().unwrap();
        member.0.wait().unwrap();
        child.force_cleanup().unwrap();
        assert_eq!(child.test_stop_attempts(), 1);
        assert!(!child.supervisor.test_stop_after_reap());
    }

    #[test]
    fn lost_child_ownership_prevents_cleanup_signals() {
        let mut command = Command::new("sh");
        command.args(["-c", "exit 0"]);
        let mut child = ManagedChild::spawn(&mut command).unwrap();
        // Simulate an unexpected reaper without needing PID churn or another process.
        let mut status = 0;
        // SAFETY: this child belongs to the test; consume its status outside Child.
        assert_eq!(
            unsafe { libc::waitpid(child.child.id() as i32, &mut status, 0) },
            child.child.id() as i32
        );
        assert_eq!(
            child.try_wait().unwrap_err().raw_os_error(),
            Some(libc::ECHILD)
        );
        assert!(child.force_cleanup().is_err());
        assert_eq!(child.test_stop_attempts(), 0);
    }

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
    cleanup_deadline: Option<Instant>,
}

impl ManagedChild {
    pub(super) fn spawn(command: &mut Command) -> Result<Self, String> {
        let (child, supervisor) = native::spawn(command)?;
        Ok(Self {
            supervisor,
            child,
            cleanup_deadline: None,
        })
    }

    pub(super) fn take_stdout(&mut self) -> Option<ChildStdout> {
        self.child.stdout.take()
    }

    pub(super) fn take_stderr(&mut self) -> Option<ChildStderr> {
        self.child.stderr.take()
    }

    pub(super) fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
        #[cfg(unix)]
        {
            self.supervisor.try_wait(&mut self.child)
        }
        #[cfg(windows)]
        {
            self.child.try_wait()
        }
    }

    fn cleanup_deadline(&mut self) -> Instant {
        *self
            .cleanup_deadline
            .get_or_insert_with(|| Instant::now() + CLEANUP_TIMEOUT)
    }

    pub(super) fn wait(&mut self) -> io::Result<ExitStatus> {
        let deadline = self.cleanup_deadline();
        #[cfg(unix)]
        {
            self.supervisor.wait(&mut self.child, deadline)
        }
        #[cfg(windows)]
        {
            wait_until(&mut self.child, deadline)
        }
    }

    pub(super) fn kill_leader(&mut self) -> io::Result<()> {
        #[cfg(unix)]
        {
            self.supervisor.kill_leader(&mut self.child)
        }
        #[cfg(windows)]
        {
            self.child.kill()
        }
    }

    pub(super) fn stop_tree(&mut self) -> Result<(), String> {
        let deadline = self.cleanup_deadline();
        native::stop(&mut self.supervisor, deadline)
    }

    fn settle_after_stop_error(&mut self, error: String) -> Result<ExitStatus, String> {
        #[cfg(unix)]
        {
            let deadline = self.cleanup_deadline();
            native::settle(&mut self.supervisor, &mut self.child, error, deadline)
        }
        #[cfg(windows)]
        {
            Err(error)
        }
    }

    pub(super) fn stop_tree_with_settlement(&mut self) -> Result<(), String> {
        match self.stop_tree() {
            Ok(()) => Ok(()),
            Err(error) => self.settle_after_stop_error(error).map(|_| ()),
        }
    }

    #[cfg(all(test, unix))]
    fn test_fail_next_stop(&mut self) {
        self.supervisor.test_fail_next_stop();
    }

    #[cfg(all(test, unix))]
    fn test_stop_attempts(&self) -> usize {
        self.supervisor.test_stop_attempts()
    }

    pub(super) fn kill_tree(&mut self) -> Result<ExitStatus, String> {
        match self.stop_tree() {
            Ok(()) => self.wait().map_err(|e| e.to_string()),
            Err(error) => {
                #[cfg(unix)]
                {
                    self.settle_after_stop_error(error)
                }
                #[cfg(windows)]
                {
                    match self
                        .try_wait()
                        .map_err(|e| format!("{error}; observe leader: {e}"))?
                    {
                        Some(status) => {
                            self.stop_tree()
                                .map_err(|retry| format!("{error}; retry cleanup: {retry}"))?;
                            Ok(status)
                        }
                        None => Err(error),
                    }
                }
            }
        }
    }

    pub(super) fn force_cleanup(&mut self) -> Result<(), String> {
        let mut errors = Vec::new();
        if let Err(error) = self.stop_tree_with_settlement() {
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
            let _ = writeln!(io::stderr().lock(), "managed child cleanup failed: {error}");
        }
    }
}

pub(super) fn install_cancellation(flag: Arc<AtomicUsize>) -> Result<(), String> {
    native::install_cancellation(flag)
}

#[cfg(test)]
mod cleanup_tests {
    use super::*;

    #[test]
    fn reap_deadline_preserves_uncertainty_and_is_not_restarted() {
        let mut command = Command::new("node");
        command.args(["-e", "setInterval(()=>{},1000)"]);
        let mut child = ManagedChild::spawn(&mut command).unwrap();
        let deadline = Instant::now() + Duration::from_millis(20);
        child.cleanup_deadline = Some(deadline);
        let error = child.wait().unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        assert!(error.to_string().contains("processes may remain"));
        assert!(child.child.try_wait().unwrap().is_none());
        let start = Instant::now();
        assert_eq!(child.wait().unwrap_err().kind(), io::ErrorKind::TimedOut);
        assert!(start.elapsed() < Duration::from_millis(100));
        assert_eq!(child.cleanup_deadline, Some(deadline));
        // Release the real owned fixture even though its deliberately short budget expired.
        child.stop_tree().ok();
        child.child.kill().ok();
        wait_until(&mut child.child, Instant::now() + CLEANUP_TIMEOUT).unwrap();
        child.force_cleanup().unwrap();
        let start = Instant::now();
        drop(child);
        assert!(start.elapsed() < Duration::from_millis(100));
    }
}
