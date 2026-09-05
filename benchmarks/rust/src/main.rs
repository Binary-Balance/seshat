use std::{env, fs, process::Command, time::Instant};
use oxc_allocator::Allocator;
use oxc_ast::AstKind;
use oxc_ast_visit::Visit;
use oxc_parser::Parser;
use oxc_span::{GetSpan, SourceType, Span};
use serde_json::{json, Value};

#[derive(Default)]
struct Analysis<'s> {
    source: &'s str,
    functions: Vec<(u32, u32, u32)>,
    comparisons: Vec<(u32, &'static str)>,
    stack: Vec<usize>,
}

fn function_body(kind: AstKind<'_>) -> Option<Span> {
    match kind {
        AstKind::Function(f) => f.body.as_ref().map(|b| b.span),
        AstKind::ArrowFunctionExpression(f) => Some(f.body.span()),
        _ => None,
    }
}

impl<'a> Visit<'a> for Analysis<'_> {
    fn enter_node(&mut self, kind: AstKind<'a>) {
        if let Some(span) = function_body(kind) {
            self.stack.push(self.functions.len());
            self.functions.push((span.start, span.end, 1));
        }
        let decision = match kind {
            AstKind::IfStatement(_) | AstKind::ForStatement(_) | AstKind::ForInStatement(_)
            | AstKind::ForOfStatement(_) | AstKind::WhileStatement(_) | AstKind::DoWhileStatement(_)
            | AstKind::CatchClause(_) | AstKind::ConditionalExpression(_) | AstKind::LogicalExpression(_) => true,
            AstKind::SwitchCase(c) => c.test.is_some(),
            AstKind::AssignmentExpression(a) => matches!(a.operator.as_str(), "&&=" | "||=" | "??="),
            _ => false,
        };
        if decision { if let Some(&i) = self.stack.last() { self.functions[i].2 += 1; } }
        if let AstKind::BinaryExpression(b) = kind {
            let op = b.operator.as_str();
            if matches!(op, "<" | "<=" | ">" | ">=" | "==" | "!=" | "===" | "!==") {
                let mut start = b.left.span().end as usize;
                let end = b.right.span().start as usize;
                // Only trivia may precede an AST-identified operator; comments are not candidates.
                loop {
                    let gap = &self.source[start..end];
                    let trimmed = gap.trim_start();
                    start += gap.len() - trimmed.len();
                    if trimmed.starts_with("/*") {
                        start += trimmed.find("*/").expect("Closed comment") + 2;
                    } else if trimmed.starts_with("//") {
                        start += trimmed.find(['\r', '\n']).expect("Comment newline");
                    } else { break; }
                }
                assert!(self.source[start..].starts_with(op));
                self.comparisons.push((start as u32, op));
            }
        }
    }
    fn leave_node(&mut self, kind: AstKind<'a>) {
        if function_body(kind).is_some() { self.stack.pop(); }
    }
}

fn analyze<'s>(path: &str, source: &'s str, parse_only: bool) -> Analysis<'s> {
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, SourceType::from_path(path).unwrap()).parse();
    assert!(parsed.diagnostics.is_empty() && !parsed.panicked, "Parse failed: {path}: {:?}", parsed.diagnostics);
    let mut analysis = Analysis { source, ..Default::default() };
    if !parse_only { analysis.visit_program(&parsed.program); }
    analysis.functions.sort_by_key(|f| f.0);
    analysis.comparisons.sort_by_key(|c| c.0);
    analysis
}

fn report(analysis: &Analysis<'_>) -> Value {
    let functions: Vec<_> = analysis.functions.iter().map(|&(start, end, cc)| {
        // Fixed 50% is a math workload, never a claim about actual project coverage.
        json!([start, end, cc, (cc * cc) as f64 * 0.125 + cc as f64])
    }).collect();
    json!({"functions": functions, "comparisons": analysis.comparisons})
}

fn max_rss_kb() -> u64 {
    fs::read_to_string("/proc/self/status").unwrap().lines()
        .find(|s| s.starts_with("VmHWM:")).unwrap().split_whitespace().nth(1).unwrap().parse().unwrap()
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let paths: Vec<String> = serde_json::from_str(&fs::read_to_string(&args[0]).unwrap()).unwrap();
    let mode = args.get(1).map(String::as_str).unwrap_or("analyze");
    let repeat: usize = args.get(2).map(|s| s.parse().unwrap()).unwrap_or(1);
    let rounds: usize = args.get(3).map(|s| s.parse().unwrap()).unwrap_or(1);
    let warmup: usize = args.get(4).map(|s| s.parse().unwrap()).unwrap_or(0);
    let sources: Vec<_> = paths.iter().map(|p| (p, fs::read_to_string(p).unwrap())).collect();
    if mode == "dump" {
        let reports: Vec<_> = sources.iter().map(|(p, s)| report(&analyze(p, s, false))).collect();
        println!("{}", json!(reports));
        return;
    }
    if mode == "mutate" {
        let (path, source) = &sources[0];
        let target = env::var("SESHAT_MUTANT_TARGET").unwrap();
        let run = || Command::new(env::var("SESHAT_NODE").unwrap_or("node".into()))
            .args(["--test", "--test-reporter=tap", &paths[1]]).output().unwrap();
        fs::write(&target, source).unwrap();
        assert!(run().status.success(), "Baseline failed");
        let start = Instant::now();
        let mut outcomes = Vec::new();
        for (offset, op) in analyze(path, source, false).comparisons {
            let replacement = match op {
                "<" => "<=", "<=" => "<", ">" => ">=", ">=" => ">", "==" => "!=",
                "!=" => "==", "===" => "!==", "!==" => "===", _ => unreachable!(),
            };
            let offset = offset as usize;
            let mutant = format!("{}{}{}", &source[..offset], replacement, &source[offset+op.len()..]);
            fs::write(&target, mutant).unwrap();
            let result = run();
            let stdout = String::from_utf8_lossy(&result.stdout);
            assert!(result.status.success() || result.status.code() == Some(1) && stdout.contains("ERR_ASSERTION"), "Execution error");
            outcomes.push(json!([offset, op, if result.status.success() { "survived" } else { "killed" }]));
        }
        println!("{}", json!({"outcomes": outcomes, "executionMs": start.elapsed().as_secs_f64()*1000.0, "maxRssKb": max_rss_kb()}));
        return;
    }
    let mut times = Vec::new();
    let mut checksum = 0;
    for round in 0..warmup+rounds {
        let start = Instant::now();
        checksum = 0;
        for _ in 0..repeat {
            for (path, source) in &sources {
                let result = analyze(path, source, mode == "parse");
                // Include scoring work in both measured implementations.
                let score: f64 = result.functions.iter().map(|f| (f.2*f.2) as f64*0.125+f.2 as f64).sum();
                std::hint::black_box(score);
                checksum += result.functions.len() + result.comparisons.len();
            }
        }
        if round >= warmup { times.push(start.elapsed().as_secs_f64()*1000.0); }
    }
    println!("{}", json!({"times": times, "checksum": checksum, "maxRssKb": max_rss_kb()}));
}
