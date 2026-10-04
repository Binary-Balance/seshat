use crate::{
    analysis::{Analysis, supports_line_positions},
    assessment,
};
use serde_json::{Value, json};
use std::collections::BTreeMap;

#[derive(PartialEq, Eq, PartialOrd, Ord)]
struct BranchKey {
    kind: String,
    span: (u32, u32),
    outcomes: Vec<Option<(u32, u32)>>,
}

struct Coverage {
    statements: BTreeMap<(u32, u32), bool>,
    branches: BTreeMap<BranchKey, Vec<bool>>,
}

fn byte_position(source: &str, position: &Value, open_end: bool) -> Result<u32, String> {
    let line = position["line"].as_u64().ok_or("missing line")? as usize;
    if line == 0 {
        return Err("coverage lines are one-based".into());
    }
    let mut start = 0;
    for _ in 1..line {
        start += source[start..].find('\n').ok_or("line outside source")? + 1;
    }
    let text = source[start..]
        .split('\n')
        .next()
        .unwrap()
        .trim_end_matches('\r');
    // Istanbul source-map tools use Infinity for an open line end; JSON encodes it as null.
    // A missing column, or null at a start position, is still invalid.
    if open_end && position.get("column") == Some(&Value::Null) {
        return Ok((start + text.len()) as u32);
    }
    let column = position
        .get("column")
        .ok_or("missing column")?
        .as_u64()
        .ok_or("invalid column: expected a non-negative integer")? as usize;
    let mut units = 0;
    for (offset, ch) in text.char_indices() {
        if units == column {
            return Ok((start + offset) as u32);
        }
        units += ch.len_utf16();
        if units > column {
            return Err("column splits a Unicode scalar".into());
        }
    }
    if units == column {
        Ok((start + text.len()) as u32)
    } else {
        Err("column outside source".into())
    }
}

fn same_line_trivia(mut text: &str) -> bool {
    if text.contains(['\r', '\n']) {
        return false;
    }
    loop {
        text = text.trim_start_matches([';', ' ', '\t']);
        if text.is_empty() || text.starts_with("//") {
            return true;
        }
        let Some(comment) = text.strip_prefix("/*") else {
            return false;
        };
        let Some(end) = comment.find("*/") else {
            return false;
        };
        text = &comment[end + 2..];
    }
}

fn span_matches(
    analysis: &Analysis,
    source: &str,
    mapped: (u32, u32),
    expected: oxc_span::Span,
    extension_end: Option<u32>,
) -> bool {
    let extension_end = extension_end.or_else(|| {
        analysis
            .jsx_closing_ranges
            .iter()
            .find(|range| range.start == expected.end)
            .map(|range| range.end)
    });
    mapped.0 == expected.start
        && (mapped.1 == expected.end
            || mapped.1 > expected.end
                && (extension_end.is_some_and(|end| mapped.1 <= end)
                    || same_line_trivia(&source[expected.end as usize..mapped.1 as usize])))
}

fn branch_span(source: &str, location: &Value) -> Result<(u32, u32), String> {
    let start = byte_position(source, &location["start"], false)?;
    let end = byte_position(source, &location["end"], true)?;
    if start >= end {
        return Err("empty or reversed branch span".into());
    }
    Ok((start, end))
}

fn decode_branches(
    analysis: &Analysis,
    source: &str,
    file: &Value,
) -> Result<BTreeMap<BranchKey, Vec<bool>>, String> {
    let locations = file["branchMap"].as_object().ok_or("missing branchMap")?;
    let counters = file["b"].as_object().ok_or("missing branch counters")?;
    if locations.len() != counters.len() {
        return Err("branch/counter mismatch".into());
    }
    let mut map = BTreeMap::new();
    for (id, branch) in locations {
        let kind = branch["type"].as_str().ok_or("missing branch kind")?;
        let span = branch_span(source, &branch["loc"])?;
        // Source maps may extend a default's end through its type annotation
        // and closing parameter delimiters. Stop at the next recorded default
        // or the body, so the range cannot swallow another executable value.
        let parameter_end = analysis.owner(span.0).and_then(|i| {
            let scope = &analysis.scopes[i];
            if kind != "default-arg" || span.0 >= scope.body.start {
                return None;
            }
            Some(
                analysis
                    .branches
                    .iter()
                    .filter(|site| {
                        site.kind == "default-arg"
                            && span.0 < site.span.start
                            && site.span.start < scope.body.start
                    })
                    .map(|site| site.span.start)
                    .min()
                    .unwrap_or(scope.body.start),
            )
        });
        let Some(site) = analysis.branches.iter().find(|site| {
            site.kind == kind && span_matches(analysis, source, span, site.span, parameter_end)
        }) else {
            return Err(format!(
                "coverage is not mapped to a {kind} branch: {}..{}",
                span.0, span.1
            ));
        };
        let outcomes = branch["locations"]
            .as_array()
            .ok_or("missing branch locations")?;
        let hits = counters
            .get(id)
            .and_then(Value::as_array)
            .ok_or("invalid branch counters")?;
        if outcomes.len() != hits.len()
            || outcomes.len() != site.outcomes.len()
            || outcomes.is_empty()
        {
            return Err("branch outcome/counter mismatch".into());
        }
        let mut covered = Vec::new();
        for (index, ((location, hits), expected)) in
            outcomes.iter().zip(hits).zip(&site.outcomes).enumerate()
        {
            match expected {
                Some(expected) => {
                    let mapped = branch_span(source, location)?;
                    // Vitest may include the separating ':' or logical operator
                    // in an outcome's range. Its next outcome proves the boundary.
                    let extension_end = parameter_end.or_else(|| {
                        site.outcomes
                            .get(index + 1)
                            .and_then(|span| span.map(|s| s.start))
                    });
                    if !span_matches(analysis, source, mapped, *expected, extension_end) {
                        return Err(format!(
                            "coverage is not mapped to a {kind} outcome: {}..{}",
                            mapped.0, mapped.1
                        ));
                    }
                }
                None => {
                    // The instrumenter serializes the absent else as empty
                    // positions. Only this AST-proven implicit outcome permits it.
                    if *location != json!({"start":{},"end":{}}) {
                        return Err("invalid implicit else location".into());
                    }
                }
            }
            covered.push(hits.as_u64().ok_or("invalid branch count")? > 0);
        }
        let key = BranchKey {
            kind: kind.into(),
            span: (site.span.start, site.span.end),
            outcomes: site
                .outcomes
                .iter()
                .map(|span| span.map(|s| (s.start, s.end)))
                .collect(),
        };
        if map.insert(key, covered).is_some() {
            return Err("duplicate branch mapping".into());
        }
    }
    Ok(map)
}

