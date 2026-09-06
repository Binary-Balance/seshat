// Bounded experiment, not a production analyser.
use oxc_allocator::Allocator;
use oxc_ast::{AstKind, ast::ArrowFunctionBody};
use oxc_ast_visit::Visit;
use oxc_parser::Parser;
use oxc_span::{GetSpan, SourceType, Span};
use serde_json::{Value, json};

#[derive(Debug)]
pub struct Scope {
    pub name: String,
    pub span: Span,
    pub body: Span,
    pub complexity: u32,
    pub implicit: bool,
    pub empty: bool,
}

#[test]
fn load_evidence_requires_direct_uncaught_error_construction() {
    let source = "const emoji='🎸';\r\nif (true) throw new Error('module');\r\nfunction f(){throw new Error('function');}\ntry {throw new Error('caught');} catch {}\nthrow 'primitive';\nthrow new TypeError('unsupported');";
    let analysis = Analysis::inspect("fixture.ts", source).unwrap();
    let sites = analysis.load_failure_sites(source);
    assert_eq!(sites.len(), 3);
    assert_eq!(sites[0], [2, 17, 2, 36]);
    assert_eq!(sites[1], [3, 20, 3, 41]);
    assert_eq!(sites[2][0], 6);
    let alternate = source.replace("\r\n", "\u{2028}");
    assert!(
        Analysis::inspect("fixture.ts", &alternate)
            .unwrap()
            .load_failure_sites(&alternate)
            .is_empty()
    );
}

pub struct Comparison {
    pub span: Span,
    pub left: Span,
    pub right: Span,
    pub offset: usize,
    pub original: &'static str,
    pub replacements: &'static [&'static str],
    pub first_id: usize,
}

#[derive(Default)]
pub struct Analysis {
    pub scopes: Vec<Scope>,
    pub comparisons: Vec<Comparison>,
    decisions: Vec<Span>,
    parameter_values: Vec<Span>,
    pub statement_starts: std::collections::BTreeSet<u32>,
    throws: Vec<Span>,
    tries: Vec<Span>,
}

