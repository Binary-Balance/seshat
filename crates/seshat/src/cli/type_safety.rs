use super::{Thresholds, Value, array, json};

fn count_check(metric: &str, limit: u64, total: Result<Option<u64>, String>) -> Value {
    match total {
        Ok(Some(actual)) => json!({"metric":metric,"limit":limit,"actual":actual,
            "state":if actual > limit { "failed" } else { "passed" }}),
        Ok(None) => json!({"metric":metric,"limit":limit,"actual":null,"state":"not-applicable"}),
        Err(error) => {
            json!({"metric":metric,"limit":limit,"actual":null,"state":"incomplete","error":error})
        }
    }
}

fn escape_total(result: &Value) -> Result<Option<u64>, String> {
    let sources = result["sources"]
        .as_array()
        .ok_or("missing selected source")?;
    let mut total = 0_u64;
    for source in sources {
        let functions = source["result"]["functions"]
            .as_array()
            .ok_or_else(|| format!("missing syntax findings for {}", source["path"]))?;
        let rows = functions
            .iter()
            .map(|function| &function["typeSafety"])
            .chain(std::iter::once(&source["result"]["typeSafety"]["unowned"]));
        for row in rows {
            for field in ["explicitAny", "tsIgnore", "tsExpectError", "tsNocheck"] {
                total = row[field]
                    .as_u64()
                    .and_then(|count| total.checked_add(count))
                    .ok_or_else(|| {
                        format!("missing or invalid {field} count for {}", source["path"])
                    })?;
            }
        }
    }
    Ok((!sources.is_empty()).then_some(total))
}

fn inferred_total(result: &Value, setup: &Value) -> Result<Option<u64>, String> {
    if setup["inferredAny"]["state"] != "known" {
        return Err(format!(
            "inferred any unavailable for setup {}: {}",
            setup["name"], setup["inferredAny"]["error"]
        ));
    }
    let sources = result["sources"]
        .as_array()
        .ok_or("missing selected source")?;
    let setups = array(&result["setups"]);
    let mut total = 0_u64;
    let mut applicable = false;
    for source in sources {
        let unowned = &source["result"]["typeSafety"];
        // A package may be absent from one program, but selected source must be measured somewhere.
        if !array(&unowned["inferredAny"]).iter().any(|finding| {
            finding["state"] == "known"
                && setups.iter().any(|setup| setup["name"] == finding["setup"])
        }) {
            return Err(format!(
                "selected source {} has no known inferred-any findings in any setup",
                source["path"]
            ));
        }
        let functions = source["result"]["functions"]
            .as_array()
            .ok_or_else(|| format!("missing inferred-any findings for {}", source["path"]))?;
        let source_state = array(&unowned["inferredAny"])
            .iter()
            .find(|finding| finding["setup"] == setup["name"])
            .map(|finding| &finding["state"]);
        for row in functions
            .iter()
            .map(|function| &function["typeSafety"])
            .chain(std::iter::once(unowned))
        {
            let finding = array(&row["inferredAny"])
                .iter()
                .find(|finding| finding["setup"] == setup["name"])
                .ok_or_else(|| {
                    format!(
                        "missing inferred-any findings for {} in setup {}",
                        source["path"], setup["name"]
                    )
                })?;
            if source_state != Some(&finding["state"]) {
                return Err(format!(
                    "inconsistent inferred-any findings for {} in setup {}",
                    source["path"], setup["name"]
                ));
            }
            match finding["state"].as_str() {
                Some("known") => {
                    applicable = true;
                    total = finding["count"]
                        .as_u64()
                        .and_then(|count| total.checked_add(count))
                        .ok_or_else(|| {
                            format!(
                                "missing or invalid inferred-any count for {} in setup {}",
                                source["path"], setup["name"]
                            )
                        })?;
                }
                Some("not-in-program") => {}
                _ => {
                    return Err(format!(
                        "unknown inferred-any findings for {} in setup {}",
                        source["path"], setup["name"]
                    ));
                }
            }
        }
    }
    Ok(applicable.then_some(total))
}

