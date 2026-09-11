// First CLI candidate. Packaging and detailed live progress are separate work.
use crate::execution::{self, AssessmentMode, CapturedProject, Thresholds};
use serde_json::{Value, json};
use std::{
    collections::BTreeSet,
    env,
    fmt::Write as _,
    io::{self, Write},
    path::PathBuf,
    process::ExitCode,
    time::Instant,
};

const HELP: &str = "Seshat CLI candidate (not a published release)

Usage: seshat <check|crap|mutate> [options]
  check           CRAP analysis and mutation testing
  crap            CRAP analysis with fresh coverage, no mutants
  mutate          Mutation testing with original typechecks/baselines, no coverage

Options:
  --config PATH   Configuration file (default: ./seshat.json)
  --scratch PATH  Existing scratch parent outside the project (default: OS temp)
  --experimental-switching
                  Use helper-based switching for check/mutate (experimental)
  --json          One versioned JSON report on stdout, including failures
  --no-progress   Suppress phase messages on stderr
  --help, -h      Show this help without reading configuration
  --version, -V   Show the candidate version

Use the same explicit source, capture and setup configuration for all commands.
Optional config thresholds: maxCrap and minMutationScore under thresholds.
Threshold failures exit 1; incomplete runs exit 2; cancellation uses the host's console/signal status.
";

struct Options {
    command: String,
    mode: AssessmentMode,
    config: PathBuf,
    scratch: PathBuf,
    experimental_switching: bool,
    json: bool,
    progress: bool,
}

enum Action {
    Help,
    Version,
    Run(Options),
}

fn parse(args: &[String]) -> Result<Action, String> {
    let first = args
        .first()
        .ok_or("expected check, crap or mutate; use --help")?;
    if args.len() == 1 {
        match first.as_str() {
            "--help" | "-h" => return Ok(Action::Help),
            "--version" | "-V" => return Ok(Action::Version),
            _ => {}
        }
    }
    let mode = match first.as_str() {
        "check" => AssessmentMode::Check,
        "crap" => AssessmentMode::Crap,
        "mutate" => AssessmentMode::Mutate,
        _ => return Err(format!("unknown command {first:?}; use --help")),
    };
    if args.len() == 2 && matches!(args[1].as_str(), "--help" | "-h") {
        return Ok(Action::Help);
    }
    let mut options = Options {
        command: first.clone(),
        mode,
        config: "seshat.json".into(),
        scratch: env::temp_dir(),
        experimental_switching: false,
        json: false,
        progress: true,
    };
    let mut seen = BTreeSet::new();
    let mut rest = args[1..].iter();
    while let Some(flag) = rest.next() {
        if !seen.insert(flag) {
            return Err(format!("duplicate option {flag:?}"));
        }
        match flag.as_str() {
            "--experimental-switching" => {
                if mode == AssessmentMode::Crap {
                    return Err(
                        "--experimental-switching is only available for check or mutate".into(),
                    );
                }
                options.experimental_switching = true;
            }
            "--json" => options.json = true,
            "--no-progress" => options.progress = false,
            "--config" | "--scratch" => {
                let value = rest
                    .next()
                    .filter(|v| !v.is_empty() && !v.starts_with("--"))
                    .ok_or_else(|| format!("{flag} requires a path"))?;
                if flag == "--config" {
                    options.config = value.into();
                } else {
                    options.scratch = value.into();
                }
            }
            _ => return Err(format!("unknown option {flag:?}; use --help")),
        }
    }
    Ok(Action::Run(options))
}

fn progress(enabled: bool, message: &str) {
    if enabled {
        let _ = writeln!(io::stderr().lock(), "seshat: {message}");
    }
}

fn report(
    command: Option<&str>,
    scope: Value,
    result: Value,
    wall_ms: f64,
    capture_ms: Option<f64>,
    thresholds: Option<Thresholds>,
) -> (Value, u8) {
    let (result, mut status) = crate::finish(result);
    let quality = thresholds.map(|limits| quality(command, &result, limits));
    if status == 0 && quality.as_ref().is_some_and(|q| q["state"] == "failed") {
        status = 1;
    }
    let value = json!({"schemaVersion":1,"toolVersion":env!("CARGO_PKG_VERSION"),
        "command":command,"complete":result["complete"]==true,
        "cancelled":result["cancelled"]==true,"signal":result.get("signal"),
        "scope":scope,"timings":{"wallMs":wall_ms,"captureMs":capture_ms,"executionMs":result.get("executionMs")},
        "quality":quality,"result":result});
    (value, status)
}