pub fn attribute<'a>(
    analysis: &Analysis,
    path: &str,
    source: &str,
    reports: impl IntoIterator<Item = &'a Value>,
) -> Value {
    let mut merged: Option<Coverage> = None;
    let mut problems = Vec::new();
    let mut report_count = 0;
    let supported_positions = supports_line_positions(source);
    for report in reports {
        report_count += 1;
        let Some(file) = report.get(path) else {
            problems.push(format!("missing source coverage: {path}"));
            continue;
        };
        let decode = || -> Result<Coverage, String> {
            // Shifted lines can land on valid statements and silently inflate coverage.
            if !supported_positions {
                return Err(
                    "unsupported source line separator: coverage requires LF or CRLF".into(),
                );
            }
            if file["path"].as_str() != Some(path) {
                return Err("coverage path mismatch".into());
            }
            let locations = file["statementMap"]
                .as_object()
                .ok_or("missing statementMap")?;
            let counters = file["s"].as_object().ok_or("missing statement counters")?;
            if locations.len() != counters.len() {
                return Err("statement/counter mismatch".into());
            }
            let mut map = BTreeMap::new();
            for (id, loc) in locations {
                let start = byte_position(source, &loc["start"], false)?;
                let mut end = byte_position(source, &loc["end"], true)?;
                if let Some(i) = analysis.statement_owner(start) {
                    let scope_end = analysis.scopes[i].span.end;
                    // Vitest can map an arrow/field to an open line end, including
                    // a semicolon or trailing comments outside its AST range.
                    // Never shorten a range over another expression, function, or line.
                    if end > scope_end
                        && same_line_trivia(&source[scope_end as usize..end as usize])
                    {
                        end = scope_end;
                    }
                }
                if start >= end {
                    return Err("empty or reversed statement span".into());
                }
                let hits = counters
                    .get(id)
                    .and_then(Value::as_u64)
                    .ok_or("invalid statement count")?;
                if map.insert((start, end), hits > 0).is_some() {
                    return Err("duplicate statement span".into());
                }
            }
            Ok(Coverage {
                statements: map,
                branches: decode_branches(analysis, source, file)?,
            })
        };
        match decode() {
            Err(e) => problems.push(e),
            Ok(map) => {
                if let Some(previous) = merged.as_mut() {
                    if !previous.statements.keys().eq(map.statements.keys()) {
                        problems.push("incompatible statement mappings".into());
                    } else if !previous.branches.keys().eq(map.branches.keys()) {
                        problems.push("incompatible branch mappings".into());
                    } else {
                        for (key, covered) in map.statements {
                            *previous.statements.get_mut(&key).unwrap() |= covered;
                        }
                        for (key, outcomes) in map.branches {
                            for (previous, covered) in previous
                                .branches
                                .get_mut(&key)
                                .unwrap()
                                .iter_mut()
                                .zip(outcomes)
                            {
                                *previous |= covered;
                            }
                        }
                    }
                } else {
                    merged = Some(map);
                }
            }
        }
    }
    if report_count == 0 {
        problems.push("no coverage reports".into());
    }
    let mut statements = vec![Vec::new(); analysis.scopes.len()];
    let mut branches = vec![Vec::new(); analysis.scopes.len()];
    if let Some(map) = merged.as_ref() {
        for (&(start, end), &hit) in &map.statements {
            if let Some(i) = analysis.statement_owner(start) {
                if end > analysis.scopes[i].span.end {
                    problems.push(format!("statement escapes owning scope: {start}..{end}"));
                } else if !analysis.scopes[i].implicit
                    && !analysis.statement_starts.contains(&start)
                {
                    problems.push(format!(
                        "coverage is not mapped to an executable statement start: {start}"
                    ));
                } else {
                    statements[i].push(hit);
                }
            }
        }
        for (key, outcomes) in &map.branches {
            if let Some(i) = analysis.owner(key.span.0) {
                if key.span.1 > analysis.scopes[i].span.end {
                    problems.push(format!(
                        "branch escapes owning scope: {}..{}",
                        key.span.0, key.span.1
                    ));
                } else {
                    branches[i].extend(outcomes);
                }
            }
        }
    }
    let mut complete = problems.is_empty();
    let rows: Vec<_> = analysis.scopes.iter().enumerate().map(|(i,s)| {
        let total = statements[i].len();
        let covered = statements[i].iter().filter(|&&hit| hit).count();
        let branch_total = branches[i].len();
        let branch_covered = branches[i].iter().filter(|&&hit| hit).count();
        let status = if s.implicit { "complexity-only" } else if s.empty { "not-applicable" }
            else if !problems.is_empty() || total == 0 { complete = false; "unknown" } else { "measured" };
        json!({"name":s.name,"start":s.span.start,"complexity":s.complexity,"status":status,
            "covered":covered,"total":total,"coverage":if status=="measured" {Some(covered as f64/total as f64)}else{None},
            "branchCovered":branch_covered,"branchTotal":branch_total,
            "branchCoverage":if status=="measured" && branch_total > 0 {Some(branch_covered as f64/branch_total as f64)}else{None},
            "coverageBasis":if status=="measured" {Some(if branch_total > 0 {"branch"} else {"statement"})}else{None},
            "crap":if status=="measured" {if branch_total > 0 {assessment::score(s.complexity,branch_covered,branch_total)} else {assessment::score(s.complexity,covered,total)}}else{None}})
    }).collect();
    json!({"complete":complete,"functions":rows,"problems":problems})
}