pub(super) fn checks(result: &Value, limits: Thresholds) -> Vec<Value> {
    let mut checks = Vec::new();
    if let Some(limit) = limits.max_inferred_any {
        let setups = array(&result["setups"]);
        if setups.is_empty() {
            checks.push(count_check(
                "maxInferredAny",
                limit,
                Err("missing inferred-any setups".into()),
            ));
        }
        for setup in setups {
            let mut check = count_check("maxInferredAny", limit, inferred_total(result, setup));
            check["setup"] = setup["name"].clone();
            checks.push(check);
        }
    }
    if let Some(limit) = limits.max_type_escapes {
        checks.push(count_check("maxTypeEscapes", limit, escape_total(result)));
    }
    checks
}

#[cfg(test)]
mod tests {
    use super::super::{readable, report};
    use super::*;

    fn fixture() -> Value {
        let findings = |one: Option<u64>, two: u64| {
            json!([
                {"setup":"one","state":if one.is_some() { "known" } else { "not-in-program" },"count":one},
                {"setup":"two","state":"known","count":two},
                {"setup":"unused","state":"not-in-program","count":null}
            ])
        };
        let syntax = json!({"explicitAny":1,"tsIgnore":1,"tsExpectError":1,"tsNocheck":1,
            "typeAssertions":99,"doubleAssertions":99,"nonNullAssertions":99});
        let functions: Vec<_> = [1, 2]
            .into_iter()
            .map(|count| {
                let mut row = syntax.clone();
                row["inferredAny"] = findings(Some(count), count);
                json!({"typeSafety":row,"status":if count == 2 { "complexity-only" } else { "measured" }})
            })
            .collect();
        json!({"complete":true,"sources":[
            {"path":"a.ts","result":{"functions":functions,
                "typeSafety":{"unowned":syntax,"inferredAny":findings(Some(3),3)}}},
            {"path":"b.ts","result":{"functions":[],
                "typeSafety":{"unowned":syntax,"inferredAny":findings(None,4)}}}
        ],"setups":[
            {"name":"one","inferredAny":{"state":"known"}},
            {"name":"two","inferredAny":{"state":"known"}},
            {"name":"unused","inferredAny":{"state":"known"}}
        ],"mutation":{"complete":true,"score":75}})
    }

    #[test]
    fn totals_include_all_rows_and_unowned_source_without_summing_setups() {
        let result = fixture();
        for command in ["check", "crap", "mutate"] {
            for (inferred, escapes, status) in [(10, 16, 0), (9, 16, 1), (10, 15, 1)] {
                let limits = Thresholds {
                    max_inferred_any: Some(inferred),
                    max_type_escapes: Some(escapes),
                    ..Thresholds::default()
                };
                let (value, code) = report(
                    Some(command),
                    Value::Null,
                    result.clone(),
                    0.0,
                    None,
                    Some(limits),
                );
                assert_eq!(code, status);
                assert_eq!(value["complete"], true);
                let checks = array(&value["quality"]["checks"]);
                assert_eq!(checks[0]["actual"], 6);
                assert_eq!(checks[1]["actual"], 10);
                assert_eq!(checks[2]["state"], "not-applicable");
                assert!(checks[2]["actual"].is_null());
                assert_eq!(checks[3]["actual"], 16);
                assert_eq!(checks[0]["state"], "passed");
                assert_eq!(
                    checks[1]["state"],
                    if inferred < 10 { "failed" } else { "passed" }
                );
                assert_eq!(
                    checks[3]["state"],
                    if escapes < 16 { "failed" } else { "passed" }
                );
                assert_eq!(value["result"], result);
                assert!(readable(&value).contains("maxInferredAny, setup \"two\""));
            }
        }
    }

    #[test]
    fn unknown_compiler_blocks_only_requested_inferred_checks_and_preserves_evidence() {
        let mut result = fixture();
        result["setups"][1]["inferredAny"] =
            json!({"state":"unknown","error":"compiler unavailable"});
        for limits in [
            Thresholds::default(),
            Thresholds {
                max_type_escapes: Some(16),
                ..Thresholds::default()
            },
        ] {
            let (value, code) = report(
                Some("check"),
                Value::Null,
                result.clone(),
                0.0,
                None,
                Some(limits),
            );
            assert_eq!(code, 0);
            assert_eq!(value["complete"], true);
        }
        let limits = Thresholds {
            max_inferred_any: Some(0),
            min_mutation_score: Some(100.0),
            ..Thresholds::default()
        };
        let (value, code) = report(
            Some("check"),
            Value::Null,
            result.clone(),
            0.0,
            None,
            Some(limits),
        );
        assert_eq!(code, 2);
        assert_eq!(value["complete"], false);
        assert_eq!(value["quality"]["state"], "incomplete");
        assert!(
            array(&value["quality"]["checks"])
                .iter()
                .all(|check| check["state"] == "incomplete" && check["actual"].is_null())
        );
        assert_eq!(value["result"]["sources"], result["sources"]);
        assert_eq!(value["result"]["mutation"], result["mutation"]);
        assert!(readable(&value).contains("compiler unavailable"));
    }