impl<'a> Visit<'a> for Analysis {
    fn enter_node(&mut self, node: AstKind<'a>) {
        if let AstKind::ThrowStatement(statement) = node {
            // Error identity and instanceof Error are checked in the test process.
            if matches!(
                &statement.argument,
                oxc_ast::ast::Expression::NewExpression(_)
            ) {
                self.throws.push(statement.argument.span());
            }
        }
        if let AstKind::TryStatement(statement) = node {
            self.tries.push(statement.span);
        }
        let scope = match node {
            AstKind::Function(f) => f.body.as_ref().map(|b| Scope {
                name: f
                    .id
                    .as_ref()
                    .map(|id| id.name.to_string())
                    .unwrap_or_else(|| format!("function@{}", f.span.start)),
                span: f.span,
                body: b.span,
                complexity: 1,
                implicit: false,
                // Only claim emptiness where parameter evaluation cannot hide work.
                empty: b.statements.is_empty()
                    && b.directives.is_empty()
                    && f.params.items.is_empty()
                    && f.params.rest.is_none(),
            }),
            AstKind::ArrowFunctionExpression(f) => Some(Scope {
                name: format!("arrow@{}", f.span.start),
                span: f.span,
                body: f.body.span(),
                complexity: 1,
                implicit: false,
                empty: matches!(&f.body, ArrowFunctionBody::FunctionBody(b) if b.statements.is_empty() && b.directives.is_empty())
                    && f.params.items.is_empty()
                    && f.params.rest.is_none(),
            }),
            AstKind::PropertyDefinition(p) => p.value.as_ref().map(|v| Scope {
                name: format!("field@{}", p.span.start),
                span: v.span(),
                body: v.span(),
                complexity: 1,
                implicit: true,
                empty: false,
            }),
            AstKind::StaticBlock(b) => Some(Scope {
                name: format!("static@{}", b.span.start),
                span: b.span,
                body: b.span,
                complexity: 1,
                implicit: true,
                empty: false,
            }),
            _ => None,
        };
        if let Some(scope) = scope {
            self.scopes.push(scope);
        }
        match node {
            AstKind::IfStatement(_)
            | AstKind::ForStatement(_)
            | AstKind::ForInStatement(_)
            | AstKind::ForOfStatement(_)
            | AstKind::WhileStatement(_)
            | AstKind::DoWhileStatement(_)
            | AstKind::SwitchStatement(_)
            | AstKind::ReturnStatement(_)
            | AstKind::ThrowStatement(_)
            | AstKind::TryStatement(_)
            | AstKind::BreakStatement(_)
            | AstKind::ContinueStatement(_)
            | AstKind::ExpressionStatement(_)
            | AstKind::VariableDeclaration(_) => {
                self.statement_starts.insert(node.span().start);
            }
            AstKind::VariableDeclarator(v) => {
                self.statement_starts.insert(v.span.start);
                if let Some(value) = &v.init {
                    self.statement_starts.insert(value.span().start);
                }
            }
            AstKind::FormalParameter(p) => {
                if let Some(v) = &p.initializer {
                    self.parameter_values.push(v.span());
                    self.statement_starts.insert(v.span().start);
                }
            }
            AstKind::AssignmentPattern(p) => {
                self.parameter_values.push(p.right.span());
                self.statement_starts.insert(p.right.span().start);
            }
            AstKind::ArrowFunctionExpression(f)
                if !matches!(f.body, ArrowFunctionBody::FunctionBody(_)) =>
            {
                self.statement_starts.insert(f.body.span().start);
                // Source-map tooling can omit parentheses around a concise return.
                // Recognise its AST expression, not arbitrary interior coordinates.
                if let Some(expression) = f.body.as_expression() {
                    self.statement_starts
                        .insert(expression.without_parentheses().span().start);
                }
            }
            _ => {}
        }
        let decision = match node {
            AstKind::IfStatement(_)
            | AstKind::ForStatement(_)
            | AstKind::ForInStatement(_)
            | AstKind::ForOfStatement(_)
            | AstKind::WhileStatement(_)
            | AstKind::DoWhileStatement(_)
            | AstKind::CatchClause(_)
            | AstKind::ConditionalExpression(_)
            | AstKind::LogicalExpression(_)
            | AstKind::AssignmentPattern(_) => true,
            AstKind::FormalParameter(p) => p.initializer.is_some(),
            AstKind::SwitchCase(c) => c.test.is_some(),
            AstKind::AssignmentExpression(a) => {
                matches!(a.operator.as_str(), "&&=" | "||=" | "??=")
            }
            AstKind::StaticMemberExpression(m) => m.optional,
            AstKind::ComputedMemberExpression(m) => m.optional,
            AstKind::PrivateFieldExpression(m) => m.optional,
            AstKind::CallExpression(c) => c.optional,
            _ => false,
        };
        if decision {
            self.decisions.push(node.span());
        }
        if let AstKind::BinaryExpression(b) = node {
            let replacements: &'static [&'static str] = match b.operator.as_str() {
                "<" => &["<=", ">="],
                "<=" => &["<", ">"],
                ">" => &[">=", "<="],
                ">=" => &[">", "<"],
                "==" => &["!="],
                "!=" => &["=="],
                "===" => &["!=="],
                "!==" => &["==="],
                _ => return,
            };
            self.comparisons.push(Comparison {
                span: b.span,
                left: b.left.span(),
                right: b.right.span(),
                offset: 0,
                original: b.operator.as_str(),
                replacements,
                first_id: 0,
            });
        }
    }
}

impl Analysis {
    pub fn load_failure_sites(&self, source: &str) -> Vec<[usize; 4]> {
        // The bounded observer verifies LF/CRLF positions; reject other JS line separators.
        if source.contains(['\u{2028}', '\u{2029}']) || source.replace("\r\n", "").contains('\r') {
            return Vec::new();
        }
        let position = |byte: u32| {
            let prefix = &source[..byte as usize];
            let line = prefix.bytes().filter(|b| *b == b'\n').count() + 1;
            let column = prefix.rsplit('\n').next().unwrap().encode_utf16().count() + 1;
            (line, column)
        };
        self.throws
            .iter()
            .filter(|span| {
                !self
                    .tries
                    .iter()
                    .any(|block| block.start <= span.start && span.end <= block.end)
            })
            .map(|span| {
                let (line, column) = position(span.start);
                let (end_line, end_column) = position(span.end);
                [line, column, end_line, end_column]
            })
            .collect()
    }

    pub fn inspect(path: &str, source: &str) -> Result<Self, String> {
        let allocator = Allocator::default();
        let parsed = Parser::new(
            &allocator,
            source,
            SourceType::from_path(path).map_err(|e| e.to_string())?,
        )
        .parse();
        if parsed.panicked || !parsed.diagnostics.is_empty() {
            return Err(format!("parse error: {:?}", parsed.diagnostics));
        }
        let mut result = Self::default();
        result.visit_program(&parsed.program);
        let decisions = std::mem::take(&mut result.decisions);
        for span in decisions {
            if let Some(i) = result.owner(span.start) {
                result.scopes[i].complexity += 1;
            }
        }
        result
            .comparisons
            .sort_by_key(|c| (c.span.start, std::cmp::Reverse(c.span.end)));
        let mut id = 0;
        for c in &mut result.comparisons {
            let mut offset = c.left.end as usize;
            loop {
                let gap = &source[offset..c.right.start as usize];
                let trimmed = gap.trim_start();
                offset += gap.len() - trimmed.len();
                if trimmed.starts_with("/*") {
                    offset += trimmed.find("*/").ok_or("unclosed comment")? + 2;
                } else if trimmed.starts_with("//") {
                    offset += trimmed
                        .find(['\r', '\n', '\u{2028}', '\u{2029}'])
                        .ok_or("missing comment end")?;
                } else {
                    break;
                }
            }
            if !source[offset..].starts_with(c.original) {
                return Err(format!("operator mismatch at {offset}"));
            }
            c.offset = offset;
            c.first_id = id;
            id += c.replacements.len();
        }
        Ok(result)
    }