#[cfg(test)]
fn recorded_fixture() -> (&'static str, Value) {
    // Regenerated by the Node, Jest/Expo and Vitest provider proof. These
    // coordinates are recorded runner output, independent of our AST analysis.
    let source = concat!(
        "export function price(amount: number, member: boolean) {\n",
        "  let total = amount;\n",
        "  if (member) total = amount * 0.9;\n",
        "  return total;\n",
        "}\n",
        "export function conditional(flag: boolean) { return flag ? 1 : 2; }\n",
        "export function logical(value: boolean, other: boolean) { return value && other; }\n",
        "export function nullish(value: string | null) { return value ?? 'missing'; }\n",
        "export function defaults(value = 7) { return value; }\n",
        "export function destructured({value = 7}: {value?: number}) { return value; }\n",
        "export function optional(value: {name: string} | null) { return value?.name; }\n",
        "export function nested(value: boolean) {\n",
        "  const inner = (flag: boolean) => flag ? 1 : 2;\n",
        "  return inner(value);\n",
        "}\n",
        "export function choice(value: number) {\n",
        "  switch (value) { case 1: return 1; case 2: return 2; default: return 3; }\n",
        "}\n",
        "export function straight() { return 1; }\n",
        "export function empty() {}\n",
        "export function parameterOnly(value = 7) {}\n",
    );
    let mut file = json!({"path":"/fixture.tsx","statementMap":{},"s":{},"branchMap":{},"b":{}});
    for (id, (line, start, end, hits)) in [
        (2, 14, 20, 1),
        (3, 2, 35, 1),
        (3, 14, 35, 1),
        (4, 2, 15, 1),
        (6, 45, 65, 1),
        (7, 58, 80, 1),
        (8, 48, 74, 1),
        (9, 38, 51, 1),
        (10, 62, 75, 1),
        (11, 57, 76, 1),
        (13, 16, 47, 1),
        (13, 35, 47, 1),
        (14, 2, 22, 1),
        (17, 2, 75, 1),
        (17, 27, 36, 1),
        (17, 45, 54, 0),
        (17, 64, 73, 0),
        (19, 29, 38, 1),
    ]
    .into_iter()
    .enumerate()
    {
        file["statementMap"][id.to_string()] = recorded_location(line, start, json!(end));
        file["s"][id.to_string()] = json!(hits);
    }
    for (id, (kind, line, start, end, outcomes, hits)) in [
        ("if", 3, 2, 35, vec![Some((2, 35)), None], vec![1, 0]),
        (
            "cond-expr",
            6,
            52,
            64,
            vec![Some((59, 60)), Some((63, 64))],
            vec![1, 0],
        ),
        (
            "binary-expr",
            7,
            65,
            79,
            vec![Some((65, 70)), Some((74, 79))],
            vec![1, 0],
        ),
        (
            "binary-expr",
            8,
            55,
            73,
            vec![Some((55, 60)), Some((64, 73))],
            vec![1, 0],
        ),
        ("default-arg", 9, 25, 34, vec![Some((33, 34))], vec![0]),
        ("default-arg", 10, 30, 39, vec![Some((38, 39))], vec![0]),
        (
            "cond-expr",
            13,
            35,
            47,
            vec![Some((42, 43)), Some((46, 47))],
            vec![1, 0],
        ),
        (
            "switch",
            17,
            2,
            75,
            vec![Some((19, 36)), Some((37, 54)), Some((55, 73))],
            vec![1, 0, 0],
        ),
        ("default-arg", 21, 30, 39, vec![Some((38, 39))], vec![0]),
    ]
    .into_iter()
    .enumerate()
    {
        file["branchMap"][id.to_string()] = json!({
            "type":kind,"loc":recorded_location(line, start, json!(end)),
            "locations":outcomes.into_iter().map(|outcome| outcome.map_or_else(
                || json!({"start":{},"end":{}}),
                |(start,end)| recorded_location(line,start,json!(end))
            )).collect::<Vec<_>>()
        });
        file["b"][id.to_string()] = json!(hits);
    }
    (source, json!({"/fixture.tsx":file}))
}