    #[test]
    fn missing_unknown_and_unmeasured_source_cannot_pass_as_zero() {
        let original = fixture();
        let limits = Thresholds {
            max_inferred_any: Some(100),
            ..Thresholds::default()
        };
        for (pointer, malformed) in [
            (
                "/sources/0/result/functions/0/typeSafety/inferredAny",
                json!([]),
            ),
            (
                "/sources/0/result/functions/0/typeSafety/inferredAny/0/count",
                Value::Null,
            ),
            (
                "/sources/0/result/functions/0/typeSafety/inferredAny/0/count",
                json!(-1),
            ),
            (
                "/sources/0/result/functions/0/typeSafety/inferredAny/0/count",
                json!(1.5),
            ),
            (
                "/sources/0/result/functions/0/typeSafety/inferredAny/0/count",
                json!(u64::MAX),
            ),
            (
                "/sources/0/result/functions/0/typeSafety/inferredAny/0/state",
                json!("unknown"),
            ),
            (
                "/sources/1/result/typeSafety/inferredAny/1/state",
                json!("not-in-program"),
            ),
            ("/setups", json!([])),
        ] {
            let mut result = original.clone();
            *result.pointer_mut(pointer).unwrap() = malformed;
            let (value, code) = report(Some("crap"), Value::Null, result, 0.0, None, Some(limits));
            assert_eq!(code, 2, "accepted {pointer}");
            assert_eq!(value["quality"]["state"], "incomplete");
            assert!(
                value["result"]["error"]
                    .as_str()
                    .is_some_and(|error| !error.is_empty())
            );
        }
        let syntax_limits = Thresholds {
            max_type_escapes: Some(100),
            ..Thresholds::default()
        };
        for malformed in [Value::Null, json!(-1), json!("0"), json!(u64::MAX)] {
            let mut result = original.clone();
            result["sources"][1]["result"]["typeSafety"]["unowned"]["explicitAny"] = malformed;
            assert_eq!(
                report(
                    Some("crap"),
                    Value::Null,
                    result,
                    0.0,
                    None,
                    Some(syntax_limits)
                )
                .1,
                2
            );
        }
    }

    #[test]
    fn zero_counts_pass_and_existing_incompleteness_takes_precedence() {
        let mut result = fixture();
        result["sources"] = json!([{"path":"empty.ts","result":{"functions":[],"typeSafety":{
            "unowned":{"explicitAny":0,"tsIgnore":0,"tsExpectError":0,"tsNocheck":0},
            "inferredAny":[{"setup":"one","state":"known","count":0}]
        }}}]);
        result["setups"] = json!([{"name":"one","inferredAny":{"state":"known"}}]);
        let limits = Thresholds {
            max_type_escapes: Some(0),
            max_inferred_any: Some(0),
            ..Thresholds::default()
        };
        let (value, code) = report(
            Some("crap"),
            Value::Null,
            result.clone(),
            0.0,
            None,
            Some(limits),
        );
        assert_eq!(code, 0);
        assert!(
            array(&value["quality"]["checks"])
                .iter()
                .all(|check| check["state"] == "passed" && check["actual"] == 0)
        );
        result["complete"] = json!(false);
        result["error"] = json!("original failure");
        let (value, code) = report(Some("crap"), Value::Null, result, 0.0, None, Some(limits));
        assert_eq!(code, 2);
        assert_eq!(value["result"]["error"], "original failure");
        assert!(
            array(&value["quality"]["checks"])
                .iter()
                .all(|check| check["state"] == "incomplete" && check["actual"].is_null())
        );
    }
}
