// Bounded process jobs for captured projects and proof sessions. No shell interpretation.
use serde_json::{Value, json};
#[cfg(unix)]
use std::os::fd::AsRawFd as PipeHandle;
#[cfg(windows)]
use std::os::windows::io::AsRawHandle as PipeHandle;
use std::{
    io::{self, Read},
    process::Command,
    thread,
    time::{Duration, Instant},
};

const STREAM_LIMIT: usize = 2 * 1024 * 1024;
const DRAIN_TIMEOUT: Duration = Duration::from_millis(500);

// One reader owns each pipe. Polling keeps partial output available and lets us close
// our read handles even when a detached descendant retains a write handle.
struct Output<P> {
    pipe: Option<P>,
    bytes: Vec<u8>,
    overflow: bool,
    error: Option<String>,
}

impl<P: Read + PipeHandle> Output<P> {
    fn new(pipe: P) -> io::Result<Self> {
        #[cfg(unix)]
        {
            let fd = pipe.as_raw_fd();
            // SAFETY: fd is the live, exclusively owned read end of this output pipe.
            let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
            if flags == -1
                || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } == -1
            {
                return Err(io::Error::last_os_error());
            }
        }
        Ok(Self {
            pipe: Some(pipe),
            bytes: Vec::new(),
            overflow: false,
            error: None,
        })
    }

    fn drain(&mut self) {
        let mut buffer = [0; 16384];
        while let Some(pipe) = self.pipe.as_mut() {
            let limit = buffer.len().min(STREAM_LIMIT + 1 - self.bytes.len());
            match read_available(pipe, &mut buffer[..limit]) {
                Ok(0) => {
                    self.pipe = None;
                }
                Ok(count) => {
                    self.bytes.extend_from_slice(&buffer[..count]);
                    if self.bytes.len() > STREAM_LIMIT {
                        self.bytes.truncate(STREAM_LIMIT);
                        self.overflow = true;
                        self.pipe = None;
                    }
                }
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => break,
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                Err(error) => {
                    self.error = Some(error.to_string());
                    self.pipe = None;
                }
            }
        }
    }

    fn finish(&mut self) {
        if self.pipe.take().is_some() {
            self.error = Some("output pipe did not close after stopping the process tree".into());
        }
    }
}

#[cfg(unix)]
fn read_available(pipe: &mut (impl Read + PipeHandle), buffer: &mut [u8]) -> io::Result<usize> {
    pipe.read(buffer)
}

#[cfg(windows)]
fn read_available(pipe: &mut (impl Read + PipeHandle), buffer: &mut [u8]) -> io::Result<usize> {
    use windows_sys::Win32::{Foundation::ERROR_BROKEN_PIPE, System::Pipes::PeekNamedPipe};
    let mut available = 0;
    // SAFETY: the handle is a live pipe read end, and available is writable. With
    // one reader, bytes observed here remain available for the following read.
    if unsafe {
        PeekNamedPipe(
            pipe.as_raw_handle(),
            std::ptr::null_mut(),
            0,
            std::ptr::null_mut(),
            &mut available,
            std::ptr::null_mut(),
        )
    } == 0
    {
        let error = io::Error::last_os_error();
        return if error.raw_os_error() == Some(ERROR_BROKEN_PIPE as i32) {
            Ok(0)
        } else {
            Err(error)
        };
    }
    if available == 0 {
        return Err(io::ErrorKind::WouldBlock.into());
    }
    let count = buffer.len().min(available as usize);
    pipe.read(&mut buffer[..count])
}

