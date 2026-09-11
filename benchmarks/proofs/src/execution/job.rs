// Bounded process jobs for the captured-project path. No shell interpretation.
use serde_json::{Value, json};
use std::{
    io::Read,
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
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let start = Instant::now();
    let mut child =
        super::platform::ManagedChild::spawn(command).map_err(|e| format!("start command: {e}"))?;
    let overflow = Arc::new(AtomicBool::new(false));
    let stdout = read_pipe(
        child.take_stdout().ok_or("child stdout was not piped")?,
        overflow.clone(),
    );
    let stderr = read_pipe(
        child.take_stderr().ok_or("child stderr was not piped")?,
        overflow.clone(),
    );
    let mut timed_out = false;
    let status = loop {
        if super::cancellation_signal() != 0 {
            break child.kill_tree();
        }
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Err(error) => break Err(error.to_string()),
            Ok(None) => {}
        }
        if start.elapsed() >= timeout || overflow.load(Ordering::Relaxed) {
            timed_out = start.elapsed() >= timeout;
            break child.kill_tree();
        }
        thread::sleep(Duration::from_millis(2));
    };
    // Also stop descendants when their leader has already exited.
    let cleanup = if status.is_err() {
        child.force_cleanup()
    } else {
        child.stop_tree()
    };
    let mut diagnostic = String::new();
    let mut pipe_error = None;
    for receiver in [stdout, stderr] {
        match receiver.recv_timeout(Duration::from_millis(500)) {
            Ok(Ok(bytes)) => diagnostic.push_str(&String::from_utf8_lossy(&bytes)),
            Ok(Err(error)) => pipe_error = Some(error),
            Err(_) => {
                pipe_error =
                    Some("output pipe did not close after stopping the process tree".into())
            }
        }
    }
    // Do not expose an unbounded test log in the machine report.
    let diagnostic: String = diagnostic.chars().take(2000).collect();
    let status = status?;
    if let Err(error) = cleanup {
        return Err(format!("process tree cleanup: {error}"));
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
    fn output_and_deadline_are_bounded() {
        let mut command = Command::new("node");
        command.args(["-e", "setInterval(()=>{},1000)"]);
        let result = run(&mut command, Duration::from_millis(100)).unwrap();
        assert_eq!(result["timedOut"], true);
        let mut command = Command::new("node");
        command.args(["-e", "process.stdout.write('x'.repeat(5*1024*1024))"]);
        let result = run(&mut command, Duration::from_secs(5)).unwrap();
        assert_eq!(result["overflow"], true);
        assert!(result["diagnostic"].as_str().unwrap().len() <= 2000);
    }
}
