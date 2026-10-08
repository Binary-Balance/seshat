// Packaging and detailed live progress are separate from the CLI entry point.
use crate::execution::{self, AssessmentMode, CapturedProject, Thresholds};
use crate::write_output;
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

const HELP: &str = "Seshat CLI

Usage: seshat <check|crap|mutate> [options]
       seshat <check|crap|mutate> <--help|-h>
       seshat <--help|-h|--version|-V>
  check           CRAP analysis and mutation testing
  crap            CRAP analysis with fresh coverage, no mutants
  mutate          Mutation testing with typechecks, baselines and fresh coverage

Options:
  --config PATH   Configuration file (default: ./seshat.json)
  --scratch PATH  Existing scratch parent outside the project (default: OS temp)
  --experimental-switching
                  Use helper-based switching for check/mutate (experimental)
  --json          One versioned JSON report on stdout, including failures
  --no-progress   Suppress phase messages on stderr

Help and version accept only the forms above, without other options.
Help does not read configuration; version prints the executable version.
Path options take a separate, non-empty argument. For names beginning with --,
use ./--name or an absolute path. --flag=value and the -- separator are unsupported.

Use the same explicit source, capture and setup configuration for all commands.
Optional config thresholds: maxCrap, maxCognitiveComplexity and minMutationScore under thresholds.
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
    mut result: Value,
    wall_ms: f64,
    capture_ms: Option<f64>,
    thresholds: Option<Thresholds>,
) -> (Value, u8) {
    // A partial maximum must never hide a malformed measured row.
    if matches!(command, Some("check" | "crap"))
        && thresholds.is_some_and(|limits| limits.max_crap.is_some())
        && result["complete"] == true
        && array(&result["sources"])
            .iter()
            .flat_map(|source| array(&source["result"]["functions"]))
            .any(|function| function["status"] == "measured" && function["crap"].as_f64().is_none())
    {
        result["complete"] = json!(false);
        result["error"] = json!("measured function has a missing or invalid CRAP value");
    }
    if command.is_some()
        && thresholds.is_some_and(|limits| limits.max_cognitive_complexity.is_some())
        && result["complete"] == true
        && array(&result["sources"])
            .iter()
            .flat_map(|source| array(&source["result"]["functions"]))
            .any(|function| {
                function["status"] != "complexity-only"
                    && function["cognitiveComplexity"].as_u64().is_none()
            })
    {
        result["complete"] = json!(false);
        result["error"] = json!("function has a missing or invalid cognitive complexity value");
    }
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
    let cognitive_maximum =
        if limits.max_cognitive_complexity.is_some() && result["complete"] == true {
            array(&result["sources"])
                .iter()
                .flat_map(|source| array(&source["result"]["functions"]))
                .filter(|function| function["status"] != "complexity-only")
                .filter_map(|function| function["cognitiveComplexity"].as_u64())
                .max()
                .map(|maximum| maximum as f64)
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
            "maxCognitiveComplexity",
            limits.max_cognitive_complexity,
            matches!(command, Some("check" | "crap" | "mutate")),
            cognitive_maximum,
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
            if (matches!(metric, "maxCrap" | "maxCognitiveComplexity") && actual > limit)
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
            let statements =
                if function["status"] == "measured" || function["coverage"].as_f64().is_some() {
                    format!("{}/{}", function["covered"], function["total"])
                } else {
                    unmeasured.into()
                };
            let crap = function["crap"]
                .as_f64()
                .map(|v| format!("{v:.3}"))
                .unwrap_or_else(|| unmeasured.into());
            let branches = if function["coverageBasis"] == "branch" {
                format!(
                    ", branches {}/{}",
                    function["branchCovered"], function["branchTotal"]
                )
            } else {
                String::new()
            };
            let pseudo = function
                .get("pseudoTestStatus")
                .map_or(String::new(), |status| {
                    format!(", pseudo-testing {}", text(status))
                });
            let _ = writeln!(
                output,
                "  {:?}: complexity {}, cognitive complexity {}, statements {statements}{branches}, CRAP {crap}{pseudo}",
                text(&function["name"]),
                function["complexity"],
                function["cognitiveComplexity"]
            );
            if let Some(escapes) = function.get("typeSafety") {
                let _ = writeln!(
                    output,
                    "    Type safety: any {}, assertions {} (double {}), non-null {}, ts-ignore {}, ts-expect-error {}, ts-nocheck {}",
                    escapes["explicitAny"],
                    escapes["typeAssertions"],
                    escapes["doubleAssertions"],
                    escapes["nonNullAssertions"],
                    escapes["tsIgnore"],
                    escapes["tsExpectError"],
                    escapes["tsNocheck"]
                );
            }
        }
        if let Some(unowned) = source["result"]["typeSafety"]["unowned"].as_object()
            && unowned
                .values()
                .any(|count| count.as_u64().is_some_and(|count| count > 0))
        {
            let _ = writeln!(
                output,
                "  Type safety outside function rows: {}",
                source["result"]["typeSafety"]["unowned"]
            );
        }
        if let Some(error) = source.get("error").filter(|v| !v.is_null()) {
            let _ = writeln!(output, "  Error: {error}");
        }
    }
    if let Some(pseudo) = result.get("pseudoTesting") {
        let _ = writeln!(
            output,
            "Pseudo-testing: {} pseudo-tested, {} checked, {} unknown, {} planned ({})",
            pseudo["pseudoTested"],
            pseudo["checked"],
            pseudo["unknown"],
            pseudo["planned"],
            if pseudo["complete"] == true {
                "complete"
            } else {
                "incomplete"
            }
        );
        output.push_str(
            "Extreme mutations use source replacement; comparison mutation scores are separate.\n",
        );
        for key in ["error", "restorationError"] {
            if let Some(error) = pseudo.get(key).filter(|value| !value.is_null()) {
                let _ = writeln!(output, "Extreme mutation {key}: {error}");
            }
        }
        if pseudo["unresolved"].as_u64().is_some_and(|count| count > 0) {
            let breakdown = &pseudo["diagnostics"]["unresolvedBreakdown"];
            let _ = writeln!(
                output,
                "Unresolved extreme mutations: timed-out {}, execution-error {}, cancelled {}, not-run {}, unassessed {}",
                breakdown["timedOut"],
                breakdown["executionError"],
                breakdown["cancelled"],
                breakdown["notRun"],
                breakdown["unassessed"]
            );
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
        if let Some(strictness) = setup.get("compilerStrictness") {
            let _ = writeln!(
                output,
                "  Compiler strictness: {}, TypeScript {}, config {}",
                text(&strictness["state"]),
                strictness["compilerVersion"],
                strictness["config"]
            );
            if strictness["state"] == "known" {
                let _ = writeln!(
                    output,
                    "  Disabled settings: {}; enabled bypasses: {}; unsupported settings: {}",
                    strictness["disabled"],
                    strictness["enabledBypassOptions"],
                    strictness["unsupported"]
                );
            }
            if let Some(error) = strictness["error"].as_str() {
                let _ = writeln!(output, "  Compiler strictness error: {error:?}");
            }
        }
        for phase in ["baseline", "coverage"] {
            if let Some(error) = setup[phase]["evidenceError"].as_str() {
                let _ = writeln!(output, "  {phase}: {error:?}");
            }
        }
        for key in [
            "compilerStrictnessMs",
            "typecheckMs",
            "baselineMs",
            "coverageMs",
        ] {
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
        // Another failure can take verdict precedence over a timed-out setup.
        let timed_out = array(&mutation["outcomes"])
            .iter()
            .filter(|outcome| {
                array(&outcome["setups"])
                    .iter()
                    .any(|setup| setup["state"] == "timed-out" || setup["timedOut"] == true)
            })
            .count();
        if timed_out > 0 {
            let noun = if timed_out == 1 { "mutant" } else { "mutants" };
            let _ = writeln!(
                output,
                "Mutation scheduling stopped with {timed_out} timed-out {noun}. Timeouts remain unresolved, so the overall mutation score is withheld. Results from work already in progress are retained."
            );
            match mutation["notRun"].as_u64() {
                Some(0) => output.push_str("No mutants were left unrun.\n"),
                Some(1) => output.push_str("1 mutant was not run.\n"),
                Some(count) => {
                    let _ = writeln!(output, "{count} mutants were not run.");
                }
                None => {}
            }
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
    for (key, label) in [("error", "Error"), ("cleanupError", "Cleanup error")] {
        if let Some(error) = result.get(key).filter(|v| !v.is_null()) {
            let _ = writeln!(output, "{label}: {error}");
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

fn write_information(output: &str) -> ExitCode {
    match io::stdout().lock().write_all(output.as_bytes()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) if error.kind() == io::ErrorKind::BrokenPipe => ExitCode::SUCCESS,
        Err(error) => {
            let _ = writeln!(io::stderr().lock(), "seshat: write information: {error}");
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
        Ok(Action::Help) => return write_information(HELP),
        Ok(Action::Version) => {
            return write_information(&format!("seshat {}\n", env!("CARGO_PKG_VERSION")));
        }
        Err(error) => {
            if !json_requested {
                let _ = writeln!(io::stderr().lock(), "seshat: {error}");
                return 2.into();
            }
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
                let captured =
                    CapturedProject::capture(&options.config, &options.scratch, Some(options.mode));
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
    fn readable_type_safety_keeps_static_findings_and_unknown_config_visible() {
        let output = readable(
            &json!({"command":"crap","complete":false,"timings":{"wallMs":1},"result":{
                "sources":[{"path":"source.ts","result":{"functions":[{"name":"f","complexity":1,"cognitiveComplexity":3,
                    "status":"unknown","typeSafety":{"explicitAny":2,"typeAssertions":2,
                    "doubleAssertions":1,"nonNullAssertions":1,"tsIgnore":0,"tsExpectError":1,"tsNocheck":0}}],
                    "typeSafety":{"unowned":{"tsNocheck":1}}}}],
                "setups":[{"name":"unit","compilerStrictness":{"state":"unknown",
                    "compilerVersion":null,"config":null,"error":"missing config\u{001b}[2J"}}]
            }}),
        );
        assert!(output.contains("cognitive complexity 3"));
        assert!(output.contains("any 2, assertions 2 (double 1), non-null 1"));
        assert!(output.contains("Type safety outside function rows: {\"tsNocheck\":1}"));
        assert!(output.contains("Compiler strictness: unknown"));
        assert!(output.contains("missing config\\u{1b}[2J"));
        assert!(!output.contains('\u{001b}'));
    }
    #[test]
    fn cognitive_thresholds_ignore_coverage_status_and_include_zero() {
        let limits = |value| Thresholds {
            max_cognitive_complexity: Some(value),
            ..Thresholds::default()
        };
        for command in ["check", "crap", "mutate"] {
            for (maximum, limit, expected) in [(0, 0.0, 0), (3, 3.0, 0), (3, 2.9999, 1)] {
                let result = json!({"complete":true,"sources":[{"result":{"functions":[
                    {"status":"measured","cognitiveComplexity":0,"crap":22.5},
                    {"status":"unknown","cognitiveComplexity":maximum,"crap":null},
                    {"status":"not-applicable","cognitiveComplexity":0},
                    {"status":"complexity-only","cognitiveComplexity":99}
                ]}}]});
                let (value, code) = report(
                    Some(command),
                    Value::Null,
                    result.clone(),
                    0.0,
                    None,
                    Some(limits(limit)),
                );
                assert_eq!(code, expected);
                assert_eq!(
                    value["quality"]["checks"][0]["metric"],
                    "maxCognitiveComplexity"
                );
                assert_eq!(
                    value["quality"]["checks"][0]["actual"].as_f64(),
                    Some(maximum as f64)
                );
                assert_eq!(value["result"]["sources"], result["sources"]);
                let mut incomplete = result;
                incomplete["complete"] = json!(false);
                let (value, code) = report(
                    Some(command),
                    Value::Null,
                    incomplete,
                    0.0,
                    None,
                    Some(limits(limit)),
                );
                assert_eq!(code, 2);
                assert_eq!(value["quality"]["checks"][0]["state"], "incomplete");
                assert!(value["quality"]["checks"][0]["actual"].is_null());
            }
            let (value, code) = report(
                Some(command),
                Value::Null,
                json!({"complete":true,"sources":[{"result":{"functions":[{"status":"complexity-only","cognitiveComplexity":99}]}}]}),
                0.0,
                None,
                Some(limits(0.0)),
            );
            assert_eq!(code, 0);
            assert_eq!(value["quality"]["checks"][0]["state"], "not-applicable");
            for malformed in [Value::Null, json!("3"), json!(true), json!(-1), json!(1.5)] {
                let (value, code) = report(
                    Some(command),
                    Value::Null,
                    json!({"complete":true,"sources":[{"result":{"functions":[{"status":"unknown","cognitiveComplexity":malformed}]}}]}),
                    0.0,
                    None,
                    Some(limits(10.0)),
                );
                assert_eq!(code, 2);
                assert!(
                    value["result"]["error"]
                        .as_str()
                        .unwrap()
                        .contains("cognitive complexity")
                );
            }
        }
    }

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
                max_cognitive_complexity: None,
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
            max_cognitive_complexity: None,
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
    fn malformed_measured_rows_cannot_pass_a_threshold() {
        let limits = Thresholds {
            max_crap: Some(10.0),
            min_mutation_score: Some(50.0),
            max_cognitive_complexity: None,
        };
        for malformed in [
            json!({"status":"measured"}),
            json!({"status":"measured","crap":null}),
            json!({"status":"measured","crap":"1"}),
            json!({"status":"measured","crap":true}),
        ] {
            let result = json!({"complete":true,"sources":[{"result":{"functions":[
                {"status":"measured","crap":1}, malformed
            ]}}],"mutation":{"score":100.0}});
            for command in ["check", "crap"] {
                let (value, status) = report(
                    Some(command),
                    Value::Null,
                    result.clone(),
                    1.0,
                    None,
                    Some(limits),
                );
                assert_eq!(status, 2);
                assert_eq!(value["complete"], false);
                assert_eq!(value["quality"]["state"], "incomplete");
                assert_eq!(value["quality"]["checks"][0]["state"], "incomplete");
                assert!(value["quality"]["checks"][0]["actual"].is_null());
                assert!(value["result"]["error"].as_str().unwrap().contains("CRAP"));
                assert_eq!(value["result"]["sources"], result["sources"]);
            }
            let (value, status) = report(
                Some("mutate"),
                Value::Null,
                result.clone(),
                1.0,
                None,
                Some(limits),
            );
            assert_eq!(status, 0);
            assert_eq!(value["quality"]["checks"][0]["state"], "not-requested");
            let mut incomplete = result;
            incomplete["complete"] = json!(false);
            incomplete["error"] = json!("earlier failure");
            let (value, status) = report(
                Some("check"),
                Value::Null,
                incomplete,
                1.0,
                None,
                Some(limits),
            );
            assert_eq!(status, 2);
            assert_eq!(value["result"]["error"], "earlier failure");
        }
    }

    #[test]
    fn thresholds_do_not_invent_scores_or_request_extra_assessments() {
        let limits = Thresholds {
            max_crap: Some(0.0),
            min_mutation_score: Some(100.0),
            max_cognitive_complexity: None,
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
            vec!["check", "--config", ""],
            vec!["check", "--config=./seshat.json"],
            vec!["check", "--scratch=./scratch"],
            vec!["check", "--", "--json"],
            vec!["check", "--version"],
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
    fn path_arguments_accept_unambiguous_leading_dashes() {
        for path in [PathBuf::from("./--json"), env::temp_dir().join("--json")] {
            let Action::Run(options) = parse(&[
                "check".into(),
                "--config".into(),
                path.to_str().unwrap().into(),
                "--scratch".into(),
                path.to_str().unwrap().into(),
            ])
            .unwrap() else {
                panic!()
            };
            assert_eq!(options.config, path);
            assert_eq!(options.scratch, path);
            assert!(!options.json);
        }
    }

    #[test]
    fn readable_errors_omit_nulls_and_distinguish_cleanup() {
        for error in [Value::Null, json!("failed\u{001b}[2J\nnext")] {
            let (report, _) = report(
                Some("check"),
                Value::Null,
                json!({
                    "complete":false, "error":error, "cleanupError":error,
                    "sources":[{"path":"source.ts", "error":error}],
                    "mutation":{"error":error}
                }),
                1.0,
                None,
                None,
            );
            let rendered = readable(&report);
            assert!(!rendered.contains("error: null"));
            assert!(!rendered.contains("Error: null"));
            assert!(!rendered.contains('\u{001b}'));
            if !error.is_null() {
                assert!(rendered.contains(&format!("Error: {error}")));
                assert!(rendered.contains(&format!("Cleanup error: {error}")));
            } else {
                assert!(!rendered.contains("Cleanup error:"));
            }
        }
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
    fn unknown_crap_retains_measured_statement_display() {
        let (report, code) = report(
            Some("crap"),
            Value::Null,
            json!({"complete":false,"sources":[{"path":"a.ts","result":{"functions":[{
                "name":"f","complexity":2,"crap":null,"status":"unknown",
                "covered":1,"total":2,"coverage":0.5,"branchCoverage":null,"coverageBasis":null
            }]}}]}),
            1.0,
            None,
            None,
        );
        assert_eq!(code, 2);
        assert!(readable(&report).contains("statements 1/2, CRAP unknown"));
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
                    {"name":"covered","complexity":1,"status":"measured","covered":1,"total":1,"crap":1},
                    {"name":"branched","complexity":2,"status":"measured","covered":1,"total":1,"branchCovered":1,"branchTotal":2,"coverageBasis":"branch","crap":2.5}
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
        assert!(rendered.contains("statements 1/1, branches 1/2, CRAP 2.500"));
        assert!(rendered.contains("score not applicable"));
        assert!(rendered.contains("Capture: 0.5 ms"));
        assert!(!rendered.contains("CRAP unknown"));
    }

    #[test]
    fn mutation_timeouts_explain_withheld_scores_and_unrun_work() {
        for (states, not_run, expected_timeout, expected_unrun) in [
            (
                vec![vec!["failed", "timed-out"]],
                1,
                "stopped with 1 timed-out mutant.",
                "1 mutant was not run.",
            ),
            (
                vec![vec!["timed-out"], vec!["timed-out"]],
                42,
                "stopped with 2 timed-out mutants.",
                "42 mutants were not run.",
            ),
            (
                vec![vec!["timed-out"], vec!["passed"]],
                0,
                "stopped with 1 timed-out mutant.",
                "No mutants were left unrun.",
            ),
            (
                vec![vec!["timed-out", "execution-error"], vec!["cancelled"]],
                1,
                "stopped with 1 timed-out mutant.",
                "1 mutant was not run.",
            ),
            (vec![vec!["execution-error"]], 1, "", ""),
        ] {
            let outcomes: Vec<_> = states.iter().map(|setups| {
                json!({"setups":setups.iter().map(|state| json!({"state":state})).collect::<Vec<_>>()})
            }).collect();
            let (report, status) = report(
                Some("mutate"),
                Value::Null,
                json!({"complete":false,"mutation":{"complete":false,"score":null,
                    "notRun":not_run,"outcomes":outcomes}}),
                1.0,
                None,
                Some(Thresholds {
                    max_crap: None,
                    min_mutation_score: Some(0.0),
                    max_cognitive_complexity: None,
                }),
            );
            assert_eq!(status, 2);
            assert_eq!(report["quality"]["state"], "incomplete");
            assert!(report["quality"]["checks"][0]["actual"].is_null());
            let rendered = readable(&report);
            assert!(rendered.contains("score withheld (incomplete)"));
            if expected_timeout.is_empty() {
                assert!(!rendered.contains("Mutation scheduling stopped with"));
            } else {
                assert!(rendered.contains(expected_timeout));
                assert!(rendered.contains(
                    "Timeouts remain unresolved, so the overall mutation score is withheld."
                ));
                assert!(rendered.contains("Results from work already in progress are retained."));
                assert!(rendered.contains(expected_unrun));
            }
        }
        let mixed = readable(&json!({"timings":{"wallMs":1.0},"result":{
            "mutation":{"score":null,"notRun":0,"outcomes":[{
                "verdict":"execution-error","setups":[{"state":"execution-error","timedOut":true}]
            }]}
        }}));
        assert!(mixed.contains("stopped with 1 timed-out mutant."));
        assert!(mixed.contains("No mutants were left unrun."));
    }
}