#[cfg(test)]
fn recorded_location(line: u32, start: u32, end: Value) -> Value {
    json!({"start":{"line":line,"column":start},"end":{"line":line,"column":end}})
}

#[test]
fn recorded_branches_drive_crap_without_changing_statement_coverage() {
    let path = "/fixture.tsx";
    let (source, report) = recorded_fixture();
    let analysis = Analysis::inspect(path, source).unwrap();
    let result = attribute(&analysis, path, source, [&report]);
    assert_eq!(result["problems"], json!([]));
    let rows = result["functions"].as_array().unwrap();
    for name in ["price", "conditional", "logical", "nullish"] {
        let row = rows.iter().find(|row| row["name"] == name).unwrap();
        assert_eq!(row["status"], "measured", "{row}");
        assert_eq!(row["coverage"], 1.0);
        assert_eq!(row["branchCovered"], 1);
        assert_eq!(row["branchTotal"], 2);
        assert_eq!(row["branchCoverage"], 0.5);
        assert_eq!(row["coverageBasis"], "branch");
        assert_eq!(row["crap"], 2.5);
    }
    for name in ["defaults", "destructured"] {
        let row = rows.iter().find(|row| row["name"] == name).unwrap();
        assert_eq!(row["coverage"], 1.0);
        assert_eq!(row["branchTotal"], 1);
        assert_eq!(row["branchCovered"], 0);
        assert_eq!(row["branchCoverage"], 0.0);
        assert_eq!(row["crap"], 6.0);
    }
    for (name, complexity) in [("optional", 2.0), ("nested", 1.0), ("straight", 1.0)] {
        let row = rows.iter().find(|row| row["name"] == name).unwrap();
        assert_eq!(row["coverageBasis"], "statement");
        assert_eq!(row["branchTotal"], 0);
        assert_eq!(row["branchCoverage"], Value::Null);
        assert_eq!(row["crap"], complexity);
    }
    let arrow = rows
        .iter()
        .find(|row| row["name"].as_str().unwrap().starts_with("arrow@"))
        .unwrap();
    assert_eq!(arrow["branchTotal"], 2);
    assert_eq!(arrow["crap"], 2.5);
    let switch = rows.iter().find(|row| row["name"] == "choice").unwrap();
    assert_eq!(switch["branchCovered"], 1);
    assert_eq!(switch["branchTotal"], 3);
    assert_eq!(switch["coverage"], 0.5);
    let empty = rows.iter().find(|row| row["name"] == "empty").unwrap();
    assert_eq!(empty["status"], "not-applicable");
    assert_eq!(empty["coverageBasis"], Value::Null);
    // A branch counter alone cannot establish statement coverage in a function
    // whose parameters execute but whose body has no mapped statements.
    let parameter_only = rows
        .iter()
        .find(|row| row["name"] == "parameterOnly")
        .unwrap();
    assert_eq!(parameter_only["status"], "unknown");
    assert_eq!(parameter_only["branchTotal"], 1);
    assert_eq!(parameter_only["branchCoverage"], Value::Null);
    assert_eq!(parameter_only["coverageBasis"], Value::Null);
    assert_eq!(parameter_only["crap"], Value::Null);
    assert_eq!(result["complete"], false);
}

#[test]
fn provider_end_extensions_normalize_before_branch_hit_merging() {
    let path = "/fixture.tsx";
    let (source, report) = recorded_fixture();
    let analysis = Analysis::inspect(path, source).unwrap();
    let mut widened = report.clone();
    // Actual Vitest mapped branch ends. Retain identical statement mappings to
    // isolate branch compatibility from the independently checked statement map.
    for (id, end, outcome_ends) in [
        (0, Value::Null, vec![Value::Null, json!(null)]),
        (1, json!(66), vec![json!(63), json!(66)]),
        (2, json!(81), vec![json!(74), json!(81)]),
        (3, json!(75), vec![json!(64), json!(75)]),
        (4, json!(36), vec![json!(36)]),
        (5, json!(60), vec![json!(60)]),
        (6, Value::Null, vec![json!(46), Value::Null]),
        (7, Value::Null, vec![json!(37), json!(55), json!(74)]),
        (8, json!(41), vec![json!(41)]),
    ] {
        let branch = &mut widened[path]["branchMap"][id.to_string()];
        branch["loc"]["end"]["column"] = end;
        for (index, end) in outcome_ends.into_iter().enumerate() {
            if branch["locations"][index]["end"] != json!({}) {
                branch["locations"][index]["end"]["column"] = end;
            }
        }
    }
    let reference = attribute(&analysis, path, source, [&report]);
    assert_eq!(attribute(&analysis, path, source, [&widened]), reference);
    widened[path]["b"]["0"] = json!([0, 3]);
    let merged = attribute(&analysis, path, source, [&report, &widened]);
    assert_eq!(merged["problems"], json!([]));
    assert_eq!(merged["functions"][0]["branchCovered"], 2);
    assert_eq!(merged["functions"][0]["branchCoverage"], 1.0);
    assert_eq!(merged["functions"][0]["crap"], 2.0);
    // Branch IDs are runner-local. Source identity determines compatibility.
    widened[path]["branchMap"]["other"] = widened[path]["branchMap"]["0"].take();
    widened[path]["branchMap"]
        .as_object_mut()
        .unwrap()
        .remove("0");
    widened[path]["b"]["other"] = widened[path]["b"]["0"].take();
    widened[path]["b"].as_object_mut().unwrap().remove("0");
    assert_eq!(
        attribute(&analysis, path, source, [&report, &widened]),
        merged
    );
}

