use crate::{
    analysis::{Analysis, supports_line_positions},
    assessment,
};
use serde_json::{Value, json};
use std::collections::BTreeMap;

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
    let column = position["column"].as_u64().ok_or("missing column")? as usize;
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

pub fn attribute<'a>(
    analysis: &Analysis,
    path: &str,
    source: &str,
    reports: impl IntoIterator<Item = &'a Value>,
) -> Value {
    let mut merged: Option<BTreeMap<(u32, u32), bool>> = None;
    let mut problems = Vec::new();
    let mut report_count = 0;
    let supported_positions = supports_line_positions(source);
    for report in reports {
        report_count += 1;
        let Some(file) = report.get(path) else {
            problems.push(format!("missing source coverage: {path}"));
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
            for (id, loc) in locations {
                let start = byte_position(source, &loc["start"], false)?;
                let mut end = byte_position(source, &loc["end"], true)?;
                if let Some(i) = analysis.statement_owner(start) {
                    let scope_end = analysis.scopes[i].span.end;
                    // A remapped arrow/field can include its terminating semicolon,
                    // which is outside the expression's AST range.
                    // Never shorten a range over another expression, function, or line.
                    if end > scope_end
                        && source[scope_end as usize..end as usize]
                            .trim_matches([';', ' ', '\t'])
                            .is_empty()
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
            Ok(map)
        };
        match decode() {
            Err(e) => problems.push(e),
            Ok(map) => {
                if let Some(previous) = merged.as_mut() {
                    if !previous.keys().eq(map.keys()) {
                        problems.push("incompatible statement mappings".into());
                    } else {
                        for (key, covered) in map {
                            *previous.get_mut(&key).unwrap() |= covered;
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
    if let Some(map) = merged.as_ref() {
        for (&(start, end), &hit) in map {
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
    }
    let mut complete = problems.is_empty();
    let rows: Vec<_> = analysis.scopes.iter().enumerate().map(|(i,s)| {
        let total = statements[i].len();
        let covered = statements[i].iter().filter(|&&hit| hit).count();
        let status = if s.implicit { "complexity-only" } else if s.empty { "not-applicable" }
            else if !problems.is_empty() || total == 0 { complete = false; "unknown" } else { "measured" };
        json!({"name":s.name,"start":s.span.start,"complexity":s.complexity,"status":status,
            "covered":covered,"total":total,"coverage":if status=="measured" {Some(covered as f64/total as f64)}else{None},
            "crap":if status=="measured" {assessment::score(s.complexity,covered,total)}else{None}})
    }).collect();
    json!({"complete":complete,"functions":rows,"problems":problems})
}

#[test]
fn empty_bodies_require_non_executing_parameters() {
    let path = "/fixture.ts";
    let report = json!({path:{"path":path,"statementMap":{},"s":{}}});
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
    let report = json!({path:{"path":path,"statementMap":{},"s":{}}});
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
            let mut file = json!({"path":path,"statementMap":{},"s":{}});
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
fn parenthesized_arrow_return_has_an_executable_inner_start() {
    let path = "/fixture.ts";
    let source = "const make = () => (({value: 1}));";
    let analysis = Analysis::inspect(path, source).unwrap();
    let report = json!({path:{"path":path,"statementMap":{"0":{
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
    let report = json!({path:{"path":path,"statementMap":{
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
