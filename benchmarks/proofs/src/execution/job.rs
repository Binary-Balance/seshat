// Bounded Unix jobs for the captured-project path. No shell interpretation.
use serde_json::{Value, json};
use std::{
    io::Read,
    os::unix::process::CommandExt,
    process::{Command, Stdio},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread,
    time::{Duration, Instant},
};

const STREAM_LIMIT: usize = 2 * 1024 * 1024;

fn read_pipe(
    pipe: impl Read + Send + 'static,
    overflow: Arc<AtomicBool>,
) -> mpsc::Receiver<Result<Vec<u8>, String>> {
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = pipe.take(STREAM_LIMIT as u64 + 1).read_to_end(&mut bytes);
        if bytes.len() > STREAM_LIMIT {
            overflow.store(true, Ordering::Relaxed);
            bytes.truncate(STREAM_LIMIT);
        }
        let _ = sender.send(result.map(|_| bytes).map_err(|e| e.to_string()));
    });
    receiver
}

pub(super) fn run(command: &mut Command, timeout: Duration) -> Result<Value, String> {
    if super::cancellation_signal() != 0 {
        return Ok(json!({"cancelled":true,"exit":null,"ms":0}));
    }
    command
        .process_group(0)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let start = Instant::now();
    let mut child = command.spawn().map_err(|e| format!("start command: {e}"))?;
    let overflow = Arc::new(AtomicBool::new(false));
    let stdout = read_pipe(child.stdout.take().unwrap(), overflow.clone());
    let stderr = read_pipe(child.stderr.take().unwrap(), overflow.clone());
    let mut timed_out = false;
    let mut termination_attempted = false;
    let status = loop {
        if super::cancellation_signal() != 0 {
            termination_attempted = true;
            let result = super::kill_owned_group(&mut child);
            break result;
        }
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Err(error) => break Err(error.to_string()),
            Ok(None) => {}
        }
        if start.elapsed() >= timeout || overflow.load(Ordering::Relaxed) {
            timed_out = start.elapsed() >= timeout;
            termination_attempted = true;
            let result = super::kill_owned_group(&mut child);
            break result;
        }
        thread::sleep(Duration::from_millis(2));
    };
    // kill_owned_group already signalled and waited for the group; natural exits still need descendant cleanup.
    let cleanup = if termination_attempted {
        Ok(())
    } else {
        super::stop_owned_group(child.id())
    };
    if status.is_err() {
        let _ = child.kill();
        let _ = child.wait();
    }
    let mut diagnostic = String::new();
    let mut pipe_error = None;
    for receiver in [stdout, stderr] {
        match receiver.recv_timeout(Duration::from_millis(500)) {
            Ok(Ok(bytes)) => diagnostic.push_str(&String::from_utf8_lossy(&bytes)),
            Ok(Err(error)) => pipe_error = Some(error),
            Err(_) => {
                pipe_error =
                    Some("output pipe did not close after stopping the process group".into())
            }
        }
    }
    // Do not expose an unbounded test log in the machine report.
    let diagnostic: String = diagnostic.chars().take(2000).collect();
    let status = status?;
    if let Err(error) = cleanup {
        return Err(format!("process group cleanup: {error}"));
    }
    Ok(
        json!({"exit":status.code(),"cancelled":super::cancellation_signal()!=0,"timedOut":timed_out,"overflow":overflow.load(Ordering::Relaxed),
        "pipeError":pipe_error,"ms":start.elapsed().as_secs_f64()*1000.0,"diagnostic":diagnostic}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exited_child_group_is_reaped_before_cleanup_retry() {
        let mut command = Command::new("sh");
        command.args(["-c", "exit 0"]);
        command.process_group(0);
        let mut child = command.spawn().unwrap();
        thread::sleep(Duration::from_millis(100));
        let status = super::super::kill_owned_group(&mut child).unwrap();
        assert_eq!(status.code(), Some(0));
    }

    #[test]
    fn output_and_deadline_are_bounded_without_redundant_cleanup() {
        let mut command = Command::new("node");
        command.args(["-e", "setInterval(()=>{},1000)"]);
        let result = run(&mut command, Duration::from_millis(100)).unwrap();
        assert_eq!(result["timedOut"], true);
        // Overflow termination already stops and waits for the group; post-status cleanup must not signal it again.
        for _ in 0..8 {
            let mut command = Command::new("node");
            command.args(["-e", "process.stdout.write('x'.repeat(5*1024*1024))"]);
            let result = run(&mut command, Duration::from_secs(5)).unwrap();
            assert_eq!(result["overflow"], true);
            assert!(result["diagnostic"].as_str().unwrap().len() <= 2000);
        }
    }
}