#[test]
fn missing_malformed_and_shifted_branch_evidence_never_falls_back() {
    let path = "/fixture.tsx";
    let (source, report) = recorded_fixture();
    let analysis = Analysis::inspect(path, source).unwrap();
    for (pointer, malformed) in [
        ("/branchMap", Value::Null),
        ("/b", Value::Null),
        ("/branchMap/0/type", json!("unknown")),
        ("/branchMap/0/loc/start/column", json!(3)),
        ("/branchMap/0/loc/end/column", json!(2)),
        ("/branchMap/0/loc/end/column", json!(999)),
        ("/branchMap/0/locations/0/start/column", json!(14)),
        (
            "/branchMap/0/locations/1",
            recorded_location(3, 2, json!(35)),
        ),
        ("/branchMap/1/locations/0/end/column", json!(59)),
        ("/branchMap/4/loc/end/column", json!(37)),
        ("/branchMap/5/locations/0/end/column", json!(61)),
        ("/branchMap/0/locations", json!([])),
        ("/b/0", json!([1])),
        ("/b/0", json!([1, 0, 0])),
        ("/b/0", json!([1, -1])),
        ("/b/0", json!([1, 0.5])),
        ("/b/0", json!([1, "0"])),
        ("/b/0", json!([1, true])),
        ("/b/0", json!([1, null])),
    ] {
        let mut invalid = report.clone();
        *invalid[path].pointer_mut(pointer).unwrap() = malformed;
        let result = attribute(&analysis, path, source, [&invalid]);
        assert_eq!(result["complete"], false, "{pointer}: {result}");
        assert!(
            !result["problems"].as_array().unwrap().is_empty(),
            "{pointer}: {result}"
        );
        assert_eq!(result["functions"][0]["status"], "unknown");
        assert_eq!(result["functions"][0]["coverage"], Value::Null);
        assert_eq!(result["functions"][0]["branchCoverage"], Value::Null);
        assert_eq!(result["functions"][0]["coverageBasis"], Value::Null);
        assert_eq!(result["functions"][0]["crap"], Value::Null);
    }
    let mut duplicate = report.clone();
    duplicate[path]["branchMap"]["extra"] = duplicate[path]["branchMap"]["0"].clone();
    duplicate[path]["b"]["extra"] = json!([1, 1]);
    let result = attribute(&analysis, path, source, [&duplicate]);
    assert_eq!(result["problems"], json!(["duplicate branch mapping"]));

    let mut missing_counter = report.clone();
    missing_counter[path]["b"]
        .as_object_mut()
        .unwrap()
        .remove("0");
    let result = attribute(&analysis, path, source, [&missing_counter]);
    assert_eq!(result["problems"], json!(["branch/counter mismatch"]));
    let mut incompatible = report.clone();
    incompatible[path]["branchMap"]
        .as_object_mut()
        .unwrap()
        .remove("0");
    incompatible[path]["b"].as_object_mut().unwrap().remove("0");
    let result = attribute(&analysis, path, source, [&report, &incompatible]);
    assert_eq!(result["problems"], json!(["incompatible branch mappings"]));
    assert_eq!(result["functions"][0]["crap"], Value::Null);
}

#[test]
fn flattened_logical_branches_cannot_be_counted_again_as_nested_sites() {
    let path = "/fixture.js";
    let source = "function f(a,b,c) { return a && (b || c); }";
    let analysis = Analysis::inspect(path, source).unwrap();
    let mut report = json!({path:{"path":path,
        "statementMap":{"0":recorded_location(1,20,json!(41))},"s":{"0":1},
        "branchMap":{"0":{"type":"binary-expr","loc":recorded_location(1,27,json!(40)),
            "locations":[recorded_location(1,27,json!(28)),recorded_location(1,33,json!(34)),recorded_location(1,38,json!(39))]}},
        "b":{"0":[1,1,0]}
    }});
    let result = attribute(&analysis, path, source, [&report]);
    assert_eq!(result["complete"], true, "{result}");
    assert_eq!(result["functions"][0]["complexity"], 3);
    assert_eq!(result["functions"][0]["branchCovered"], 2);
    assert_eq!(result["functions"][0]["branchTotal"], 3);
    report[path]["branchMap"]["1"] = json!({"type":"binary-expr","loc":recorded_location(1,33,json!(39)),
        "locations":[recorded_location(1,33,json!(34)),recorded_location(1,38,json!(39))]});
    report[path]["b"]["1"] = json!([1, 0]);
    let invalid = attribute(&analysis, path, source, [&report]);
    assert_eq!(invalid["complete"], false);
    assert_eq!(invalid["functions"][0]["crap"], Value::Null);
}

