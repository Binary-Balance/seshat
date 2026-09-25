//! The runner's Windows launch contract: inherited environment plus edits, ordinary
//! arguments, optional cwd, null stdin and two captured output pipes. Other Command
//! settings (env_clear, raw_arg, custom stdio/creation flags) are not accepted inputs.
//!
//! Argument escaping and executable search follow Rust 1.98.1's Windows process
//! implementation. Adapted from library/std/src/sys/{args,process,path}/windows.rs:
//! https://github.com/rust-lang/rust/tree/1.98.1/library/std/src/sys
//! Copyright The Rust Project Developers. Upstream is MIT OR Apache-2.0.
//! See packaging/runtime-notices/rust-1.98.1/COPYRIGHT-library.html and licenses/
//! for the retained notices, also included in packaged THIRD_PARTY_NOTICES.txt.

use std::{
    cmp::Ordering,
    ffi::{OsStr, OsString},
    io,
    mem::size_of,
    os::windows::{
        ffi::{OsStrExt, OsStringExt},
        io::{AsRawHandle, FromRawHandle, OwnedHandle, RawHandle},
        process::ExitStatusExt,
    },
    path::{Path, PathBuf},
    process::{ChildStderr, ChildStdout, Command, ExitStatus},
    ptr::{null, null_mut},
};
use windows_sys::Win32::{
    Foundation::{
        FALSE, GENERIC_READ, HANDLE, HANDLE_FLAG_INHERIT, INVALID_HANDLE_VALUE,
        SetHandleInformation, TRUE, WAIT_OBJECT_0, WAIT_TIMEOUT,
    },
    Globalization::CompareStringOrdinal,
    Security::SECURITY_ATTRIBUTES,
    Storage::FileSystem::{
        CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ, FILE_SHARE_WRITE, GetFileAttributesW,
        GetFullPathNameW, INVALID_FILE_ATTRIBUTES, OPEN_EXISTING,
    },
    System::{
        Pipes::CreatePipe,
        SystemInformation::{GetSystemDirectoryW, GetWindowsDirectoryW},
        Threading::{
            CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT, CreateProcessW,
            DeleteProcThreadAttributeList, EXTENDED_STARTUPINFO_PRESENT, GetExitCodeProcess,
            InitializeProcThreadAttributeList, LPPROC_THREAD_ATTRIBUTE_LIST,
            PROC_THREAD_ATTRIBUTE_HANDLE_LIST, PROCESS_INFORMATION, STARTF_USESTDHANDLES,
            STARTUPINFOEXW, TerminateProcess, UpdateProcThreadAttribute, WaitForSingleObject,
        },
    },
};

// UTF-16 ASCII units used by Windows path and command-line syntax.
const BACKSLASH: u16 = b'\\' as u16;
const SLASH: u16 = b'/' as u16;
const QUESTION: u16 = b'?' as u16;
const COLON: u16 = b':' as u16;
const U: u16 = b'U' as u16;
const N: u16 = b'N' as u16;
const C: u16 = b'C' as u16;
const DOT: u16 = b'.' as u16;
const QUOTE: u16 = b'"' as u16;
const SPACE: u16 = b' ' as u16;
const TAB: u16 = b'\t' as u16;
const LF: u16 = b'\n' as u16;
const CR: u16 = b'\r' as u16;
const PERCENT: u16 = b'%' as u16;
const EQUALS: u16 = b'=' as u16;

pub(super) struct Child {
    process: OwnedHandle,
    #[cfg(test)]
    pid: u32,
    pub(super) stdout: Option<ChildStdout>,
    pub(super) stderr: Option<ChildStderr>,
}

impl AsRawHandle for Child {
    fn as_raw_handle(&self) -> RawHandle {
        self.process.as_raw_handle()
    }
}

impl Child {
    #[cfg(test)]
    pub(super) fn id(&self) -> u32 {
        self.pid
    }

    pub(super) fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
        // SAFETY: the process handle is owned for both read-only queries.
        match unsafe { WaitForSingleObject(self.as_raw_handle(), 0) } {
            WAIT_TIMEOUT => Ok(None),
            WAIT_OBJECT_0 => {
                let mut code = 0;
                check(unsafe { GetExitCodeProcess(self.as_raw_handle(), &mut code) })?;
                Ok(Some(ExitStatus::from_raw(code)))
            }
            _ => Err(io::Error::last_os_error()),
        }
    }

    pub(super) fn kill(&mut self) -> io::Result<()> {
        // SAFETY: this handle belongs exclusively to the runner's child.
        if unsafe { TerminateProcess(self.as_raw_handle(), 1) } == FALSE {
            let error = io::Error::last_os_error();
            if self.try_wait()?.is_none() {
                return Err(error);
            }
        }
        Ok(())
    }
}

