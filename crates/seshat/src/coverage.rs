use crate::{
    analysis::{Analysis, supports_line_positions},
    assessment,
};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

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

#[derive(Default)]
struct BranchCoverage {
    map: BTreeMap<BranchKey, Vec<bool>>,
    unreliable: BTreeSet<usize>,
    problems: Vec<String>,
}

impl BranchCoverage {
    fn invalidate(&mut self, analysis: &Analysis, owner: Option<usize>, problem: String) {
        if let Some(owner) = owner {
            self.unreliable.insert(owner);
        } else {
            self.unreliable.extend(0..analysis.scopes.len());
        }
        self.problems.push(problem);
    }
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
    // AST ranges cover punctuation, whitespace and empty JSX containers.
    // Combining adjacent ranges handles enclosing expressions.
    let closing_end = analysis
        .branch_end_ranges
        .iter()
        .fold(expected.end, |end, range| {
            if range.start <= end && end < range.end {
                range.end
            } else {
                end
            }
        });
    let end = closing_end.max(extension_end.unwrap_or(expected.end));
    mapped.0 == expected.start
        && mapped.1 >= expected.end
        && (mapped.1 <= end || same_line_trivia(&source[end as usize..mapped.1 as usize]))
}

fn branch_span(source: &str, location: &Value) -> Result<(u32, u32), String> {
    let start = byte_position(source, &location["start"], false)?;
    let end = byte_position(source, &location["end"], true)?;
    if start >= end {
        return Err("empty or reversed branch span".into());
    }
    Ok((start, end))
}