#[test]
fn functions_in_default_parameters_own_their_internal_branches() {
    let path = "/fixture.js";
    let source = "function outer(value = () => flag ? 1 : 2) { return value; }";
    let analysis = Analysis::inspect(path, source).unwrap();
    let report = json!({path:{"path":path,
        "statementMap":{"0":recorded_location(1,29,json!(41)),"1":recorded_location(1,45,json!(58))},"s":{"0":1,"1":1},
        "branchMap":{
            "0":{"type":"default-arg","loc":recorded_location(1,15,json!(41)),"locations":[recorded_location(1,23,json!(41))]},
            "1":{"type":"cond-expr","loc":recorded_location(1,29,json!(41)),"locations":[recorded_location(1,36,json!(37)),recorded_location(1,40,json!(41))]}
        },"b":{"0":[1],"1":[1,0]}
    }});
    let result = attribute(&analysis, path, source, [&report]);
    assert_eq!(result["complete"], true, "{result}");
    assert_eq!(result["functions"][0]["branchTotal"], 1);
    assert_eq!(result["functions"][0]["crap"], 2.0);
    assert_eq!(result["functions"][1]["branchTotal"], 2);
    assert_eq!(result["functions"][1]["crap"], 2.5);
}

#[test]
fn jsx_closing_delimiters_do_not_allow_other_executable_children_or_code() {
    let path = "/fixture.tsx";
    let source = "export const view = (n: number) => <span>{n >= 18 ? 'adult' : 'minor'}</span>;";
    let report = json!({path:{"path":path,
        "statementMap":{"0":recorded_location(1,35,json!(77))},"s":{"0":1},
        "branchMap":{"0":{"type":"cond-expr","loc":recorded_location(1,42,json!(69)),
            "locations":[recorded_location(1,52,json!(59)),recorded_location(1,62,json!(69))]}},
        "b":{"0":[1,0]}
    }});
    let analysis = Analysis::inspect(path, source).unwrap();
    let reference = attribute(&analysis, path, source, [&report]);
    assert_eq!(reference["complete"], true, "{reference}");
    assert_eq!(reference["functions"][0]["crap"], 2.5);
    let mut widened = report.clone();
    // Actual mapped Vitest ends include `}</span` and the first outcome's ':'.
    widened[path]["branchMap"]["0"]["loc"]["end"]["column"] = json!(76);
    widened[path]["branchMap"]["0"]["locations"][0]["end"]["column"] = json!(62);
    widened[path]["branchMap"]["0"]["locations"][1]["end"]["column"] = json!(76);
    assert_eq!(attribute(&analysis, path, source, [&widened]), reference);
    assert_eq!(
        attribute(&analysis, path, source, [&report, &widened]),
        reference
    );

    for source in [
        source.replace("}</span>", "}{sideEffect()}</span>"),
        source.replace("}</span>", "}<Other value={sideEffect()} /></span>"),
        source.replace("</span>;", "</span> + sideEffect();"),
    ] {
        let analysis = Analysis::inspect(path, &source).unwrap();
        let mut invalid = widened.clone();
        invalid[path]["statementMap"]["0"]["end"]["column"] = json!(source.len() - 1);
        for extend_branch in [true, false] {
            invalid[path]["branchMap"]["0"]["loc"]["end"]["column"] = if extend_branch {
                json!(source.len() - 1)
            } else {
                json!(69)
            };
            invalid[path]["branchMap"]["0"]["locations"][1]["end"]["column"] =
                json!(source.len() - 1);
            let result = attribute(&analysis, path, &source, [&invalid]);
            assert_eq!(result["complete"], false, "{source}: {result}");
            assert_eq!(result["functions"][0]["crap"], Value::Null);
            assert!(
                result["problems"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|problem| problem.as_str().unwrap().contains("cond-expr")),
                "{result}"
            );
        }
    }
}

#[test]
fn empty_bodies_require_non_executing_parameters() {
    let path = "/fixture.ts";
    let report = json!({path:{"path":path,"branchMap":{},"b":{},"statementMap":{},"s":{}}});
    for (parameters, empty) in [
        ("", true),
        ("x: number", true),
        ("x: number, optional?: string", true),
        ("x = sideEffect()", false),
        ("{x}: {x: number}", false),
        ("[x]: number[]", false),
        ("{x = sideEffect()}: {x?: number}", false),
        ("...items: number[]", false),
    ] {
        for source in [
            format!("function noop({parameters}) {{}}"),
            format!("const noop = function ({parameters}) {{}};"),
            format!("const noop = ({parameters}) => {{}};"),
        ] {
            let analysis = Analysis::inspect(path, &source).unwrap();
            assert_eq!(analysis.scopes.len(), 1, "{source}");
            let result = attribute(&analysis, path, &source, [&report]);
            assert_eq!(result["complete"], empty, "{source}: {result}");
            let row = &result["functions"][0];
            assert_eq!(
                row["status"],
                if empty { "not-applicable" } else { "unknown" }
            );
            assert_eq!(row["coverage"], Value::Null);
            assert_eq!(row["crap"], Value::Null);
        }
    }
    for (source, empty) in [
        ("class C { constructor(x: number) {} }", true),
        ("class C { constructor(public x: number) {} }", false),
        ("class C { constructor(readonly x: number) {} }", false),
        ("class C { method(@decorate x: number) {} }", false),
        ("function noop(this: object, x: number) {}", true),
        ("function noop(x: number) { 'use strict'; }", false),
        ("function noop(x: number) { return; }", false),
        ("const noop = (x: number) => x;", false),
    ] {
        let analysis = Analysis::inspect(path, source).unwrap();
        assert_eq!(analysis.scopes.len(), 1, "{source}");
        let result = attribute(&analysis, path, source, [&report]);
        assert_eq!(result["complete"], empty, "{source}: {result}");
        assert_eq!(
            result["functions"][0]["status"],
            if empty { "not-applicable" } else { "unknown" }
        );
        assert_eq!(result["functions"][0]["coverage"], Value::Null);
        assert_eq!(result["functions"][0]["crap"], Value::Null);
    }
}