fn check(result: i32) -> io::Result<()> {
    if result == FALSE {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn wide(value: &OsStr) -> io::Result<Vec<u16>> {
    let mut value: Vec<_> = value.encode_wide().collect();
    if value.contains(&0) {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "embedded NUL"));
    }
    value.push(0);
    Ok(value)
}

fn wide_buffer(mut fill: impl FnMut(*mut u16, u32) -> u32) -> io::Result<Vec<u16>> {
    let mut buffer = vec![0; 260];
    loop {
        let size = fill(buffer.as_mut_ptr(), buffer.len() as u32) as usize;
        if size == 0 {
            return Err(io::Error::last_os_error());
        }
        if size < buffer.len() {
            buffer.truncate(size);
            return Ok(buffer);
        }
        buffer.resize(size + 1, 0);
    }
}

fn full_path(path: &[u16]) -> io::Result<Vec<u16>> {
    // SAFETY: path is NUL terminated and wide_buffer supplies writable storage.
    wide_buffer(|buffer, size| unsafe { GetFullPathNameW(path.as_ptr(), size, buffer, null_mut()) })
}

fn strip_verbatim(mut path: Vec<u16>) -> io::Result<Vec<u16>> {
    // cmd.exe and the process cwd need the ordinary form, but converting must
    // not change verbatim path semantics, such as literal trailing dots.
    let candidate = if path.starts_with(&[
        BACKSLASH, BACKSLASH, QUESTION, BACKSLASH, U, N, C, BACKSLASH,
    ]) {
        Some([vec![BACKSLASH, BACKSLASH], path[8..].to_vec()].concat())
    } else if path.starts_with(&[BACKSLASH, BACKSLASH, QUESTION, BACKSLASH])
        && path.get(5) == Some(&COLON)
        && path.get(6) == Some(&BACKSLASH)
    {
        Some(path[4..].to_vec())
    } else {
        None
    };
    if let Some(candidate) = candidate {
        if full_path(&candidate)? == candidate[..candidate.len() - 1] {
            path = candidate;
        }
    }
    Ok(path)
}

fn user_path(path: &Path) -> io::Result<Vec<u16>> {
    let path = wide(path.as_os_str())?;
    if path.len() > 260 {
        return Ok(path);
    }
    if path.starts_with(&[BACKSLASH, BACKSLASH, QUESTION, BACKSLASH]) {
        return strip_verbatim(path);
    }
    if path.starts_with(&[BACKSLASH, QUESTION, QUESTION, BACKSLASH]) || path == [0] {
        return Ok(path);
    }
    if path.len() < 248 {
        match path.as_slice() {
            [drive, COLON, 0] | [drive, COLON, BACKSLASH | SLASH, ..]
                if !matches!(*drive, BACKSLASH | SLASH) =>
            {
                return Ok(path);
            }
            [BACKSLASH | SLASH, BACKSLASH | SLASH, ..] => return Ok(path),
            _ => {}
        }
    }
    let absolute = full_path(&path)?;
    let (prefix, absolute) = if absolute.len() + 1 >= 248 {
        match absolute.as_slice() {
            [_, COLON, BACKSLASH, ..] => (
                &[BACKSLASH, BACKSLASH, QUESTION, BACKSLASH][..],
                absolute.as_slice(),
            ),
            [BACKSLASH, BACKSLASH, DOT, BACKSLASH, rest @ ..] => {
                (&[BACKSLASH, BACKSLASH, QUESTION, BACKSLASH][..], rest)
            }
            [BACKSLASH, BACKSLASH, QUESTION, BACKSLASH, ..]
            | [BACKSLASH, QUESTION, QUESTION, BACKSLASH, ..] => (&[][..], absolute.as_slice()),
            [BACKSLASH, BACKSLASH, rest @ ..] => (
                &[
                    BACKSLASH, BACKSLASH, QUESTION, BACKSLASH, U, N, C, BACKSLASH,
                ][..],
                rest,
            ),
            _ => (&[][..], absolute.as_slice()),
        }
    } else {
        (&[][..], absolute.as_slice())
    };
    Ok(prefix.iter().chain(absolute).copied().chain([0]).collect())
}