fn quality(command: Option<&str>, result: &Value, limits: Thresholds) -> Value {
    let maximum = if limits.max_crap.is_some() && result["complete"] == true {
        array(&result["sources"])
            .iter()
            .flat_map(|source| array(&source["result"]["functions"]))
            .filter(|function| function["status"] == "measured")
            .filter_map(|function| function["crap"].as_f64())
            .reduce(f64::max)
    } else {
        None
    };
    let mut checks = Vec::new();
    for (metric, limit, requested, actual) in [
        (
            "maxCrap",
            limits.max_crap,
            matches!(command, Some("check" | "crap")),
            maximum,
        ),
        (
            "minMutationScore",
            limits.min_mutation_score,
            matches!(command, Some("check" | "mutate")),
            result["mutation"]["score"].as_f64(),
        ),
    ] {
        let Some(limit) = limit else { continue };
        let state = if !requested {
            "not-requested"
        } else if result["complete"] != true {
            "incomplete"
        } else if let Some(actual) = actual {
            if (metric == "maxCrap" && actual > limit)
                || (metric == "minMutationScore" && actual < limit)
            {
                "failed"
            } else {
                "passed"
            }
        } else {
            "not-applicable"
        };
        // Partial scores remain in assessment evidence, never as a complete quality check.
        let actual = if matches!(state, "passed" | "failed") {
            actual
        } else {
            None
        };
        checks.push(json!({"metric":metric,"limit":limit,"actual":actual,"state":state}));
    }
    let state = if result["complete"] != true {
        "incomplete"
    } else if checks.is_empty() {
        "not-configured"
    } else if checks.iter().any(|check| check["state"] == "failed") {
        "failed"
    } else if checks.iter().any(|check| check["state"] == "passed") {
        "passed"
    } else {
        "not-evaluated"
    };
    json!({"state":state,"checks":checks})
}

fn array(value: &Value) -> &[Value] {
    value.as_array().map_or(&[], Vec::as_slice)
}
fn text(value: &Value) -> &str {
    value.as_str().unwrap_or("unknown")
}