#[test]
fn declarations_without_bodies_do_not_create_coverage_rows() {
    let path = "/fixture.ts";
    let report = json!({path:{"path":path,"branchMap":{},"b":{},"statementMap":{},"s":{}}});
    for source in [
        "declare function noop(x: number): void;",
        "declare class C { constructor(x: number); method(x: number): void; }",
        "abstract class C { abstract method(x: number): void; }",
        "interface C { method(x: number): void; }",
    ] {
        let analysis = Analysis::inspect(path, source).unwrap();
        assert!(analysis.scopes.is_empty(), "{source}");
        let result = attribute(&analysis, path, source, [&report]);
        assert_eq!(result["complete"], true, "{source}: {result}");
        assert_eq!(result["functions"], json!([]));
    }
    let source = "function noop(x: number): void; function noop(x: number) {}";
    let analysis = Analysis::inspect(path, source).unwrap();
    assert_eq!(analysis.scopes.len(), 1);
    let result = attribute(&analysis, path, source, [&report]);
    assert_eq!(result["complete"], true, "{result}");
    assert_eq!(result["functions"][0]["status"], "not-applicable");
}

#[test]
fn istanbul_label_and_debugger_mappings() {
    let path = "/fixture.ts";
    // Statement spans emitted by istanbul-lib-instrument 6.0.3. The provider
    // proof regenerates these alongside nearby syntax controls.
    for (source, spans) in [
        (
            "function f() { outer: for (let i = 0; i < 1; i++) { break outer; } }",
            vec![(15, 66), (22, 66), (35, 36), (52, 64)],
        ),
        ("function f() { debugger; }", vec![(15, 24)]),
    ] {
        let analysis = Analysis::inspect(path, source).unwrap();
        for hits in [0, 1] {
            let mut file = json!({"path":path,"branchMap":{},"b":{},"statementMap":{},"s":{}});
            for (id, &(start, end)) in spans.iter().enumerate() {
                file["statementMap"][id.to_string()] = json!({
                    "start":{"line":1,"column":start},
                    "end":{"line":1,"column":end}
                });
                file["s"][id.to_string()] = json!(hits);
            }
            let mut report = json!({path:file});
            let result = attribute(&analysis, path, source, [&report]);
            assert_eq!(result["complete"], true, "{result}");
            assert_eq!(result["functions"][0]["total"], spans.len());
            assert_eq!(result["functions"][0]["covered"], spans.len() * hits);
            assert_eq!(result["functions"][0]["coverage"], hits as f64);

            report[path]["statementMap"]["0"]["start"]["column"] = json!(16);
            let invalid = attribute(&analysis, path, source, [&report]);
            assert_eq!(invalid["complete"], false);
            assert_eq!(
                invalid["problems"],
                json!(["coverage is not mapped to an executable statement start: 16"])
            );
            assert_eq!(invalid["functions"][0]["crap"], Value::Null);
        }
    }
}

#[test]
fn remapped_line_ends_allow_comments_but_not_code_or_newlines() {
    let path = "/fixture.ts";
    for (suffix, complete) in [
        (";", true),
        ("; // trailing 🎸", true),
        ("; /* trailing */", true),
        ("; /* one */ /* two */ // end", true),
        ("; /* trailing */ other();", false),
        ("; const next = () => 2;", false),
        ("; /* spanning\ncomment */", false),
    ] {
        let source = format!("const arrow = () => 1{suffix}\n");
        let analysis = Analysis::inspect(path, &source).unwrap();
        let report = json!({path:{"path":path,"branchMap":{},"b":{},"statementMap":{"0":{
            "start":{"line":1,"column":20},"end":{"line":1,"column":null}
        }},"s":{"0":1}}});
        let result = attribute(&analysis, path, &source, [&report]);
        assert_eq!(result["complete"], complete, "{source}: {result}");
        assert_eq!(
            result["functions"][0]["coverage"],
            if complete { json!(1.0) } else { Value::Null }
        );
    }
    assert!(!same_line_trivia("; // trailing\n"));
    assert!(!same_line_trivia("; /* spanning\ncomment */"));
}

#[test]
fn coincident_spans_and_incompatible_reports_stay_incomplete() {
    let path = "/fixture.ts";
    let source = "const arrow = () => 1; // trailing\n";
    let analysis = Analysis::inspect(path, source).unwrap();
    let report = json!({path:{"path":path,"branchMap":{},"b":{},"statementMap":{"0":{
        "start":{"line":1,"column":20},"end":{"line":1,"column":21}
    }},"s":{"0":0}}});
    for end in [json!(21), Value::Null] {
        let mut duplicate = report.clone();
        duplicate[path]["statementMap"]["1"] = json!({
            "start":{"line":1,"column":20},"end":{"line":1,"column":end}
        });
        duplicate[path]["s"]["1"] = json!(1);
        let result = attribute(&analysis, path, source, [&duplicate]);
        assert_eq!(result["complete"], false);
        assert_eq!(result["problems"], json!(["duplicate statement span"]));
        assert_eq!(result["functions"][0]["coverage"], Value::Null);
    }
    let empty = json!({path:{"path":path,"branchMap":{},"b":{},"statementMap":{},"s":{}}});
    let result = attribute(&analysis, path, source, [&report, &empty]);
    assert_eq!(result["complete"], false);
    assert_eq!(
        result["problems"],
        json!(["incompatible statement mappings"])
    );
    assert_eq!(result["functions"][0]["coverage"], Value::Null);
}