fn exists(path: &Path) -> Option<Vec<u16>> {
    let path = user_path(path).ok()?;
    // SAFETY: path is NUL terminated. Like std, test the link itself, not its target.
    (unsafe { GetFileAttributesW(path.as_ptr()) } != INVALID_FILE_ATTRIBUTES).then_some(path)
}

fn resolve_program(command: &Command) -> io::Result<Vec<u16>> {
    let program = command.get_program();
    let encoded = wide(program)?;
    if program.is_empty()
        || matches!(
            encoded.get(encoded.len() - 2).copied(),
            Some(SLASH | BACKSLASH)
        )
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "program path has no file name",
        ));
    }
    let name = program.as_encoded_bytes();
    // A drive prefix, slash or backslash makes this a path, not a PATH lookup.
    if name.iter().any(|byte| b"/\\:".contains(byte)) {
        if name.len() >= 4 && name[name.len() - 4..].eq_ignore_ascii_case(b".exe") {
            return user_path(Path::new(program));
        }
        let mut exe = program.to_os_string();
        exe.push(".exe");
        if let Some(exe) = exists(Path::new(&exe)) {
            return Ok(exe);
        }
        return user_path(Path::new(program));
    }
    let child_path = command
        .get_envs()
        .find_map(|(key, value)| {
            key.as_encoded_bytes()
                .eq_ignore_ascii_case(b"PATH")
                .then_some(value)
        })
        .flatten();
    let mut directories = Vec::new();
    if let Some(path) = child_path {
        directories.extend(std::env::split_paths(path).filter(|path| !path.as_os_str().is_empty()));
    }
    if let Ok(mut path) = std::env::current_exe() {
        path.pop();
        directories.push(path);
    }
    for directory in [GetSystemDirectoryW, GetWindowsDirectoryW] {
        // SAFETY: wide_buffer supplies writable storage and the documented capacity.
        if let Ok(path) = wide_buffer(|buffer, size| unsafe { directory(buffer, size) }) {
            directories.push(PathBuf::from(OsString::from_wide(&path)));
        }
    }
    if let Some(path) = std::env::var_os("PATH") {
        directories
            .extend(std::env::split_paths(&path).filter(|path| !path.as_os_str().is_empty()));
    }
    for directory in directories {
        let mut path = directory.join(program);
        if !name.contains(&b'.') {
            path.set_extension("exe");
        }
        if let Some(path) = exists(&path) {
            return Ok(path);
        }
    }
    Err(io::Error::new(io::ErrorKind::NotFound, "program not found"))
}

fn append_arg(line: &mut Vec<u16>, arg: &OsStr, batch: bool) -> io::Result<()> {
    let units = wide(arg)?;
    let units = &units[..units.len() - 1];
    let quote = if batch {
        if units.iter().any(|unit| matches!(*unit, LF | CR)) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "batch file arguments are invalid",
            ));
        }
        units.is_empty()
            || units.last() == Some(&BACKSLASH)
            || units.iter().any(|&unit| {
                char::from_u32(unit as u32).is_some_and(|ch| {
                    ch.is_control()
                        || ch.is_ascii()
                            && !(ch.is_ascii_alphanumeric() || r"#$*+-./:?@\_".contains(ch))
                })
            })
    } else {
        units.is_empty() || units.iter().any(|unit| matches!(*unit, TAB | SPACE))
    };
    if quote {
        line.push(QUOTE);
    }
    let mut backslashes = 0;
    for &unit in units {
        if unit == BACKSLASH {
            backslashes += 1;
        } else {
            if unit == QUOTE {
                line.extend(std::iter::repeat_n(
                    BACKSLASH,
                    backslashes + usize::from(!batch),
                ));
                if batch {
                    line.push(QUOTE);
                }
            } else if batch && unit == PERCENT {
                // Rust's batch escaping prevents cmd.exe from expanding %VARIABLE%.
                line.extend("%%cd:~,".encode_utf16());
            }
            backslashes = 0;
        }
        line.push(unit);
    }
    if quote {
        line.extend(std::iter::repeat_n(BACKSLASH, backslashes));
        line.push(QUOTE);
    }
    Ok(())
}