    pub fn owner(&self, byte: u32) -> Option<usize> {
        // ponytail: linear interval search for the bounded fixture; index intervals for large corpora.
        self.scopes
            .iter()
            .enumerate()
            .filter(|(_, s)| s.span.start <= byte && byte < s.span.end)
            .min_by_key(|(_, s)| (s.span.end - s.span.start, s.implicit))
            .map(|(i, _)| i)
    }

    pub fn count(&self) -> usize {
        self.comparisons.iter().map(|c| c.replacements.len()).sum()
    }

    pub fn statement_owner(&self, byte: u32) -> Option<usize> {
        self.scopes
            .iter()
            .enumerate()
            .filter(|(_, s)| {
                s.body.start <= byte && byte < s.body.end
                    || self.parameter_values.iter().any(|p| {
                        s.span.start <= p.start
                            && p.end <= s.body.start
                            && p.start <= byte
                            && byte < p.end
                    })
            })
            .min_by_key(|(_, s)| (s.span.end - s.span.start, s.implicit))
            .map(|(i, _)| i)
    }

    pub fn replace(&self, source: &str, id: usize) -> Result<String, String> {
        for c in &self.comparisons {
            if let Some(op) = id
                .checked_sub(c.first_id)
                .and_then(|i| c.replacements.get(i))
            {
                return Ok(format!(
                    "{}{}{}",
                    &source[..c.offset],
                    op,
                    &source[c.offset + c.original.len()..]
                ));
            }
        }
        Err("unknown mutant".into())
    }

    pub fn switched(&self, source: &str) -> Result<String, String> {
        if source.contains("__seshat_") {
            return Err("proof helper name collision".into());
        }
        fn render(a: &Analysis, source: &str, start: u32, end: u32) -> String {
            let mut out = String::new();
            let mut cursor = start;
            for c in &a.comparisons {
                if c.span.start < cursor || c.span.end > end {
                    continue;
                }
                out.push_str(&source[cursor as usize..c.span.start as usize]);
                let left = render(a, source, c.left.start, c.left.end);
                let right = render(a, source, c.right.start, c.right.end);
                out.push_str(&format!(
                    "__seshat_compare({}, ({left}), ({right}), {:?})",
                    c.first_id, c.original
                ));
                cursor = c.span.end;
            }
            out.push_str(&source[cursor as usize..end as usize]);
            out
        }
        let alternatives: Vec<_> = self
            .comparisons
            .iter()
            .flat_map(|c| {
                c.replacements
                    .iter()
                    .enumerate()
                    .map(move |(i, op)| json!([c.first_id + i, c.first_id, op]))
            })
            .collect();
        // This helper proof intentionally measures transpile-only execution. Strict type checking
        // and syntax that observes transformed function text are separate compatibility checks.
        let prefix = format!(
            "const __seshat_active = Number((globalThis as any).process.env.SESHAT_MUTANT_ID ?? -1);\nconst __seshat_alternatives = {};\n",
            json!(alternatives)
        );
        let helper = "function __seshat_compare(site: number, a: any, b: any, op: string) {\n  const alternative = __seshat_alternatives[__seshat_active];\n  if (alternative && alternative[1] === site) op = alternative[2] as string;\n  switch(op) { case '<': return a < b; case '<=': return a <= b; case '>': return a > b; case '>=': return a >= b; case '==': return a == b; case '!=': return a != b; case '===': return a === b; case '!==': return a !== b; default: throw Error('unknown comparison'); }\n}\n";
        Ok(prefix + helper + &render(self, source, 0, source.len() as u32))
    }

    pub fn json(&self) -> Value {
        json!({"scopes": self.scopes.iter().map(|s| json!({"name":s.name,"start":s.span.start,"end":s.span.end,"complexity":s.complexity,"implicit":s.implicit,"empty":s.empty})).collect::<Vec<_>>(),
            "mutants": self.comparisons.iter().flat_map(|c| c.replacements.iter().enumerate().map(move |(i, op)| json!({"id":c.first_id+i,"offset":c.offset,"original":c.original,"replacement":op}))).collect::<Vec<_>>()})
    }
}