fn decode_branch(
    analysis: &Analysis,
    source: &str,
    branch: &Value,
    counter: Option<&Value>,
) -> Result<(BranchKey, Vec<bool>), String> {
    let kind = branch["type"].as_str().ok_or("missing branch kind")?;
    let span = branch_span(source, &branch["loc"])?;
    // Source maps may extend a default's end through its type annotation
    // and closing parameter delimiters. Stop before the next executable
    // parameter value, including computed keys and decorators.
    let parameter_end = analysis.owner(span.0).and_then(|i| {
        let scope = &analysis.scopes[i];
        if kind != "default-arg" || span.0 >= scope.body.start {
            return None;
        }
        let site_end = analysis
            .branches
            .iter()
            .find(|site| site.kind == kind && site.span.start == span.0)?
            .span
            .end;
        Some(
            analysis
                .parameter_values
                .iter()
                .filter(|value| {
                    site_end <= value.start
                        && value.start < scope.body.start
                        // Creating a function-valued default belongs to the
                        // containing function; its body has its own scope.
                        && analysis.statement_owner(value.start) == Some(i)
                })
                .map(|value| value.start)
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
    if analysis.coverage_ignored(site.span.start) {
        return Err("coverage retains an ignored branch".into());
    }
    let expected_outcomes: Vec<_> = site
        .outcomes
        .iter()
        .enumerate()
        .filter(|(index, _)| !analysis.coverage_outcome_ignored(site, *index))
        .map(|(_, outcome)| outcome)
        .collect();
    let outcomes = branch["locations"]
        .as_array()
        .ok_or("missing branch locations")?;
    let hits = counter
        .and_then(Value::as_array)
        .ok_or("invalid branch counters")?;
    if outcomes.len() != hits.len()
        || outcomes.len() != expected_outcomes.len()
        || outcomes.is_empty()
    {
        return Err("branch outcome/counter mismatch".into());
    }
    let mut covered = Vec::new();
    for ((location, hits), expected) in outcomes.iter().zip(hits).zip(&expected_outcomes) {
        match expected {
            Some(expected) => {
                let mapped = branch_span(source, location)?;
                if !span_matches(analysis, source, mapped, *expected, parameter_end) {
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
        outcomes: expected_outcomes
            .iter()
            .map(|span| span.map(|s| (s.start, s.end)))
            .collect(),
    };
    Ok((key, covered))
}

fn decode_branches(analysis: &Analysis, source: &str, file: &Value) -> BranchCoverage {
    let mut result = BranchCoverage::default();
    let decode = || -> Result<_, String> {
        let locations = file["branchMap"].as_object().ok_or("missing branchMap")?;
        let counters = file["b"].as_object().ok_or("missing branch counters")?;
        if !locations.keys().eq(counters.keys()) {
            return Err("branch/counter mismatch".into());
        }
        Ok((locations, counters))
    };
    let (locations, counters) = match decode() {
        Ok(maps) => maps,
        Err(error) => {
            result.invalidate(analysis, None, error);
            return result;
        }
    };
    for (id, branch) in locations {
        // Main and outcome locations must agree on the affected owner. A
        // conflicting map cannot establish whose branch evidence was lost.
        let owner = || {
            branch_span(source, &branch["loc"]).ok().and_then(|span| {
                let site = analysis
                    .branches
                    .iter()
                    .find(|site| site.span.start == span.0)?;
                analysis.owner(span.0).filter(|&i| {
                    let scope = &analysis.scopes[i];
                    span.1 <= scope.span.end
                        && branch["locations"].as_array().is_some_and(|locations| {
                            locations.iter().enumerate().all(|(index, location)| {
                                if *location == json!({"start":{},"end":{}}) {
                                    return true;
                                }
                                branch_span(source, location).is_ok_and(|outcome| {
                                    scope.span.start <= outcome.0
                                        && outcome.1 <= scope.span.end
                                        && (analysis.owner(outcome.0) == Some(i)
                                        // Creating a function-valued outcome
                                        // belongs to the containing branch.
                                        || site.outcomes.iter().enumerate()
                                            .filter(|(index, _)| !analysis.coverage_outcome_ignored(site, *index))
                                            .nth(index).and_then(|(_, span)| *span)
                                            .is_some_and(|span| span.start == outcome.0))
                                })
                            })
                        })
                })
            })
        };
        match decode_branch(analysis, source, branch, counters.get(id)) {
            Err(error) => result.invalidate(analysis, owner(), error),
            Ok((key, covered)) => {
                if result.map.insert(key, covered).is_some() {
                    result.invalidate(analysis, owner(), "duplicate branch mapping".into());
                }
            }
        }
    }
    for site in &analysis.branches {
        if let Some(owner) = analysis.owner(site.span.start)
            && analysis.scopes[owner].coverage_partial_suppression
            && !analysis.scopes[owner].coverage_suppressed
            && !analysis.coverage_ignored(site.span.start)
            && (0..site.outcomes.len()).any(|index| !analysis.coverage_outcome_ignored(site, index))
            && !result
                .map
                .keys()
                .any(|key| key.kind == site.kind && key.span.0 == site.span.start)
        {
            result.invalidate(
                analysis,
                Some(owner),
                format!("missing retained branch at {}", site.span.start),
            );
        }
    }
    result
}

fn function_suppression_conflicts(
    analysis: &Analysis,
    source: &str,
    file: &Value,
) -> Result<BTreeSet<usize>, String> {
    if file.get("fnMap").is_none() && file.get("f").is_none() {
        return Ok(BTreeSet::new());
    }
    let locations = file["fnMap"].as_object().ok_or("invalid function map")?;
    let counters = file["f"].as_object().ok_or("invalid function counters")?;
    if !locations.keys().eq(counters.keys()) {
        return Err("function/counter mismatch".into());
    }
    let mut conflicts = BTreeSet::new();
    for (id, function) in locations {
        counters[id].as_u64().ok_or("invalid function count")?;
        let start = byte_position(source, &function["loc"]["start"], false)?;
        let owner = analysis
            .owner(start)
            .ok_or("function record outside analyzed scopes")?;
        // A record proves instrumentation exists even when its invocation count is zero.
        if analysis.scopes[owner].coverage_suppressed && !analysis.scopes[owner].implicit {
            conflicts.insert(owner);
        }
    }
    Ok(conflicts)
}

pub fn attribute<'a>(
    analysis: &Analysis,
    path: &str,
    source: &str,
    reports: impl IntoIterator<Item = &'a Value>,
) -> Value {
    let mut merged: Option<Coverage> = None;
    let mut problems = analysis.coverage_hint_errors.clone();
    let mut statements_reliable = analysis.coverage_hint_errors.is_empty();
    let mut unreliable_branches = BTreeSet::new();
    let mut unreliable_suppressions = BTreeSet::new();
    let mut report_count = 0;
    let supported_positions = supports_line_positions(source);
    for report in reports {
        report_count += 1;
        let Some(file) = report.get(path) else {
            // Istanbul omits the entire entry when a file-level hint disables instrumentation.
            if analysis.coverage_ignored_file && supported_positions {
                continue;
            }
            problems.push(format!("missing source coverage: {path}"));
            statements_reliable = false;
            continue;
        };
        let decode = || -> Result<BTreeMap<(u32, u32), bool>, String> {
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
            let mut retained_statements = BTreeSet::new();
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
                if analysis.coverage_statement_ignored(start) {
                    return Err(format!("coverage retains an ignored statement at {start}"));
                }
                if let Some(owner) = analysis.statement_owner(start)
                    && analysis.scopes[owner].coverage_partial_suppression
                    && !analysis.scopes[owner].coverage_suppressed
                    && !analysis.scopes[owner].implicit
                {
                    let Some((index, _)) =
                        analysis
                            .coverage_statements
                            .iter()
                            .enumerate()
                            .find(|(_, statement)| {
                                span_matches(analysis, source, (start, end), statement.span, None)
                                    || span_matches(
                                        analysis,
                                        source,
                                        (start, end),
                                        statement.unwrapped,
                                        None,
                                    )
                            })
                    else {
                        return Err(format!("invalid retained statement span: {start}..{end}"));
                    };
                    // Source-map trivia adjustments do not create another counter target.
                    if !retained_statements.insert(index) {
                        return Err("duplicate retained statement mapping".into());
                    }
                }
                let hits = counters
                    .get(id)
                    .and_then(Value::as_u64)
                    .ok_or("invalid statement count")?;
                if map.insert((start, end), hits > 0).is_some() {
                    return Err("duplicate statement span".into());
                }
            }
            for statement in &analysis.coverage_statements {
                if let Some(owner) = analysis.statement_owner(statement.span.start)
                    && analysis.scopes[owner].coverage_partial_suppression
                    && !analysis.scopes[owner].coverage_suppressed
                    && !analysis.coverage_statement_ignored(statement.span.start)
                    && !map.keys().any(|&(start, _)| {
                        start == statement.span.start || start == statement.unwrapped.start
                    })
                {
                    return Err(format!(
                        "missing retained statement at {}",
                        statement.span.start
                    ));
                }
            }
            Ok(map)
        };
        match decode() {
            Err(e) => {
                statements_reliable = false;
                problems.push(e);
            }
            Ok(statements) => {
                if analysis.scopes.iter().any(|scope| {
                    (scope.coverage_suppressed || scope.coverage_partial_suppression)
                        && !scope.implicit
                }) {
                    match function_suppression_conflicts(analysis, source, file) {
                        Ok(conflicts) => unreliable_suppressions.extend(conflicts),
                        Err(error) => {
                            problems.push(error);
                            unreliable_suppressions.extend(
                                analysis
                                    .scopes
                                    .iter()
                                    .enumerate()
                                    .filter(|(_, scope)| scope.coverage_suppressed)
                                    .map(|(i, _)| i),
                            );
                        }
                    }
                }
                let decoded = decode_branches(analysis, source, file);
                unreliable_branches.extend(decoded.unreliable);
                problems.extend(decoded.problems);
                let map = Coverage {
                    statements,
                    branches: decoded.map,
                };
                if let Some(previous) = merged.as_mut() {
                    if !previous.statements.keys().eq(map.statements.keys()) {
                        statements_reliable = false;
                        problems.push("incompatible statement mappings".into());
                    } else {
                        for (key, covered) in map.statements {
                            *previous.statements.get_mut(&key).unwrap() |= covered;
                        }
                    }
                    if !previous.branches.keys().eq(map.branches.keys()) {
                        problems.push("incompatible branch mappings".into());
                        // Missing sites affect only their source owner. Compatible
                        // functions and statement hits can still be combined.
                        for key in previous.branches.keys().chain(map.branches.keys()) {
                            if previous.branches.contains_key(key) != map.branches.contains_key(key)
                            {
                                if let Some(i) = analysis.owner(key.span.0) {
                                    unreliable_branches.insert(i);
                                } else {
                                    unreliable_branches.extend(0..analysis.scopes.len());
                                }
                            }
                        }
                    }
                    for (key, outcomes) in map.branches {
                        let prior = previous
                            .branches
                            .entry(key)
                            .or_insert(vec![false; outcomes.len()]);
                        for (previous, covered) in prior.iter_mut().zip(outcomes) {
                            *previous |= covered;
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
                    statements_reliable = false;
                    problems.push(format!("statement escapes owning scope: {start}..{end}"));
                } else if !analysis.scopes[i].implicit
                    && !analysis.statement_starts.contains(&start)
                {
                    statements_reliable = false;
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
                    unreliable_branches.insert(i);
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
    for (index, scope) in analysis.scopes.iter().enumerate() {
        if scope.coverage_suppressed
            && !scope.implicit
            && (!statements[index].is_empty()
                || !branches[index].is_empty()
                || unreliable_suppressions.contains(&index))
        {
            problems.push(format!(
                "whole-function coverage suppression still has counters: {}",
                scope.name
            ));
        }
    }
    let mut complete = problems.is_empty();
    let rows: Vec<_> = analysis.scopes.iter().enumerate().map(|(i,s)| {
        let total = statements[i].len();
        let covered = statements[i].iter().filter(|&&hit| hit).count();
        let branch_total = branches[i].len();
        let branch_covered = branches[i].iter().filter(|&&hit| hit).count();
        let status = if s.implicit { "complexity-only" }
            else if s.coverage_suppressed { if statements_reliable && total == 0 && branch_total == 0 && !unreliable_branches.contains(&i) && !unreliable_suppressions.contains(&i) { "suppressed" } else { "unknown" } }
            else if s.empty { "not-applicable" }
            else if !statements_reliable || unreliable_branches.contains(&i) { complete = false; "unknown" }
            else if s.coverage_partial_suppression { "partially-suppressed" }
            else if total == 0 { complete = false; "unknown" } else { "measured" };
        json!({"name":s.name,"start":s.span.start,"complexity":s.complexity,"cognitiveComplexity":s.cognitive_complexity,"status":status,
            "typeSafety":s.type_safety,
            "coverageSuppressions":s.coverage_suppressions,
            "covered":covered,"total":total,"coverage":if statements_reliable && !s.coverage_suppressed && !s.implicit && !s.empty && total > 0 {Some(covered as f64/total as f64)}else{None},
            "branchCovered":branch_covered,"branchTotal":branch_total,
            "branchCoverage":if matches!(status, "measured" | "partially-suppressed") && branch_total > 0 {Some(branch_covered as f64/branch_total as f64)}else{None},
            "coverageBasis":if status=="measured" {Some(if branch_total > 0 {"branch"} else {"statement"})}else{None},
            "crap":if status=="measured" {if branch_total > 0 {assessment::score(s.complexity,branch_covered,branch_total)} else {assessment::score(s.complexity,covered,total)}}else{None}})
    }).collect();
    json!({"complete":complete,"functions":rows,"problems":problems,"typeSafety":analysis.type_safety(),"coverageSuppressions":analysis.coverage_suppressions()})
}

#[test]
fn whole_function_suppressions_are_visible_and_do_not_require_counters() {
    let source = "/* istanbul ignore next */ function ignored() { return 1; }";
    let analysis = Analysis::inspect("source.ts", source).unwrap();
    let report =
        json!({"source.ts":{"path":"source.ts","statementMap":{},"s":{},"branchMap":{},"b":{}}});
    let result = attribute(&analysis, "source.ts", source, [&report]);
    assert_eq!(result["complete"], true, "{result}");
    assert_eq!(result["problems"], json!([]));
    let row = &result["functions"][0];
    assert_eq!(row["status"], "suppressed");
    assert_eq!(row["coverageSuppressions"], 1);
    assert_eq!(result["coverageSuppressions"]["count"], 1);
    for key in ["coverage", "branchCoverage", "coverageBasis", "crap"] {
        assert_eq!(row[key], Value::Null, "{key}");
    }
    let missing = attribute(&analysis, "source.ts", source, [&json!({})]);
    assert_eq!(missing["complete"], false);
    let unhinted = source.replace("/* istanbul ignore next */ ", "");
    let ordinary = Analysis::inspect("source.ts", &unhinted).unwrap();
    let unknown = attribute(&ordinary, "source.ts", &unhinted, [&report]);
    assert_eq!(unknown["complete"], false);
    assert_eq!(unknown["functions"][0]["status"], "unknown");
}

#[test]
fn suppression_rejects_retained_function_records_without_statement_evidence() {
    let source = "/* istanbul ignore next */ const ignored = ({[key()]: value}: Record<string, number>) => {};";
    let analysis = Analysis::inspect("source.ts", source).unwrap();
    let scope = &analysis.scopes[0];
    for hits in [0, 1] {
        let report = json!({"source.ts":{"path":"source.ts","statementMap":{},"s":{},"branchMap":{},"b":{},
            "fnMap":{"0":{"loc":{"start":{"line":1,"column":scope.body.start},
                "end":{"line":1,"column":scope.body.end}}}},"f":{"0":hits}}});
        let result = attribute(&analysis, "source.ts", source, [&report]);
        assert_eq!(result["complete"], false, "{result}");
        assert_eq!(result["functions"][0]["status"], "unknown");
        assert_eq!(result["functions"][0]["coverage"], Value::Null);
        assert_eq!(result["functions"][0]["crap"], Value::Null);
    }
}

#[test]
fn suppression_requires_usable_function_metadata_when_present() {
    let source = "function kept() {}\n/* istanbul ignore next */ function ignored() { return 1; }";
    let analysis = Analysis::inspect("source.ts", source).unwrap();
    let report = json!({"source.ts":{"path":"source.ts","statementMap":{},"s":{},"branchMap":{},"b":{},
        "fnMap":{"0":{"loc":{"start":{"line":1,"column":analysis.scopes[0].body.start},
            "end":{"line":1,"column":analysis.scopes[0].body.end}}}},"f":{"0":1}}});
    let result = attribute(&analysis, "source.ts", source, [&report]);
    assert_eq!(result["complete"], true, "{result}");
    assert_eq!(result["functions"][0]["status"], "not-applicable");
    assert_eq!(result["functions"][0]["coverage"], Value::Null);
    assert_eq!(result["functions"][1]["status"], "suppressed");
    for (pointer, value) in [
        ("/source.ts/fnMap", json!([])),
        ("/source.ts/f", json!({})),
        ("/source.ts/f/0", json!(-1)),
        ("/source.ts/fnMap/0/loc/start", json!({})),
        (
            "/source.ts/fnMap/0/loc/start",
            json!({"line":1,"column":1000}),
        ),
    ] {
        let mut invalid = report.clone();
        *invalid.pointer_mut(pointer).unwrap() = value;
        let result = attribute(&analysis, "source.ts", source, [&invalid]);
        assert_eq!(result["complete"], false, "{pointer}: {result}");
        assert_eq!(result["functions"][1]["status"], "unknown");
    }
}

#[test]
fn file_suppression_allows_an_omitted_entry_but_never_hides_bad_evidence() {
    let source = "/* istanbul ignore file */ function ignored() { return 1; }";
    let analysis = Analysis::inspect("source.ts", source).unwrap();
    let result = attribute(&analysis, "source.ts", source, [&json!({})]);
    assert_eq!(result["complete"], true, "{result}");
    assert_eq!(result["functions"][0]["status"], "suppressed");
    assert_eq!(
        attribute(&analysis, "source.ts", source, std::iter::empty())["complete"],
        false
    );
    for invalid in [
        json!({"source.ts":{"path":"wrong.ts","statementMap":{},"s":{},"branchMap":{},"b":{}}}),
        json!({"source.ts":{"path":"source.ts","statementMap":{},"s":{}}}),
        json!({"source.ts":{"path":"source.ts","statementMap":{},"s":{"0":1},"branchMap":{},"b":{}}}),
    ] {
        let result = attribute(&analysis, "source.ts", source, [&invalid]);
        assert_eq!(result["complete"], false, "{result}");
        assert!(!result["problems"].as_array().unwrap().is_empty());
    }
}

#[test]
fn partial_suppression_reports_retained_coverage_without_whole_function_crap() {
    let source = "function f() { /* istanbul ignore next */ work(); return 1; }";
    let analysis = Analysis::inspect("source.ts", source).unwrap();
    let start = source.find("return").unwrap();
    let report = json!({"source.ts":{"path":"source.ts","statementMap":{"0":{
        "start":{"line":1,"column":start},"end":{"line":1,"column":start+9}}},
        "s":{"0":1},"branchMap":{},"b":{}}});
    let result = attribute(&analysis, "source.ts", source, [&report]);
    assert_eq!(result["complete"], true, "{result}");
    assert_eq!(result["functions"][0]["status"], "partially-suppressed");
    assert_eq!(result["functions"][0]["coverageSuppressions"], 1);
    assert_eq!(result["functions"][0]["coverage"], 1.0);
    assert_eq!(result["functions"][0]["crap"], Value::Null);
}

#[test]
fn partial_branch_suppression_checks_exact_retained_evidence_before_merging() {
    let source = "function f(flag: boolean) { /* istanbul ignore else */ if (flag) return 1; else return 2; return flag ? 3 : 4; }";
    let analysis = Analysis::inspect("source.ts", source).unwrap();
    let location = |start: usize, end: usize| json!({"start":{"line":1,"column":start},"end":{"line":1,"column":end}});
    let if_start = source.find("if (").unwrap();
    let if_end = source.find("return 2;").unwrap() + "return 2;".len();
    let first_return = source.find("return 1;").unwrap();
    let last_return = source.find("return flag").unwrap();
    let conditional = source.find("flag ?").unwrap();
    let three = source.find("3 :").unwrap();
    let four = source.find("4;").unwrap();
    let report = json!({"source.ts":{"path":"source.ts",
        "statementMap":{"0":location(if_start,if_end),"1":location(first_return,first_return+9),"2":location(last_return,four+2)},
        "s":{"0":1,"1":1,"2":1},
        "branchMap":{
            "0":{"type":"if","loc":location(if_start,if_end),"locations":[location(if_start,if_end)]},
            "1":{"type":"cond-expr","loc":location(conditional,four+1),"locations":[location(three,three+1),location(four,four+1)]}},
        "b":{"0":[1],"1":[1,0]}}});
    let result = attribute(&analysis, "source.ts", source, [&report]);
    assert_eq!(result["complete"], true, "{result}");
    assert_eq!(result["functions"][0]["status"], "partially-suppressed");
    assert_eq!(result["functions"][0]["branchTotal"], 3);
    assert_eq!(result["functions"][0]["branchCoverage"], 2.0 / 3.0);
    assert_eq!(result["functions"][0]["crap"], Value::Null);
    let mut extended_through_else = report.clone();
    extended_through_else["source.ts"]["statementMap"]["1"] =
        location(first_return, source.find("return 2;").unwrap());
    assert_eq!(
        attribute(&analysis, "source.ts", source, [&extended_through_else])["complete"],
        true
    );
    let mut missing_statement = report.clone();
    missing_statement["source.ts"]["statementMap"]
        .as_object_mut()
        .unwrap()
        .remove("2");
    missing_statement["source.ts"]["s"]
        .as_object_mut()
        .unwrap()
        .remove("2");
    let mut missing_branch = report.clone();
    missing_branch["source.ts"]["branchMap"]
        .as_object_mut()
        .unwrap()
        .remove("1");
    missing_branch["source.ts"]["b"]
        .as_object_mut()
        .unwrap()
        .remove("1");
    let mut retained_ignored = report.clone();
    let ignored = source.find("return 2;").unwrap();
    retained_ignored["source.ts"]["statementMap"]["3"] = location(ignored, ignored + 9);
    retained_ignored["source.ts"]["s"]["3"] = json!(0);
    let mut wrong_outcome = report.clone();
    wrong_outcome["source.ts"]["branchMap"]["0"]["locations"][0] = location(ignored, ignored + 9);
    let mut full_branch = report.clone();
    full_branch["source.ts"]["branchMap"]["0"]["locations"]
        .as_array_mut()
        .unwrap()
        .push(location(ignored, ignored + 9));
    full_branch["source.ts"]["b"]["0"]
        .as_array_mut()
        .unwrap()
        .push(json!(0));
    let mut truncated_statement = report.clone();
    truncated_statement["source.ts"]["statementMap"]["2"] = location(last_return, last_return + 1);
    let mut unrelated_end = report.clone();
    unrelated_end["source.ts"]["statementMap"]["1"] = location(first_return, four + 1);
    let mut invalid_function = report.clone();
    invalid_function["source.ts"]["fnMap"] = json!({});
    for invalid in [
        missing_statement,
        missing_branch,
        retained_ignored,
        wrong_outcome,
        full_branch,
        truncated_statement,
        unrelated_end,
        invalid_function,
    ] {
        for reports in [
            vec![&invalid],
            vec![&report, &invalid],
            vec![&invalid, &report],
        ] {
            let result = attribute(&analysis, "source.ts", source, reports);
            assert_eq!(result["complete"], false, "{invalid}: {result}");
            assert!(!result["problems"].as_array().unwrap().is_empty());
        }
    }
}

#[test]
fn concise_return_counter_survives_an_ignored_body_expression() {
    for expression in ["flag ? 1 : 2", "flag || false", "((flag ? 1 : 2))"] {
        let source =
            format!("const f = (flag: boolean) => /* istanbul ignore next */ {expression};");
        let analysis = Analysis::inspect("source.ts", &source).unwrap();
        let start = source.find(expression).unwrap();
        let end = start + expression.len();
        let report = json!({"source.ts":{"path":"source.ts", "statementMap":{"0":{
            "start":{"line":1,"column":start},"end":{"line":1,"column":end}}},
            "s":{"0":1},"branchMap":{},"b":{}}});
        let result = attribute(&analysis, "source.ts", &source, [&report]);
        assert_eq!(result["complete"], true, "{source}: {result}");
        assert_eq!(result["functions"][0]["status"], "partially-suppressed");
        assert_eq!(result["functions"][0]["coverage"], 1.0);
        assert_eq!(result["functions"][0]["crap"], Value::Null);
        let mut truncated = report.clone();
        truncated["source.ts"]["statementMap"]["0"]["end"]["column"] = json!(start + 1);
        for reports in [
            vec![&truncated],
            vec![&report, &truncated],
            vec![&truncated, &report],
        ] {
            let result = attribute(&analysis, "source.ts", &source, reports);
            assert_eq!(result["complete"], false, "{source}: {result}");
            assert_eq!(result["functions"][0]["coverage"], Value::Null);
        }
    }
}

#[test]
fn hoisted_function_creation_counter_survives_a_child_hint_but_not_a_declaration_hint() {
    let source = "function f() { const value = /* istanbul ignore next */ ()=>1; return value; }";
    let analysis = Analysis::inspect("source.ts", source).unwrap();
    let start = source.find("()=>1").unwrap() as u32;
    assert!(!analysis.coverage_statement_ignored(start));
    assert!(analysis.scopes[1].coverage_suppressed);
    assert!(analysis.coverage_statement_ignored(start + 4));
    let declaration =
        "function f() { /* istanbul ignore next */ const value = ()=>1; return value; }";
    let analysis = Analysis::inspect("source.ts", declaration).unwrap();
    assert!(analysis.coverage_statement_ignored(declaration.find("()=>1").unwrap() as u32));
}

#[test]
fn all_ignored_statements_are_partial_without_inventing_positive_coverage() {
    let source = "function f() { /* istanbul ignore next */ return 1; }";
    let analysis = Analysis::inspect("source.ts", source).unwrap();
    let report =
        json!({"source.ts":{"path":"source.ts","statementMap":{},"s":{},"branchMap":{},"b":{}}});
    let result = attribute(&analysis, "source.ts", source, [&report]);
    assert_eq!(result["complete"], true, "{result}");
    assert_eq!(result["functions"][0]["status"], "partially-suppressed");
    assert_eq!(result["functions"][0]["coverage"], Value::Null);
    assert_eq!(result["functions"][0]["crap"], Value::Null);
    assert_eq!(
        attribute(&analysis, "source.ts", source, [&json!({})])["complete"],
        false
    );
    let unhinted = source.replace("/* istanbul ignore next */", "");
    let analysis = Analysis::inspect("source.ts", &unhinted).unwrap();
    assert_eq!(
        attribute(&analysis, "source.ts", &unhinted, [&report])["complete"],
        false
    );
}

#[test]
fn partial_suppression_rejects_duplicate_normalized_statement_targets() {
    let source = "function f() { /* istanbul ignore next */ work(); const value = (1); return value; /* tail */ }";
    let analysis = Analysis::inspect("source.ts", source).unwrap();
    let loc = |start, end| json!({"start":{"line":1,"column":start},"end":{"line":1,"column":end}});
    let initializer = source.find("(1)").unwrap();
    let returned = source.find("return value;").unwrap();
    let report = json!({"source.ts":{"path":"source.ts","statementMap":{
        "0":loc(initializer,initializer+3),"1":loc(returned,returned+13)},
        "s":{"0":1,"1":0},"branchMap":{},"b":{}}});
    let result = attribute(&analysis, "source.ts", source, [&report]);
    assert_eq!(result["complete"], true, "{result}");
    assert_eq!(result["functions"][0]["coverage"], 0.5);
    let mut unwrapped = report.clone();
    unwrapped["source.ts"]["statementMap"]["0"] = loc(initializer + 1, initializer + 2);
    assert_eq!(
        attribute(&analysis, "source.ts", source, [&unwrapped])["complete"],
        true
    );
    for location in [
        loc(returned, returned + 13),
        loc(returned, returned + 14),
        loc(initializer + 1, initializer + 2),
    ] {
        let mut duplicate = report.clone();
        duplicate["source.ts"]["statementMap"]["extra"] = location;
        duplicate["source.ts"]["s"]["extra"] = json!(1);
        for reports in [
            vec![&duplicate],
            vec![&report, &duplicate],
            vec![&duplicate, &report],
        ] {
            let result = attribute(&analysis, "source.ts", source, reports);
            assert_eq!(result["complete"], false, "{result}");
            assert_eq!(result["functions"][0]["coverage"], Value::Null);
            assert!(
                result["problems"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|problem| problem == "duplicate retained statement mapping")
            );
        }
    }
}

#[test]
fn enclosing_nonvisitor_hints_cannot_excuse_missing_descendant_branches() {
    for expression in [
        "Boolean(flag ? 1 : 2)",
        "[flag ? 1 : 2]",
        "!(flag ? 1 : 2)",
        "Boolean((()=>flag ? 1 : 2)())",
    ] {
        let source = format!(
            "function f(flag: boolean) {{ return /* istanbul ignore next */ {expression}; }}"
        );
        let analysis = Analysis::inspect("source.ts", &source).unwrap();
        let start = source.find("return").unwrap();
        let end = source.rfind(';').unwrap() + 1;
        let report = json!({"source.ts":{"path":"source.ts","statementMap":{"0":{
            "start":{"line":1,"column":start},"end":{"line":1,"column":end}}},
            "s":{"0":1},"branchMap":{},"b":{}}});
        let result = attribute(&analysis, "source.ts", &source, [&report]);
        assert_eq!(result["complete"], false, "{source}: {result}");
        assert_eq!(result["functions"][0]["status"], "unknown");
        assert!(
            result["problems"]
                .as_array()
                .unwrap()
                .iter()
                .any(|problem| problem.as_str().unwrap().contains("no instrumented target")),
            "{source}: {result}"
        );
    }
}

#[test]
fn adjacent_hints_use_only_the_last_istanbul_directive() {
    for (first, last) in [
        ("if", "else"),
        ("else", "if"),
        ("next", "if"),
        ("if", "next"),
        ("else", "else"),
    ] {
        let source = format!(
            "function f(flag: boolean) {{ const kept = 3; /* istanbul ignore {first} */ /* istanbul ignore {last} */ if (flag) return 1; else return 2; }}"
        );
        let analysis = Analysis::inspect("source.ts", &source).unwrap();
        let loc =
            |start, end| json!({"start":{"line":1,"column":start},"end":{"line":1,"column":end}});
        let kept = source.find("3;").unwrap();
        let if_start = source.find("if (flag)").unwrap();
        let true_return = source.find("return 1;").unwrap();
        let false_return = source.find("return 2;").unwrap();
        let if_end = false_return + 9;
        let mut report = json!({"source.ts":{"path":"source.ts","statementMap":{"0":loc(kept,kept+1)},"s":{"0":1},"branchMap":{},"b":{}}});
        if last != "next" {
            let retained = if last == "if" {
                false_return
            } else {
                true_return
            };
            report["source.ts"]["statementMap"]["1"] = loc(if_start, if_end);
            report["source.ts"]["statementMap"]["2"] = loc(retained, retained + 9);
            report["source.ts"]["s"]["1"] = json!(1);
            report["source.ts"]["s"]["2"] = json!(1);
            let outcome = if last == "if" {
                loc(false_return, if_end)
            } else {
                loc(if_start, if_end)
            };
            report["source.ts"]["branchMap"]["0"] =
                json!({"type":"if","loc":loc(if_start,if_end),"locations":[outcome]});
            report["source.ts"]["b"]["0"] = json!([1]);
        }
        let result = attribute(&analysis, "source.ts", &source, [&report]);
        assert_eq!(result["complete"], true, "{source}: {result}");
        assert_eq!(result["functions"][0]["status"], "partially-suppressed");
        assert_eq!(result["functions"][0]["coverageSuppressions"], 2);
        assert_eq!(result["functions"][0]["crap"], Value::Null);
        if last != "next" {
            let mut omitted = report.clone();
            omitted["source.ts"]["statementMap"]
                .as_object_mut()
                .unwrap()
                .remove("2");
            omitted["source.ts"]["s"]
                .as_object_mut()
                .unwrap()
                .remove("2");
            omitted["source.ts"]["branchMap"] = json!({});
            omitted["source.ts"]["b"] = json!({});
            for reports in [
                vec![&omitted],
                vec![&report, &omitted],
                vec![&omitted, &report],
            ] {
                assert_eq!(
                    attribute(&analysis, "source.ts", &source, reports)["complete"],
                    false,
                    "{source}"
                );
            }
        }
    }
}

#[test]
fn file_hints_override_local_hint_errors_regardless_of_position() {
    let body = "function f() { return /* istanbul ignore next */ 1; }";
    for source in [
        format!("/* istanbul ignore file */ {body}"),
        format!("{body} /* istanbul ignore file */"),
    ] {
        let analysis = Analysis::inspect("source.ts", &source).unwrap();
        let result = attribute(&analysis, "source.ts", &source, [&json!({})]);
        assert_eq!(result["complete"], true, "{source}: {result}");
        assert_eq!(result["functions"][0]["status"], "suppressed");
        assert_eq!(result["functions"][0]["coverageSuppressions"], 2);
        assert_eq!(
            attribute(&analysis, "source.ts", &source, std::iter::empty())["complete"],
            false
        );
    }
}

#[test]
fn invalid_partial_hint_targets_cannot_excuse_missing_coverage() {
    for source in [
        "function f() { /* istanbul ignore if */ return 1; }",
        "function f() { return /* istanbul ignore next */ 1; }",
        "function f() { const x = /* istanbul ignore next */ work(); return x; }",
        "function f() { return 1; /* istanbul ignore next */ }",
    ] {
        let analysis = Analysis::inspect("source.ts", source).unwrap();
        let report = json!({"source.ts":{"path":"source.ts","statementMap":{},"s":{},"branchMap":{},"b":{}}});
        let result = attribute(&analysis, "source.ts", source, [&report]);
        assert_eq!(result["complete"], false, "{source}: {result}");
        assert_eq!(result["functions"][0]["status"], "unknown");
    }
}

#[test]
fn suppression_does_not_hide_existing_counters_or_reclassify_implicit_scopes() {
    let source = "/* istanbul ignore next */ function ignored() { return 1; }";
    let analysis = Analysis::inspect("source.ts", source).unwrap();
    let start = source.find("return").unwrap();
    let report = json!({"source.ts":{"path":"source.ts","statementMap":{"0":{
        "start":{"line":1,"column":start},"end":{"line":1,"column":start+9}}},
        "s":{"0":1},"branchMap":{},"b":{}}});
    let result = attribute(&analysis, "source.ts", source, [&report]);
    assert_eq!(result["complete"], false, "{result}");
    assert_eq!(result["functions"][0]["status"], "unknown");
    assert_eq!(result["functions"][0]["coverage"], Value::Null);
    let source = "/* istanbul ignore file */ class C { value = 1; static { work(); } }";
    let analysis = Analysis::inspect("source.ts", source).unwrap();
    let result = attribute(&analysis, "source.ts", source, [&json!({})]);
    assert_eq!(result["complete"], true);
    for row in result["functions"].as_array().unwrap() {
        assert_eq!(row["status"], "complexity-only");
    }
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
fn if_condition_and_object_property_ends_preserve_executable_boundaries() {
    let path = "/fixture.ts";
    // These are Vitest/Istanbul's recorded ends: before the if body, and an
    // open line end including an object property's trailing comma.
    for (source, branch, outcomes) in [
        (
            "function f(a: boolean, b: boolean) {\n  if (a || b) { return 1; }\n  return 0;\n}\n",
            recorded_location(2, 6, json!(14)),
            vec![
                recorded_location(2, 6, json!(11)),
                recorded_location(2, 11, json!(14)),
            ],
        ),
        (
            "function f(a: boolean) {\n  return {\n    value: a ? 1 : 2,\n    next: sideEffect(),\n  };\n}\n",
            recorded_location(3, 11, Value::Null),
            vec![
                recorded_location(3, 15, json!(19)),
                recorded_location(3, 19, Value::Null),
            ],
        ),
    ] {
        let analysis = Analysis::inspect(path, source).unwrap();
        let kind = if source.contains("if (") {
            "binary-expr"
        } else {
            "cond-expr"
        };
        let statement = if kind == "binary-expr" {
            recorded_location(2, 2, Value::Null)
        } else {
            json!({"start":{"line":2,"column":2},"end":{"line":5,"column":4}})
        };
        let report = json!({path:{"path":path,"statementMap":{"0":statement},"s":{"0":1},
            "branchMap":{"0":{"type":kind,"loc":branch,"locations":outcomes}},"b":{"0":[1,0]}}});
        let result = attribute(&analysis, path, source, [&report]);
        assert_eq!(result["complete"], true, "{source}: {result}");
        assert_eq!(result["functions"][0]["branchCoverage"], 0.5);
        let mut invalid = report.clone();
        let end = if kind == "binary-expr" {
            json!({"line":2,"column":25}) // Includes the if body's return.
        } else {
            json!({"line":4,"column":22}) // Includes the following value.
        };
        invalid[path]["branchMap"]["0"]["loc"]["end"] = end.clone();
        invalid[path]["branchMap"]["0"]["locations"][1]["end"] = end;
        assert_eq!(
            attribute(&analysis, path, source, [&invalid])["complete"],
            false
        );
        if kind == "cond-expr" {
            for next in ["next: sideEffect()", "[sideEffect()]: 1", "...sideEffect()"] {
                let changed = source.replace("next: sideEffect()", next);
                let analysis = Analysis::inspect(path, &changed).unwrap();
                let end = json!({"line":4,"column":changed.lines().nth(3).unwrap().len()});
                invalid[path]["branchMap"]["0"]["loc"]["end"] = end.clone();
                invalid[path]["branchMap"]["0"]["locations"][1]["end"] = end;
                let result = attribute(&analysis, path, &changed, [&invalid]);
                assert_eq!(result["complete"], false, "{changed}: {result}");
                assert_eq!(result["functions"][0]["coverage"], 1.0);
                assert_eq!(result["functions"][0]["crap"], Value::Null);
            }
        }
    }
}

#[test]
fn final_object_property_closing_brace_does_not_cross_a_sibling_expression() {
    let path = "/fixture.ts";
    for (tail, complete) in [("", true), (", next: sideEffect()", false)] {
        let source =
            format!("function f(a: boolean) {{\n  return {{value: a ? 1 : 2{tail}}};\n}}\n");
        let analysis = Analysis::inspect(path, &source).unwrap();
        let report = json!({path:{"path":path,
            "statementMap":{"0":recorded_location(2,2,Value::Null)},"s":{"0":1},
            "branchMap":{"0":{"type":"cond-expr","loc":recorded_location(2,17,Value::Null),
                "locations":[recorded_location(2,21,json!(25)),recorded_location(2,25,Value::Null)]}},"b":{"0":[1,0]}}});
        let result = attribute(&analysis, path, &source, [&report]);
        assert_eq!(result["complete"], complete, "{source}: {result}");
        assert_eq!(result["functions"][0]["coverage"], 1.0);
        assert_eq!(
            result["functions"][0]["crap"],
            if complete { json!(2.5) } else { Value::Null }
        );
    }
}

#[test]
fn unreliable_branches_preserve_statements_and_other_functions() {
    let path = "/fixture.tsx";
    let (source, report) = recorded_fixture();
    let analysis = Analysis::inspect(path, source).unwrap();
    let mut invalid = report.clone();
    invalid[path]["b"]["1"] = json!([1, -1]);
    for reports in [
        vec![&invalid],
        vec![&report, &invalid],
        vec![&invalid, &report],
    ] {
        let result = attribute(&analysis, path, source, reports);
        let rows = result["functions"].as_array().unwrap();
        let broken = rows
            .iter()
            .find(|row| row["name"] == "conditional")
            .unwrap();
        assert_eq!(result["complete"], false);
        assert_eq!(broken["status"], "unknown");
        assert_eq!(broken["coverage"], 1.0);
        assert_eq!(broken["covered"], 1);
        assert_eq!(broken["total"], 1);
        for key in ["crap", "branchCoverage", "coverageBasis"] {
            assert_eq!(broken[key], Value::Null);
        }
        let healthy = rows.iter().find(|row| row["name"] == "price").unwrap();
        assert_eq!(healthy["status"], "measured");
        assert_eq!(healthy["crap"], 2.5);
    }
    invalid[path]["branchMap"]["1"]["loc"]["start"]["column"] = Value::Null;
    let result = attribute(&analysis, path, source, [&invalid]);
    assert_eq!(result["functions"][0]["crap"], Value::Null);
    assert_eq!(result["functions"][0]["coverage"], 1.0);
}

#[test]
fn conflicting_branch_owners_never_gain_statement_fallback() {
    let path = "/fixture.ts";
    let source = "function f(a: boolean) { return a ? 1 : 2; }\nfunction g(b: boolean) { return b ? 3 : 4; }\n";
    let analysis = Analysis::inspect(path, source).unwrap();
    let mut file = json!({"path":path,"statementMap":{},"s":{},"branchMap":{},"b":{}});
    for (id, line) in [("0", 1), ("1", 2)] {
        file["statementMap"][id] = recorded_location(line, 25, json!(42));
        file["s"][id] = json!(1);
        file["branchMap"][id] = json!({"type":"cond-expr",
            "loc":recorded_location(line,32,json!(41)),
            "locations":[recorded_location(line,36,json!(37)),recorded_location(line,40,json!(41))]});
        file["b"][id] = json!([1, 0]);
    }
    let valid = json!({path:file});
    let reference = attribute(&analysis, path, source, [&valid]);
    assert_eq!(reference["complete"], true);
    for row in reference["functions"].as_array().unwrap() {
        assert_eq!(row["crap"], 2.5);
    }
    let mut conflicting = valid.clone();
    conflicting[path]["branchMap"]["0"]["loc"] = conflicting[path]["branchMap"]["1"]["loc"].clone();
    for reports in [
        vec![&conflicting],
        vec![&valid, &conflicting],
        vec![&conflicting, &valid],
    ] {
        let result = attribute(&analysis, path, source, reports);
        assert_eq!(result["complete"], false);
        for row in result["functions"].as_array().unwrap() {
            assert_eq!(row["coverage"], 1.0);
            assert_eq!(row["covered"], 1);
            assert_eq!(row["total"], 1);
            assert_eq!(row["status"], "unknown", "{result}");
            for key in ["crap", "branchCoverage", "coverageBasis"] {
                assert_eq!(row[key], Value::Null, "{result}");
            }
        }
    }
    // A provider can legitimately record no branches for a function. Only
    // conflicting evidence, not AST decisions alone, disables its fallback.
    let mut unrecorded = valid.clone();
    unrecorded[path]["branchMap"]
        .as_object_mut()
        .unwrap()
        .remove("0");
    unrecorded[path]["b"].as_object_mut().unwrap().remove("0");
    let result = attribute(&analysis, path, source, [&unrecorded]);
    assert_eq!(result["complete"], true);
    assert_eq!(result["functions"][0]["coverageBasis"], "statement");
    assert_eq!(result["functions"][0]["crap"], 2.0);
    assert_eq!(result["functions"][1]["coverageBasis"], "branch");
    assert_eq!(result["functions"][1]["crap"], 2.5);
}

#[test]
fn incompatible_branches_merge_compatible_statements_without_scoring_partial_branches() {
    let path = "/fixture.tsx";
    let (source, report) = recorded_fixture();
    let analysis = Analysis::inspect(path, source).unwrap();
    let mut partial = report.clone();
    partial[path]["branchMap"]
        .as_object_mut()
        .unwrap()
        .remove("0");
    partial[path]["b"].as_object_mut().unwrap().remove("0");
    partial[path]["s"]["1"] = json!(0);
    for reports in [vec![&report, &partial], vec![&partial, &report]] {
        let result = attribute(&analysis, path, source, reports);
        assert_eq!(result["problems"], json!(["incompatible branch mappings"]));
        assert_eq!(result["functions"][0]["coverage"], 1.0);
        assert_eq!(result["functions"][0]["crap"], Value::Null);
        assert_eq!(result["functions"][1]["crap"], 2.5);
    }
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
        let id = pointer.split('/').nth(2).unwrap_or("0");
        let start = byte_position(
            source,
            &report[path]["branchMap"][id]["loc"]["start"],
            false,
        )
        .unwrap();
        let owner = analysis.owner(start).unwrap();
        let affected = &result["functions"][owner];
        assert_eq!(affected["status"], "unknown", "{pointer}: {result}");
        assert_eq!(affected["coverage"], 1.0);
        assert_eq!(affected["branchCoverage"], Value::Null);
        assert_eq!(affected["coverageBasis"], Value::Null);
        assert_eq!(affected["crap"], Value::Null);
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
fn default_ranges_stop_before_a_later_function_value() {
    let path = "/fixture.tsx";
    let source = "export function f(x = 1, next = () => 2) {\n  return x + next();\n}\n";
    let analysis = Analysis::inspect(path, source).unwrap();
    // Real Node/Istanbul positions. The second initializer creates a function
    // in f's parameter evaluation; executing its body has a separate owner.
    let report = json!({path:{"path":path,
        "statementMap":{"0":recorded_location(1,0,json!(16)),"1":recorded_location(1,38,json!(39)),"2":recorded_location(2,2,json!(20))},
        "s":{"0":1,"1":2,"2":2},
        "branchMap":{
            "0":{"type":"default-arg","loc":recorded_location(1,18,json!(23)),"locations":[recorded_location(1,22,json!(23))]},
            "1":{"type":"default-arg","loc":recorded_location(1,25,json!(39)),"locations":[recorded_location(1,32,json!(39))]}
        },"b":{"0":[1],"1":[2]}
    }});
    let result = attribute(&analysis, path, source, [&report]);
    assert_eq!(result["complete"], true, "{result}");
    assert_eq!(result["functions"][0]["crap"], 3.0);
    assert_eq!(result["functions"][1]["crap"], 1.0);
    for (branch, outcome) in [(true, false), (false, true), (true, true)] {
        let mut invalid = report.clone();
        if branch {
            invalid[path]["branchMap"]["0"]["loc"]["end"]["column"] = json!(39);
        }
        if outcome {
            invalid[path]["branchMap"]["0"]["locations"][0]["end"]["column"] = json!(39);
        }
        let result = attribute(&analysis, path, source, [&invalid]);
        assert_eq!(result["complete"], false, "{result}");
        assert_eq!(result["functions"][0]["crap"], Value::Null);
    }
}

#[test]
fn mapped_closing_parentheses_allow_trivia_but_not_executable_code() {
    let path = "/fixture.tsx";
    // Actual Vitest/Istanbul positions: the final outcomes have open ends that
    // include the closing parentheses and return statement's semicolon.
    for (expression, kind, starts, ends, hits, complexity) in [
        (
            "a ? (1) : (2)",
            "cond-expr",
            vec![14, 20],
            vec![json!(20), Value::Null],
            vec![1, 1],
            2,
        ),
        (
            "a && (b || c)",
            "binary-expr",
            vec![9, 15, 20],
            vec![json!(15), json!(20), Value::Null],
            vec![3, 2, 1],
            3,
        ),
    ] {
        let source = format!(
            "export function f(a: boolean, b: boolean, c: boolean) {{\n  return {expression};\n}}\n"
        );
        let locations: Vec<_> = starts
            .into_iter()
            .zip(ends)
            .map(|(start, end)| recorded_location(2, start, end))
            .collect();
        let report = json!({path:{"path":path,
            "statementMap":{"0":recorded_location(2,2,Value::Null)},"s":{"0":1},
            "branchMap":{"0":{"type":kind,"loc":recorded_location(2,9,Value::Null),"locations":locations}},
            "b":{"0":hits}
        }});
        for (suffix, complete) in [
            ("", true),
            (" // trailing", true),
            (" sideEffect();", false),
        ] {
            let source = source.replace(";\n", &format!(";{suffix}\n"));
            let analysis = Analysis::inspect(path, &source).unwrap();
            let result = attribute(&analysis, path, &source, [&report]);
            assert_eq!(result["complete"], complete, "{source}: {result}");
            assert_eq!(
                result["functions"][0]["crap"],
                if complete {
                    json!(f64::from(complexity))
                } else {
                    Value::Null
                }
            );
        }
    }
}

#[test]
fn jsx_fragment_closing_ranges_preserve_child_boundaries() {
    let path = "/fixture.tsx";
    let source = "export function f(a: boolean) {\n  return <>{a ? 1 : 2}</>;\n}\n";
    let report = json!({path:{"path":path,
        "statementMap":{"0":recorded_location(2,2,Value::Null)},"s":{"0":1},
        "branchMap":{"0":{"type":"cond-expr","loc":recorded_location(2,12,json!(24)),
            "locations":[recorded_location(2,16,json!(20)),recorded_location(2,20,json!(24))]}},
        "b":{"0":[1,1]}
    }});
    let analysis = Analysis::inspect(path, source).unwrap();
    let result = attribute(&analysis, path, source, [&report]);
    assert_eq!(result["complete"], true, "{result}");
    assert_eq!(result["functions"][0]["crap"], 2.0);
    let mut invalid = report.clone();
    invalid[path]["branchMap"]["0"]["loc"]["end"]["column"] = Value::Null;
    invalid[path]["branchMap"]["0"]["locations"][1]["end"]["column"] = Value::Null;
    for source in [
        source.replace("}</>", "}{sideEffect()}</>"),
        source.replace("}</>", "}<Other value={sideEffect()} /></>"),
        source.replace("</>;", "</> + sideEffect();"),
    ] {
        let analysis = Analysis::inspect(path, &source).unwrap();
        let result = attribute(&analysis, path, &source, [&invalid]);
        assert_eq!(result["complete"], false, "{source}: {result}");
        assert_eq!(result["functions"][0]["crap"], Value::Null);
    }
}

#[test]
fn jsx_container_and_opening_tag_ends_do_not_swallow_other_attributes_or_children() {
    let path = "/fixture.tsx";
    for (jsx, opening_tag, complete) in [
        ("<>{flag ? 'on' : 'off'} tail</>", false, true),
        ("<>{flag ? 'on' : 'off'}<span>tail</span></>", false, true),
        ("<span title={flag ? 'on' : 'off'}>tail</span>", true, true),
        ("<span title={flag ? 'on' : 'off'} />", true, true),
        (
            "<span title={flag ? 'on' : 'off'} data={sideEffect()}>tail</span>",
            true,
            false,
        ),
        (
            "<span title={flag ? 'on' : 'off'} data={sideEffect()} />",
            true,
            false,
        ),
    ] {
        let line = format!("  return {jsx};");
        let start = line.find("flag ?").unwrap() as u32;
        let consequent = line.find("'on'").unwrap() as u32;
        let alternate = line.find("'off'").unwrap() as u32;
        // Vitest can include the brace, or the final attribute's tag punctuation.
        let end = if opening_tag {
            line.find('>').unwrap() + 1
        } else {
            line.find('}').unwrap() + 1
        } as u32;
        let source = format!("function view(flag: boolean) {{\n{line}\n}}\n");
        let analysis = Analysis::inspect(path, &source).unwrap();
        let report = json!({path:{"path":path,
            "statementMap":{"0":recorded_location(2,2,Value::Null)},"s":{"0":1},
            "branchMap":{"0":{"type":"cond-expr","loc":recorded_location(2,start,json!(end)),
                "locations":[recorded_location(2,consequent,json!(alternate)),recorded_location(2,alternate,json!(end))]}},
            "b":{"0":[1,1]}
        }});
        let result = attribute(&analysis, path, &source, [&report]);
        assert_eq!(result["complete"], complete, "{source}: {result}");
        assert_eq!(
            result["functions"][0]["crap"],
            if complete { json!(2.0) } else { Value::Null }
        );
        if complete {
            let source = source.replace(";\n", " + sideEffect();\n");
            let analysis = Analysis::inspect(path, &source).unwrap();
            let mut invalid = report.clone();
            invalid[path]["branchMap"]["0"]["loc"]["end"]["column"] = Value::Null;
            invalid[path]["branchMap"]["0"]["locations"][1]["end"]["column"] = Value::Null;
            let result = attribute(&analysis, path, &source, [&invalid]);
            assert_eq!(result["complete"], false, "{source}: {result}");
            assert_eq!(result["functions"][0]["crap"], Value::Null);
        }
    }
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
fn empty_and_reversed_statement_spans_cannot_supply_coverage() {
    let path = "/fixture.ts";
    let source = "const arrow = () => 1;";
    let analysis = Analysis::inspect(path, source).unwrap();
    let start = source.find('1').unwrap();
    for (end, valid) in [(start + 1, true), (start, false), (start - 1, false)] {
        let report = json!({path:{"path":path,"branchMap":{},"b":{},
            "statementMap":{"0":{"start":{"line":1,"column":start},
            "end":{"line":1,"column":end}}},"s":{"0":1}}});
        let result = attribute(&analysis, path, source, [&report]);
        assert_eq!(result["complete"], valid, "{result}");
        assert_eq!(
            result["functions"][0]["coverage"],
            if valid { json!(1.0) } else { Value::Null }
        );
        assert_eq!(
            result["functions"][0]["crap"],
            if valid { json!(1.0) } else { Value::Null }
        );
        if !valid {
            assert_eq!(
                result["problems"],
                json!(["empty or reversed statement span"])
            );
        }
    }
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