fn command_line(command: &Command, program: &[u16]) -> io::Result<(Vec<u16>, Vec<u16>)> {
    // Normalize before deciding whether cmd.exe is needed: Windows also treats
    // names such as "runner.cmd." as batch files.
    let resolved = if program.starts_with(&[BACKSLASH, BACKSLASH, QUESTION, BACKSLASH]) {
        program[..program.len() - 1].to_vec()
    } else {
        full_path(program)?
    };
    let resolved = OsString::from_wide(&resolved);
    let name = resolved.as_encoded_bytes();
    let extension = &name[name.len().saturating_sub(4)..];
    let batch = extension.eq_ignore_ascii_case(b".bat") || extension.eq_ignore_ascii_case(b".cmd");
    let (application, mut line) = if batch {
        if program.contains(&QUOTE) || program.get(program.len() - 2) == Some(&BACKSLASH) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "invalid batch file name",
            ));
        }
        // SAFETY: wide_buffer supplies valid storage. Ignore COMSPEC, as std does.
        let mut cmd = wide_buffer(|buffer, size| unsafe { GetSystemDirectoryW(buffer, size) })?;
        cmd.extend("\\cmd.exe\0".encode_utf16());
        let mut line: Vec<_> = "cmd.exe /e:ON /v:OFF /d /c \"\"".encode_utf16().collect();
        line.extend_from_slice(&program[..program.len() - 1]);
        line.push(QUOTE);
        (cmd, line)
    } else {
        let mut line = vec![QUOTE];
        let argv0 = wide(command.get_program())?;
        line.extend_from_slice(&argv0[..argv0.len() - 1]);
        line.push(QUOTE);
        (program.to_vec(), line)
    };
    for arg in command.get_args() {
        line.push(SPACE);
        append_arg(&mut line, arg, batch)?;
    }
    if batch {
        line.push(QUOTE);
    }
    line.push(0);
    Ok((application, line))
}

fn compare_keys(left: &[u16], right: &[u16]) -> Ordering {
    // SAFETY: both slices remain live and their explicit lengths exclude any terminator.
    match unsafe {
        CompareStringOrdinal(
            left.as_ptr(),
            left.len() as i32,
            right.as_ptr(),
            right.len() as i32,
            TRUE,
        )
    } {
        1 => Ordering::Less,
        2 => Ordering::Equal,
        3 => Ordering::Greater,
        _ => panic!(
            "compare Windows environment keys: {}",
            io::Error::last_os_error()
        ),
    }
}

fn environment(command: &Command) -> io::Result<Vec<u16>> {
    if command.get_envs().next().is_none() {
        return Ok(Vec::new());
    }
    let mut values: Vec<_> = std::env::vars_os()
        .map(|(key, value)| (key.encode_wide().collect::<Vec<_>>(), value))
        .collect();
    for (key, value) in command.get_envs() {
        let key = wide(key)?;
        let key = &key[..key.len() - 1];
        if key.is_empty() || key.contains(&EQUALS) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "invalid environment variable name",
            ));
        }
        // ponytail: linear edits suit the small runner environment; use a key map if this grows.
        values.retain(|(old, _)| compare_keys(old, key) != Ordering::Equal);
        if let Some(value) = value {
            values.push((key.to_vec(), value.to_os_string()));
        }
    }
    values.sort_by(|(left, _), (right, _)| compare_keys(left, right));
    let mut block = Vec::new();
    for (key, value) in values {
        block.extend(key);
        block.push(EQUALS);
        block.extend(wide(&value)?);
    }
    if block.is_empty() {
        block.push(0);
    }
    block.push(0);
    Ok(block)
}

fn output_pipe(attributes: &SECURITY_ATTRIBUTES) -> io::Result<(OwnedHandle, OwnedHandle)> {
    let (mut reader, mut writer) = (null_mut(), null_mut());
    // SAFETY: both output slots and the inheritable security attributes are valid.
    check(unsafe { CreatePipe(&mut reader, &mut writer, attributes, 0) })?;
    // SAFETY: successful CreatePipe transfers both distinct synchronous pipe handles.
    let reader = unsafe { OwnedHandle::from_raw_handle(reader) };
    let writer = unsafe { OwnedHandle::from_raw_handle(writer) };
    // The child inherits only the write end, so the parent can observe EOF.
    check(unsafe { SetHandleInformation(reader.as_raw_handle(), HANDLE_FLAG_INHERIT, 0) })?;
    Ok((reader, writer))
}

