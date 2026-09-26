use serde_json::Value;
use std::{
    io,
    process::{Command, Stdio},
};

const BINARY: &str = env!("CARGO_BIN_EXE_seshat");

#[test]
fn help_and_version_forms_match_the_usage() {
    for args in [
        vec!["--help"],
        vec!["-h"],
        vec!["--version"],
        vec!["-V"],
        vec!["check", "--help"],
        vec!["crap", "-h"],
        vec!["mutate", "--help"],
    ] {
        let output = Command::new(BINARY).args(&args).output().unwrap();
        assert_eq!(output.status.code(), Some(0), "{args:?}");
        assert!(output.stderr.is_empty());
        assert!(output.stdout.starts_with(b"Seshat CLI") || output.stdout.starts_with(b"seshat "));
    }
}

#[test]
fn argument_errors_are_concise_or_json_and_escape_controls() {
    for args in [
        vec![],
        vec!["bogus\u{001b}[2J\nnext"],
        vec!["check", "--version"],
        vec!["check", "--config=./seshat.json"],
        vec!["check", "--"],
    ] {
        let output = Command::new(BINARY).args(&args).output().unwrap();
        assert_eq!(output.status.code(), Some(2));
        assert!(output.stdout.is_empty());
        let error = String::from_utf8(output.stderr).unwrap();
        assert!(error.starts_with("seshat: "));
        assert_eq!(error.lines().count(), 1);
        assert!(!error.contains('\u{001b}'));

        let output = Command::new(BINARY)
            .args(&args)
            .arg("--json")
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(2));
        assert!(output.stderr.is_empty());
        let report: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(report["schemaVersion"], 1);
        assert_eq!(report["complete"], false);
        assert!(report["command"].is_null());
        assert!(report["scope"].is_null());
        assert!(report["timings"]["captureMs"].is_null());
        assert!(report["result"]["error"].is_string());
    }
}

#[test]
fn closed_stdout_succeeds_only_for_information() {
    for (args, status) in [
        (vec!["--help"], 0),
        (vec!["--version"], 0),
        (vec!["check", "--help"], 0),
        (vec!["bogus", "--json"], 2),
        (vec!["check", "--config", BINARY, "--no-progress"], 2),
        (
            vec!["check", "--config", BINARY, "--no-progress", "--json"],
            2,
        ),
    ] {
        let (reader, writer) = io::pipe().unwrap();
        drop(reader);
        let output = Command::new(BINARY)
            .args(&args)
            .stdout(Stdio::from(writer))
            .stderr(Stdio::piped())
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(status), "{args:?}");
        if status == 0 {
            assert!(output.stderr.is_empty());
        } else {
            let error = String::from_utf8(output.stderr).unwrap();
            assert!(error.contains("write report"), "{error}");
            assert!(!error.contains("panicked"));
        }
    }
}
