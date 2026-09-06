mod analysis;
mod assessment;
mod coverage;
mod execution;
use serde_json::{Value, json};
use std::{env, fs};

fn run(args: &[String]) -> Result<Value, String> {
    let mode = args
        .first()
        .ok_or("expected inspect, score, prepare, replace, execute, capture, collect or check")?;
    if matches!(mode.as_str(), "capture" | "collect" | "check") {
        if args.len() != 3 {
            return Err(format!(
                "expected {mode} <seshat.json> <existing scratch directory>"
            ));
        }
        execution::install_cancellation()?;
        let project = execution::CapturedProject::capture(
            std::path::Path::new(&args[1]),
            std::path::Path::new(&args[2]),
        )?;
        return if mode == "capture" {
            project.inspect()
        } else {
            project.collect(mode == "check")
        };
    }
    if mode == "execute" {
        let config = serde_json::from_str(
            &fs::read_to_string(args.get(1).ok_or("manifest missing")?)
                .map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        return execution::Session::capture(config)?
            .execute(args.get(2).ok_or("strategy missing")?);
    }
    let path = args.get(1).ok_or("source missing")?;
    let source = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let analysis = analysis::Analysis::inspect(path, &source)?;
    match mode.as_str() {
        "inspect" => Ok(analysis.json()),
        "score" => {
            let reports: Vec<Value> = args[2..]
                .iter()
                .map(|p| {
                    fs::read_to_string(p)
                        .map_err(|e| e.to_string())
                        .and_then(|s| serde_json::from_str(&s).map_err(|e| e.to_string()))
                })
                .collect::<Result<_, _>>()?;
            Ok(coverage::attribute(&analysis, path, &source, &reports))
        }
        "prepare" => {
            fs::write(
                args.get(2).ok_or("target missing")?,
                analysis.switched(&source)?,
            )
            .map_err(|e| e.to_string())?;
            Ok(json!({"mutants":analysis.count()}))
        }
        "replace" => {
            let id = args
                .get(3)
                .ok_or("mutant ID missing")?
                .parse::<usize>()
                .map_err(|e| e.to_string())?;
            fs::write(
                args.get(2).ok_or("target missing")?,
                analysis.replace(&source, id)?,
            )
            .map_err(|e| e.to_string())?;
            Ok(json!({"mutant":id}))
        }
        _ => Err("unknown proof command".into()),
    }
}
fn finish(mut value: Value) -> (Value, u8) {
    let signal = execution::cancellation_signal();
    if signal != 0 {
        value["complete"] = json!(false);
        value["cancelled"] = json!(true);
        value["signal"] = json!(signal);
        if let Some(mutation) = value.get_mut("mutation") {
            mutation["complete"] = json!(false);
            mutation["score"] = Value::Null;
        }
    }
    let status = if signal != 0 {
        128 + signal as u8
    } else if value["complete"] == false {
        2
    } else {
        0
    };
    (value, status)
}

pub fn proof_main() {
    let value = run(&env::args().skip(1).collect::<Vec<_>>())
        .unwrap_or_else(|error| json!({"complete":false,"error":error}));
    let (value, status) = finish(value);
    println!("{value}");
    std::process::exit(status.into());
}