pub(super) fn run(command: &mut Command, timeout: Duration) -> Result<Value, String> {
    if super::cancellation_signal() != 0 {
        return Ok(json!({"cancelled":true,"exit":null,"ms":0}));
    }
    let start = Instant::now();
    let mut child =
        super::platform::ManagedChild::spawn(command).map_err(|e| format!("start command: {e}"))?;
    let mut stdout = Output::new(child.take_stdout().ok_or("child stdout was not piped")?)
        .map_err(|e| format!("prepare stdout pipe: {e}"))?;
    let mut stderr = Output::new(child.take_stderr().ok_or("child stderr was not piped")?)
        .map_err(|e| format!("prepare stderr pipe: {e}"))?;
    let mut timed_out = false;
    let mut cancelled = false;
    let mut termination_attempted = false;
    let status = loop {
        stdout.drain();
        stderr.drain();
        // Attribute cancellation only to a job still running. The enclosing assessment
        // still gives an overall cancellation precedence over any completed job results.
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Err(error) => break Err(error.to_string()),
            Ok(None) => {}
        }
        cancelled = super::cancellation_signal() != 0;
        if cancelled
            || start.elapsed() >= timeout
            || stdout.overflow
            || stderr.overflow
            || stdout.error.is_some()
            || stderr.error.is_some()
        {
            timed_out = !cancelled && start.elapsed() >= timeout;
            termination_attempted = true;
            break child.kill_tree();
        }
        thread::sleep(Duration::from_millis(2));
    };
    let cleanup = if termination_attempted && status.is_ok() {
        Ok(())
    } else {
        child.force_cleanup()
    };
    let drain_deadline = Instant::now() + DRAIN_TIMEOUT;
    loop {
        stdout.drain();
        stderr.drain();
        if stdout.pipe.is_none() && stderr.pipe.is_none() || Instant::now() >= drain_deadline {
            break;
        }
        thread::sleep(Duration::from_millis(2));
    }
    stdout.finish();
    stderr.finish();
    let errors: Vec<_> = [("stdout", &stdout.error), ("stderr", &stderr.error)]
        .into_iter()
        .filter_map(|(name, error)| error.as_ref().map(|error| format!("{name}: {error}")))
        .collect();
    let pipe_error = if errors.is_empty() {
        None
    } else {
        Some(errors.join("; "))
    };
    // Keep the report bounded while retaining a prefix from both streams.
    let diagnostic: String = String::from_utf8_lossy(&stdout.bytes)
        .chars()
        .take(1000)
        .chain(String::from_utf8_lossy(&stderr.bytes).chars().take(1000))
        .collect();
    Ok(
        json!({"exit":status.as_ref().ok().and_then(|status| status.code()),
        "error":status.err(),"cleanupError":cleanup.err(),"cancelled":cancelled,"timedOut":timed_out,
        "overflow":stdout.overflow || stderr.overflow,"pipeError":pipe_error,
        "ms":start.elapsed().as_secs_f64()*1000.0,"diagnostic":diagnostic}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn held_open_pipe_retains_partial_output() {
        use std::io::Write;
        let (reader, mut writer) = std::io::pipe().unwrap();
        writer.write_all(b"diagnostic before exit").unwrap();
        let mut output = Output::new(reader).unwrap();
        output.drain();
        assert_eq!(output.bytes, b"diagnostic before exit");
        assert!(output.pipe.is_some());
        output.finish();
        assert!(output.pipe.is_none());
        assert!(output.error.as_deref().unwrap().contains("did not close"));
        // Closing the reader leaves no blocked thread or live process to reclaim.
        drop(writer);
        assert_eq!(output.bytes, b"diagnostic before exit");
    }

    #[cfg(unix)]
    #[test]
    fn exited_child_group_is_reaped_before_cleanup_retry() {
        let mut command = Command::new("sh");
        command.args(["-c", "exit 0"]);
        let mut child = super::super::platform::ManagedChild::spawn(&mut command).unwrap();
        thread::sleep(Duration::from_millis(100));
        let status = child.kill_tree().unwrap();
        assert_eq!(status.code(), Some(0));
    }

    #[test]
    fn output_and_deadline_are_bounded_without_redundant_cleanup() {
        let mut command = Command::new("node");
        command.args(["-e", "setInterval(()=>{},1000)"]);
        let result = run(&mut command, Duration::from_millis(100)).unwrap();
        assert_eq!(result["timedOut"], true);
        // Overflow termination already stops and waits for the owned tree; repeat it to catch
        // platform races that a second post-status signal would expose.
        for _ in 0..8 {
            let mut command = Command::new("node");
            command.args(["-e", "process.stdout.write('x'.repeat(5*1024*1024))"]);
            let result = run(&mut command, Duration::from_secs(5)).unwrap();
            assert_eq!(result["overflow"], true);
            assert!(result["diagnostic"].as_str().unwrap().len() <= 2000);
        }
    }
}