#[test]
fn unicode_positions() {
    assert_eq!(
        byte_position("a🎸b\nc", &json!({"line":1,"column":3}), false),
        Ok(5)
    );
    assert!(byte_position("a🎸b", &json!({"line":1,"column":2}), false).is_err());
    assert_eq!(
        byte_position("a🎸b\nc", &json!({"line":2,"column":0}), false),
        Ok(7)
    );
}

#[test]
fn open_ends_are_not_missing_positions() {
    let end = json!({"line":1,"column":null});
    assert_eq!(byte_position("a🎸b\r\nc", &end, true), Ok(6));
    assert!(byte_position("a🎸b", &end, false).is_err());
    assert!(byte_position("a🎸b", &json!({"line":1}), true).is_err());
    assert!(byte_position("a🎸b", &json!({"line":2,"column":null}), true).is_err());
}

#[test]
fn malformed_columns_are_not_missing_columns() {
    let path = "/fixture.ts";
    let source = "function f() { return 1; }";
    let analysis = Analysis::inspect(path, source).unwrap();
    for endpoint in ["start", "end"] {
        for column in [
            json!(-1),
            json!(1.5),
            json!("15"),
            json!(true),
            json!([]),
            json!({}),
        ] {
            let mut report = json!({path:{"path":path,"branchMap":{},"b":{},"statementMap":{"0":{
                "start":{"line":1,"column":15},"end":{"line":1,"column":24}
            }},"s":{"0":1}}});
            report[path]["statementMap"]["0"][endpoint]["column"] = column;
            let result = attribute(&analysis, path, source, [&report]);
            assert_eq!(result["complete"], false);
            assert_eq!(result["functions"][0]["crap"], Value::Null);
            assert_eq!(
                result["problems"],
                json!(["invalid column: expected a non-negative integer"])
            );
        }
    }
    assert_eq!(
        byte_position(source, &json!({"line":1}), false),
        Err("missing column".into())
    );
    assert_eq!(
        byte_position(source, &json!({"line":1,"column":null}), false),
        Err("invalid column: expected a non-negative integer".into())
    );
}

#[test]
fn parenthesized_arrow_return_has_an_executable_inner_start() {
    let path = "/fixture.ts";
    let source = "const make = () => (({value: 1}));";
    let analysis = Analysis::inspect(path, source).unwrap();
    let report = json!({path:{"path":path,"branchMap":{},"b":{},"statementMap":{"0":{
        "start":{"line":1,"column":source.find('{').unwrap()},
        "end":{"line":1,"column":source.find('}').unwrap()+1}
    }},"s":{"0":1}}});
    let result = attribute(&analysis, path, source, std::slice::from_ref(&report));
    assert_eq!(result["complete"], true, "{result}");
    assert_eq!(result["functions"][0]["total"], 1);
    assert_eq!(result["functions"][0]["crap"], 1.0);
    // A location inside the returned object is not its executable expression start.
    let mut invalid = report;
    invalid[path]["statementMap"]["0"]["start"]["column"] = json!(source.find("value").unwrap());
    assert_eq!(
        attribute(&analysis, path, source, &[invalid])["complete"],
        false
    );
}

#[test]
fn line_separators_cannot_inflate_coverage() {
    let path = "/fixture.ts";
    // Actual Istanbul mappings/counters for the reproduction in issue #59.
    let report = json!({path:{"path":path,"branchMap":{},"b":{},"statementMap":{
        "0":{"start":{"line":2,"column":0},"end":{"line":2,"column":9}},
        "1":{"start":{"line":3,"column":0},"end":{"line":3,"column":9}},
        "2":{"start":{"line":4,"column":16},"end":{"line":4,"column":17}}
    },"s":{"0":1,"1":0,"2":1}}});
    for separator in ["\n", "\r\n", "\r", "\u{2028}", "\u{2029}"] {
        let source = format!(
            "function f() {{{separator}return 1;\nreturn 2; }}\nconst outside = 3;\n// padding long enough to accept mapped columns\n"
        );
        let analysis = Analysis::inspect(path, &source).unwrap();
        let result = attribute(&analysis, path, &source, [&report]);
        let row = &result["functions"][0];
        if separator == "\n" || separator == "\r\n" {
            assert_eq!(result["complete"], true, "{result}");
            assert_eq!(row["coverage"], 0.5);
            assert_eq!(row["total"], 2);
        } else {
            assert_eq!(result["complete"], false, "{result}");
            assert_eq!(row["status"], "unknown");
            assert_eq!(row["coverage"], Value::Null);
            assert_eq!(row["crap"], Value::Null);
            assert_eq!(
                result["problems"],
                json!(["unsupported source line separator: coverage requires LF or CRLF"])
            );
        }
    }
}