fn readable(report: &Value) -> String {
    let result = &report["result"];
    let state = if report["cancelled"] == true {
        "cancelled"
    } else if report["complete"] == true {
        "complete"
    } else {
        "incomplete"
    };
    let mut output = format!("Seshat {}: {state}\n", text(&report["command"]));
    if !report["quality"].is_null() {
        let _ = writeln!(
            output,
            "Quality thresholds: {}",
            text(&report["quality"]["state"])
        );
        for check in array(&report["quality"]["checks"]) {
            let _ = writeln!(
                output,
                "  {}: {}, limit {}, actual {}",
                text(&check["metric"]),
                text(&check["state"]),
                check["limit"],
                check
                    .get("actual")
                    .filter(|v| !v.is_null())
                    .map_or("not evaluated".into(), Value::to_string)
            );
        }
    }
    if !report["scope"].is_null() {
        let _ = writeln!(
            output,
            "Scope: {} source file(s), {} setup(s)",
            array(&report["scope"]["files"]).len(),
            array(&report["scope"]["setups"]).len()
        );
    }
    for source in array(&result["sources"]) {
        let _ = writeln!(output, "Source {:?}", text(&source["path"]));
        for function in array(&source["result"]["functions"]) {
            let unmeasured = match text(&function["status"]) {
                "not-applicable" => "not applicable",
                "complexity-only" => "not applicable (complexity only)",
                _ => "unknown",
            };
            let statements = if function["status"] == "measured" {
                format!("{}/{}", function["covered"], function["total"])
            } else {
                unmeasured.into()
            };
            let crap = function["crap"]
                .as_f64()
                .map(|v| format!("{v:.3}"))
                .unwrap_or_else(|| unmeasured.into());
            let _ = writeln!(
                output,
                "  {:?}: complexity {}, statements {statements}, CRAP {crap}",
                text(&function["name"]),
                function["complexity"]
            );
        }
        if let Some(error) = source.get("error") {
            let _ = writeln!(output, "  Error: {error}");
        }
    }
    for setup in array(&result["setups"]) {
        let _ = writeln!(
            output,
            "Setup {:?}: typecheck {}, baseline {}, coverage {}",
            text(&setup["name"]),
            text(&setup["typecheck"]["state"]),
            text(&setup["baseline"]["state"]),
            text(&setup["coverage"]["state"])
        );
        for key in ["typecheckMs", "baselineMs", "coverageMs"] {
            if let Some(ms) = setup["timings"][key].as_f64() {
                let _ = writeln!(output, "  {key}: {ms:.1} ms");
            }
        }
    }
    if let Some(diagnostics) = result.get("diagnostics") {
        let seshat = &diagnostics["concurrency"]["seshat"];
        let _ = writeln!(
            output,
            "Seshat workers: configured {}, effective {} ({})",
            seshat["configuredWorkers"],
            seshat
                .get("effectiveWorkers")
                .filter(|value| !value.is_null())
                .map_or("unavailable".into(), Value::to_string),
            text(&seshat["state"])
        );
        for version in array(&diagnostics["runnerVersions"]) {
            let _ = write!(
                output,
                "Runner {:?}: Node {:?}",
                text(&version["setup"]),
                version["runtime"]
                    .get("node")
                    .filter(|value| !value.is_null())
                    .map_or_else(
                        || "unavailable".to_string(),
                        |value| value.as_str().unwrap_or("unknown").to_string(),
                    )
            );
            for package in array(&version["packages"]) {
                let _ = write!(
                    output,
                    ", {:?} {:?} (declared {:?}, {}, locked {:?}, {})",
                    text(&package["name"]),
                    package
                        .get("actual")
                        .filter(|value| !value.is_null())
                        .and_then(Value::as_str)
                        .unwrap_or("unavailable"),
                    package
                        .get("declared")
                        .filter(|value| !value.is_null())
                        .and_then(Value::as_str)
                        .unwrap_or("unavailable"),
                    text(&package["declaredComparison"]),
                    package
                        .get("locked")
                        .filter(|value| !value.is_null())
                        .and_then(Value::as_str)
                        .unwrap_or("unavailable"),
                    text(&package["lockedComparison"])
                );
            }
            output.push('\n');
        }
        for runner in array(&diagnostics["concurrency"]["runners"]) {
            let _ = writeln!(
                output,
                "Runner {:?} {} workers: {} ({})",
                text(&runner["setup"]),
                text(&runner["command"]),
                runner
                    .get("effectiveWorkers")
                    .filter(|value| !value.is_null())
                    .map_or("unavailable".into(), Value::to_string),
                text(&runner["state"])
            );
        }
    }
    if let Some(mutation) = result.get("mutation") {
        let _ = writeln!(output, "Mutation strategy: {}", text(&mutation["strategy"]));
        let score = mutation["score"]
            .as_f64()
            .map(|v| format!("{v:.2}%"))
            .unwrap_or_else(|| {
                if mutation["complete"] == true && mutation["planned"] == 0 {
                    "not applicable"
                } else {
                    "withheld (incomplete)"
                }
                .into()
            });
        let _ = writeln!(
            output,
            "Mutation: {} planned, {} killed, {} survived; score {score}",
            mutation["planned"], mutation["killed"], mutation["survived"]
        );
        let _ = writeln!(
            output,
            "Workers: {} requested, {} used; {} additional baseline job(s)",
            mutation["workersRequested"], mutation["workersUsed"], mutation["workerBaselineJobs"]
        );
        if mutation["strategy"] == "switch" {
            let _ = writeln!(
                output,
                "Prepared baseline: {} job(s)",
                mutation["preparedBaselineJobs"]
            );
        }
        if mutation.get("completed").is_some() {
            let _ = writeln!(
                output,
                "Mutation work: {} completed, {} not run, {} unresolved",
                mutation["completed"], mutation["notRun"], mutation["unresolved"]
            );
        }
        let breakdown = &mutation["diagnostics"]["unresolvedBreakdown"];
        if breakdown.is_object() {
            let _ = writeln!(
                output,
                "Unresolved breakdown: timed-out {}, execution-error {}, cancelled {}, not-run {}, unassessed {}",
                breakdown["timedOut"],
                breakdown["executionError"],
                breakdown["cancelled"],
                breakdown["notRun"],
                breakdown["unassessed"]
            );
        }
        if let Some(throughput) = mutation["diagnostics"]["throughput"].as_object() {
            let _ = writeln!(
                output,
                "Mutation throughput: {} mutant/s, {} job/s; mutant worker time {} ms",
                throughput
                    .get("completedMutantsPerSecond")
                    .filter(|value| !value.is_null())
                    .map_or("unavailable".into(), Value::to_string),
                throughput
                    .get("jobsPerSecond")
                    .filter(|value| !value.is_null())
                    .map_or("unavailable".into(), Value::to_string),
                mutation["diagnostics"]["workerTimeMs"]
            );
        }
        if let Some(slowest) = mutation["diagnostics"]["slowestExecutions"].as_array() {
            if !slowest.is_empty() {
                let _ = writeln!(output, "Slowest mutant executions:");
                for row in slowest {
                    let _ = writeln!(
                        output,
                        "  #{} {:?}: {} ms ({})",
                        row["id"],
                        text(&row["path"]),
                        row["executionMs"],
                        text(&row["verdict"])
                    );
                }
            }
        }
        for row in array(&mutation["outcomes"]) {
            let _ = writeln!(
                output,
                "  #{} {:?} byte {} {:?} -> {:?}: {}",
                row["id"],
                text(&row["path"]),
                row["offset"],
                text(&row["original"]),
                text(&row["replacement"]),
                text(&row["verdict"])
            );
        }
        if let Some(error) = mutation.get("error").filter(|v| !v.is_null()) {
            let _ = writeln!(output, "Mutation error: {error}");
        }
    }
    for key in ["error", "cleanupError"] {
        if let Some(error) = result.get(key) {
            let _ = writeln!(output, "Error: {error}");
        }
    }
    let _ = writeln!(
        output,
        "Wall time: {:.1} ms; jobs attempted: {}",
        report["timings"]["wallMs"].as_f64().unwrap(),
        result
            .get("jobsAttempted")
            .map_or("unknown".into(), Value::to_string)
    );
    for (label, value) in [
        ("Capture", &report["timings"]["captureMs"]),
        ("Execution", &report["timings"]["executionMs"]),
        ("Analysis", &result["phaseTimings"]["analysisMs"]),
        (
            "Runner preparation",
            &result["phaseTimings"]["preparationMs"],
        ),
        (
            "Original typechecks",
            &result["phaseTimings"]["typecheckMs"],
        ),
        ("Original baselines", &result["phaseTimings"]["baselineMs"]),
        ("Coverage collection", &result["phaseTimings"]["coverageMs"]),
        (
            "Coverage attribution",
            &result["phaseTimings"]["attributionMs"],
        ),
        ("Primary cleanup", &result["phaseTimings"]["cleanupMs"]),
        (
            "Worker preparation",
            &result["mutation"]["workerPreparationMs"],
        ),
        (
            "Switch preparation",
            &result["mutation"]["switchPreparationMs"],
        ),
        (
            "Prepared baseline",
            &result["mutation"]["preparedBaselineMs"],
        ),
        ("Mutation scheduling", &result["mutation"]["mutationWallMs"]),
        ("Worker cleanup", &result["mutation"]["workerCleanupMs"]),
    ] {
        if let Some(ms) = value.as_f64() {
            let _ = writeln!(output, "{label}: {ms:.1} ms");
        }
    }
    if report["complete"] != true {
        output
            .push_str("No complete assurance result. Use --json for retained execution details.\n");
    }
    output
}