struct AttributeList(Vec<usize>);

impl AttributeList {
    fn as_ptr(&mut self) -> LPPROC_THREAD_ATTRIBUTE_LIST {
        self.0.as_mut_ptr().cast()
    }

    fn new(handles: &[HANDLE]) -> io::Result<Self> {
        let mut size = 0;
        // SAFETY: a null list requests the required size, returning insufficient-buffer.
        unsafe { InitializeProcThreadAttributeList(null_mut(), 1, 0, &mut size) };
        if size == 0 {
            return Err(io::Error::last_os_error());
        }
        let mut storage = vec![0usize; size.div_ceil(size_of::<usize>())];
        // SAFETY: storage is aligned and sized for the requested attribute list.
        check(unsafe {
            InitializeProcThreadAttributeList(storage.as_mut_ptr().cast(), 1, 0, &mut size)
        })?;
        let mut list = Self(storage);
        // SAFETY: the list is initialized and handles remain alive through CreateProcessW.
        check(unsafe {
            UpdateProcThreadAttribute(
                list.as_ptr(),
                0,
                PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize,
                handles.as_ptr().cast(),
                std::mem::size_of_val(handles),
                null_mut(),
                null(),
            )
        })?;
        Ok(list)
    }
}

impl Drop for AttributeList {
    fn drop(&mut self) {
        // SAFETY: only successfully initialized lists reach this destructor.
        unsafe { DeleteProcThreadAttributeList(self.as_ptr()) };
    }
}

pub(super) fn spawn_suspended(command: &Command) -> io::Result<(Child, OwnedHandle)> {
    let program = resolve_program(command)?;
    let (application, mut line) = command_line(command, &program)?;
    let environment = environment(command)?;
    let directory = command
        .get_current_dir()
        .map(|path| strip_verbatim(wide(path.as_os_str())?))
        .transpose()?;
    let attributes = SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: null_mut(),
        bInheritHandle: TRUE,
    };
    let (stdout, stdout_child) = output_pipe(&attributes)?;
    let (stderr, stderr_child) = output_pipe(&attributes)?;
    // SAFETY: the NUL path is terminated and the attributes request an inherited handle.
    let stdin = unsafe {
        CreateFileW(
            wide(OsStr::new(r"\\.\NUL"))?.as_ptr(),
            GENERIC_READ,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            &attributes,
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            null_mut(),
        )
    };
    if stdin == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: CreateFileW transferred this handle.
    let stdin = unsafe { OwnedHandle::from_raw_handle(stdin) };
    let handles = [
        stdin.as_raw_handle(),
        stdout_child.as_raw_handle(),
        stderr_child.as_raw_handle(),
    ];
    let mut list = AttributeList::new(&handles)?;
    let mut startup = STARTUPINFOEXW::default();
    startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = handles[0];
    startup.StartupInfo.hStdOutput = handles[1];
    startup.StartupInfo.hStdError = handles[2];
    startup.lpAttributeList = list.as_ptr();
    let mut info = PROCESS_INFORMATION::default();
    // SAFETY: strings, environment, handle list and stdio owners outlive this call.
    // The primary thread cannot execute until the caller assigns the Job and resumes it.
    check(unsafe {
        CreateProcessW(
            application.as_ptr(),
            line.as_mut_ptr(),
            null(),
            null(),
            TRUE,
            CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT,
            if environment.is_empty() {
                null()
            } else {
                environment.as_ptr().cast()
            },
            directory.as_ref().map_or(null(), |path| path.as_ptr()),
            &startup.StartupInfo,
            &mut info,
        )
    })?;
    // No fallible operations may occur between creation and transfer to SpawnGuard.
    // SAFETY: CreateProcessW returned distinct, exclusively owned process/thread handles;
    // the pipe readers were created synchronously, as ChildStdout/Stderr require.
    Ok(unsafe {
        (
            Child {
                process: OwnedHandle::from_raw_handle(info.hProcess),
                #[cfg(test)]
                pid: info.dwProcessId,
                stdout: Some(ChildStdout::from(stdout)),
                stderr: Some(ChildStderr::from(stderr)),
            },
            OwnedHandle::from_raw_handle(info.hThread),
        )
    })
}