fn write_output(output: &str, status: u8) -> ExitCode {
    match io::stdout().lock().write_all(output.as_bytes()) {
        Ok(()) => status.into(),
        Err(error) => {
            let _ = writeln!(io::stderr().lock(), "seshat: write report: {error}");
            2.into()
        }
    }
}

pub fn main() -> ExitCode {
    let started = Instant::now();
    let raw: Vec<_> = env::args_os().skip(1).collect();
    let json_requested = raw.iter().any(|arg| arg == "--json");
    let action = raw
        .into_iter()
        .map(|arg| {
            arg.into_string()
                .map_err(|_| "arguments must be UTF-8".to_string())
        })
        .collect::<Result<Vec<_>, _>>()
        .and_then(|args| parse(&args));
    let (value, status, as_json) = match action {
        Ok(Action::Help) => return write_output(HELP, 0),
        Ok(Action::Version) => {
            return write_output(
                &format!("seshat {} (candidate)\n", env!("CARGO_PKG_VERSION")),
                0,
            );
        }
        Err(error) => {
            let (value, status) = report(
                None,
                Value::Null,
                json!({"complete":false,"error":error}),
                started.elapsed().as_secs_f64() * 1000.0,
                None,
                None,
            );
            (value, status, json_requested)
        }
        Ok(Action::Run(options)) => {
            let mut scope = Value::Null;
            let mut capture_ms = None;
            let mut thresholds = None;
            let result = (|| {
                execution::install_cancellation()?;
                progress(options.progress, "capturing configured inputs");
                let capture_started = Instant::now();
                let captured = CapturedProject::capture(&options.config, &options.scratch);
                capture_ms = Some(capture_started.elapsed().as_secs_f64() * 1000.0);
                let project = captured?;
                thresholds = Some(project.thresholds());
                scope = project.scope();
                progress(
                    options.progress,
                    &format!(
                        "running {} for {} source file(s)",
                        options.command,
                        array(&scope["files"]).len()
                    ),
                );
                project.assess_with_strategy(
                    options.mode,
                    options.progress,
                    options.experimental_switching,
                )
            })()
            .unwrap_or_else(|error: String| json!({"complete":false,"error":error}));
            let (value, status) = report(
                Some(&options.command),
                scope,
                result,
                started.elapsed().as_secs_f64() * 1000.0,
                capture_ms,
                thresholds,
            );
            (value, status, options.json)
        }
    };
    let output = if as_json {
        format!("{value}\n")
    } else {
        readable(&value)
    };
    write_output(&output, status)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn threshold_boundaries_and_incomplete_precedence() {
        let result = json!({"complete":true,"sources":[
            {"result":{"functions":[{"status":"measured","crap":1}]}},
            {"result":{"functions":[{"status":"measured","crap":22.5},{"status":"not-applicable","crap":null}]}}
        ],"mutation":{"score":50.0}});
        for (max_crap, min_mutation_score, status) in [
            (22.5, 50.0, 0),
            (22.49999, 50.0, 1),
            (22.5, 50.00001, 1),
            (0.0, 100.0, 1),
        ] {
            let limits = Thresholds {
                max_crap: Some(max_crap),
                min_mutation_score: Some(min_mutation_score),
            };
            let (report, code) = report(
                Some("check"),
                Value::Null,
                result.clone(),
                1.0,
                None,
                Some(limits),
            );
            assert_eq!(code, status);
            assert_eq!(report["complete"], true);
            assert_eq!(report["quality"]["checks"][0]["actual"], 22.5);
            assert_eq!(
                report["quality"]["state"],
                if status == 0 { "passed" } else { "failed" }
            );
            assert!(readable(&report).contains(if status == 0 {
                "Quality thresholds: passed"
            } else {
                "Quality thresholds: failed"
            }));
        }
        let limits = Thresholds {
            max_crap: Some(0.0),
            min_mutation_score: Some(100.0),
        };
        let mut incomplete = result.clone();
        incomplete["complete"] = json!(false);
        let (report, code) = report(
            Some("check"),
            Value::Null,
            incomplete,
            1.0,
            None,
            Some(limits),
        );
        assert_eq!(code, 2);
        assert_eq!(report["quality"]["state"], "incomplete");
        assert!(
            array(&report["quality"]["checks"])
                .iter()
                .all(|c| c["state"] == "incomplete" && c["actual"].is_null())
        );
        assert_eq!(
            quality(Some("check"), &result, Thresholds::default())["state"],
            "not-configured"
        );
    }

    #[test]
    fn thresholds_do_not_invent_scores_or_request_extra_assessments() {
        let limits = Thresholds {
            max_crap: Some(0.0),
            min_mutation_score: Some(100.0),
        };
        let empty = json!({"complete":true,"sources":[{"result":{"functions":[{"status":"complexity-only","crap":null}]}}],"mutation":{"planned":0,"score":null}});
        for command in ["check", "crap", "mutate"] {
            let (report, code) = report(
                Some(command),
                Value::Null,
                empty.clone(),
                1.0,
                None,
                Some(limits),
            );
            assert_eq!(code, 0);
            assert_eq!(report["quality"]["state"], "not-evaluated");
            let checks = array(&report["quality"]["checks"]);
            assert_eq!(
                checks[0]["state"],
                if command == "mutate" {
                    "not-requested"
                } else {
                    "not-applicable"
                }
            );
            assert_eq!(
                checks[1]["state"],
                if command == "crap" {
                    "not-requested"
                } else {
                    "not-applicable"
                }
            );
            assert!(checks.iter().all(|c| c["actual"].is_null()));
        }
    }

    #[test]
    fn arguments_reject_ambiguity_before_execution() {
        for args in [
            vec![],
            vec!["bogus"],
            vec!["check", "--config"],
            vec!["check", "--config", "--json"],
            vec!["check", "--json", "--json"],
            vec!["check", "extra"],
            vec!["check", "--wat"],
            vec!["check", "--help", "extra"],
        ] {
            assert!(parse(&args.iter().map(|s| s.to_string()).collect::<Vec<_>>()).is_err());
        }
        for command in ["check", "crap", "mutate"] {
            let Action::Run(options) =
                parse(&[command.into(), "--json".into(), "--no-progress".into()]).unwrap()
            else {
                panic!()
            };
            assert!(options.json);
            assert!(!options.progress);
        }
        let Action::Run(options) =
            parse(&["check".into(), "--experimental-switching".into()]).unwrap()
        else {
            panic!()
        };
        assert!(options.experimental_switching);
        assert!(parse(&["crap".into(), "--experimental-switching".into()]).is_err());
    }
    #[test]
    fn unknown_is_not_zero_and_terminal_controls_are_escaped() {
        let (report, code) = report(
            Some("crap"),
            Value::Null,
            json!({"complete":false,"sources":[{"path":"evil\u{001b}[2J.ts","result":{"functions":[{"name":"f","complexity":2,"crap":null,"status":"unknown"}]}}]}),
            1.0,
            None,
            None,
        );
        assert_eq!(code, 2);
        assert!(report["timings"]["captureMs"].is_null());
        let rendered = readable(&report);
        assert!(!rendered.contains('\u{001b}'));
        assert!(rendered.contains("CRAP unknown"));
        assert!(rendered.contains("statements unknown"));
        assert!(rendered.contains("jobs attempted: unknown"));
    }

    #[test]
    fn unscored_functions_and_empty_mutation_scope_are_not_failures() {
        let (report, code) = report(
            Some("check"),
            Value::Null,
            json!({
                "complete":true,"sources":[{"path":"a.ts","result":{"functions":[
                    {"name":"empty","complexity":1,"status":"not-applicable"},
                    {"name":"field","complexity":2,"status":"complexity-only"},
                    {"name":"covered","complexity":1,"status":"measured","covered":1,"total":1,"crap":1}
                ]}}],"mutation":{"complete":true,"planned":0,"score":null}
            }),
            1.0,
            Some(0.5),
            None,
        );
        assert_eq!(code, 0);
        let rendered = readable(&report);
        assert!(rendered.contains("CRAP not applicable (complexity only)"));
        assert!(rendered.contains("statements 1/1, CRAP 1.000"));
        assert!(rendered.contains("score not applicable"));
        assert!(rendered.contains("Capture: 0.5 ms"));
        assert!(!rendered.contains("CRAP unknown"));
    }
}
