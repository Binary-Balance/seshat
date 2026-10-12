// Bounded experiment, not a production analyser.
use oxc_allocator::Allocator;
use oxc_ast::{
    AstKind,
    ast::{
        ArrowFunctionBody, Declaration, ExportDefaultDeclarationKind, Expression, FormalParameters,
        JSXAttributeItem, JSXAttributeValue, JSXChild, MethodDefinitionKind, PropertyKind, TSType,
        TSTypeName,
    },
};
use oxc_ast_visit::Visit;
use oxc_parser::Parser;
use oxc_span::{GetSpan, SourceType, Span};
use serde_json::{Value, json};

#[derive(Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TypeSafety {
    explicit_any: u32,
    type_assertions: u32,
    double_assertions: u32,
    non_null_assertions: u32,
    ts_ignore: u32,
    ts_expect_error: u32,
    ts_nocheck: u32,
}

enum Escape {
    Any,
    Assertion,
    DoubleAssertion,
    NonNull,
    Ignore,
    ExpectError,
    Nocheck,
}

impl TypeSafety {
    fn count(&mut self, escape: Escape) {
        let count = match escape {
            Escape::Any => &mut self.explicit_any,
            Escape::Assertion => &mut self.type_assertions,
            Escape::DoubleAssertion => &mut self.double_assertions,
            Escape::NonNull => &mut self.non_null_assertions,
            Escape::Ignore => &mut self.ts_ignore,
            Escape::ExpectError => &mut self.ts_expect_error,
            Escape::Nocheck => &mut self.ts_nocheck,
        };
        *count += 1;
    }
}

fn const_assertion(annotation: &TSType<'_>) -> bool {
    matches!(annotation, TSType::TSTypeReference(reference)
        if matches!(&reference.type_name, TSTypeName::IdentifierReference(name) if name.name == "const"))
}

fn asserted(expression: &Expression<'_>) -> bool {
    match expression.without_parentheses() {
        Expression::TSAsExpression(assertion) => !const_assertion(&assertion.type_annotation),
        Expression::TSTypeAssertion(assertion) => !const_assertion(&assertion.type_annotation),
        _ => false,
    }
}

fn initialized_function(expression: &Expression<'_>) -> Option<u32> {
    match expression.without_parentheses() {
        Expression::ArrowFunctionExpression(function) => Some(function.span.start),
        Expression::FunctionExpression(function) => Some(function.span.start),
        _ => None,
    }
}

// TypeScript's directive regexes use JavaScript whitespace, not Rust's Unicode set.
fn javascript_whitespace(character: char) -> bool {
    matches!(character, '\u{0009}'..='\u{000d}' | ' ' | '\u{00a0}' | '\u{1680}'
        | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}'
        | '\u{205f}' | '\u{3000}' | '\u{feff}')
}

#[derive(Debug)]
pub struct Scope {
    pub name: String,
    pub span: Span,
    pub body: Span,
    pub complexity: u32,
    pub implicit: bool,
    pub empty: bool,
    pub extreme_skip: Option<&'static str>,
    pub returns_value: bool,
    pub type_safety: TypeSafety,
}

pub struct BranchSite {
    pub kind: &'static str,
    pub span: Span,
    pub outcomes: Vec<Option<Span>>,
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
    for separator in ["\r", "\u{2028}", "\u{2029}"] {
        let alternate = source.replace("\r\n", separator);
        assert!(
            Analysis::inspect("fixture.ts", &alternate)
                .unwrap()
                .load_failure_sites(&alternate)
                .is_empty()
        );
    }
}

#[test]
fn load_evidence_respects_catch_blocks_and_function_boundaries() {
    for (source, recognised) in [
        ("try { throw new Error('caught'); } catch {}", false),
        ("try {} catch { throw new Error('catch'); }", true),
        (
            "try {} catch {} finally { throw new Error('finally'); }",
            true,
        ),
        ("try { throw new Error('no catch'); } finally {}", true),
        (
            "try { try {} catch { throw new Error('outer catch'); } } catch {}",
            false,
        ),
        (
            "try { try {} finally { throw new Error('outer catch'); } } catch {}",
            false,
        ),
        (
            "try { function later() { throw new Error('function'); } } catch {}",
            true,
        ),
        (
            "try { const later = () => { throw new Error('arrow'); }; } catch {}",
            true,
        ),
        (
            "try { const obj = { later() { throw new Error('method'); } }; } catch {}",
            true,
        ),
        (
            "try { class C { later() { throw new Error('method'); } } } catch {}",
            true,
        ),
        (
            "try { class C { static { throw new Error('caught static'); } } } catch {}",
            false,
        ),
        (
            "try { function later() { try { throw new Error('inner catch'); } catch {} } } catch {}",
            false,
        ),
    ] {
        let analysis = Analysis::inspect("fixture.ts", source).unwrap();
        let sites = analysis.load_failure_sites(source);
        assert_eq!(sites.len(), usize::from(recognised), "{source}: {sites:?}");
        if recognised {
            assert_eq!(sites[0][0], 1);
            assert_eq!(sites[0][1], source.find("new Error").unwrap() + 1);
        }
    }
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
    pub branches: Vec<BranchSite>,
    pub branch_end_ranges: Vec<Span>,
    pub comparisons: Vec<Comparison>,
    decisions: Vec<Span>,
    pub parameter_values: Vec<Span>,
    pub statement_starts: std::collections::BTreeSet<u32>,
    throws: Vec<Span>,
    caught_blocks: Vec<Span>,
    switching_start: Option<u32>,
    excluded_methods: std::collections::BTreeMap<u32, &'static str>,
    return_values: Vec<Span>,
    void_functions: std::collections::BTreeSet<u32>,
    escapes: Vec<(Span, Escape)>,
    unowned_type_safety: TypeSafety,
    suppressions: Vec<Value>,
    suppression_targets: std::collections::BTreeMap<u32, u32>,
}

// Plain bindings do not execute user code. Other parameter forms may evaluate
// expressions, invoke getters/iterators or emit constructor property assignments.
fn plain_parameters(params: &FormalParameters<'_>) -> bool {
    params.rest.is_none()
        && params.items.iter().all(|p| {
            p.pattern.is_binding_identifier()
                && p.initializer.is_none()
                && p.decorators.is_empty()
                && !p.has_modifier()
        })
}

impl<'a> Visit<'a> for Analysis {
    fn enter_node(&mut self, node: AstKind<'a>) {
        match node {
            AstKind::Function(function) => {
                if function.return_type.as_ref().is_some_and(|annotation| {
                    matches!(annotation.type_annotation, TSType::TSVoidKeyword(_))
                }) {
                    self.void_functions.insert(function.span.start);
                }
            }
            AstKind::ArrowFunctionExpression(function) => {
                if function.return_type.as_ref().is_some_and(|annotation| {
                    matches!(annotation.type_annotation, TSType::TSVoidKeyword(_))
                }) {
                    self.void_functions.insert(function.span.start);
                }
            }
            AstKind::MethodDefinition(method) => {
                let reason = match method.kind {
                    MethodDefinitionKind::Constructor => Some("constructor"),
                    MethodDefinitionKind::Get | MethodDefinitionKind::Set => Some("accessor"),
                    MethodDefinitionKind::Method => None,
                };
                if let Some(reason) = reason {
                    self.excluded_methods
                        .insert(method.value.span.start, reason);
                }
            }
            AstKind::ObjectProperty(property) if property.kind != PropertyKind::Init => {
                self.excluded_methods
                    .insert(property.value.span().start, "accessor");
            }
            AstKind::ReturnStatement(statement) => {
                if let Some(argument) = &statement.argument {
                    let returns_void = matches!(argument.without_parentheses(), Expression::UnaryExpression(unary) if unary.operator.as_str() == "void");
                    if !returns_void {
                        self.return_values.push(statement.span);
                    }
                }
            }
            _ => {}
        }
        let suppression_target = match node {
            AstKind::ExportDeclaration(export) => match &export.declaration {
                Declaration::FunctionDeclaration(function) => Some(function.span.start),
                Declaration::VariableDeclaration(declaration) => declaration
                    .declarations
                    .first()
                    .and_then(|declarator| declarator.init.as_ref())
                    .and_then(initialized_function),
                _ => None,
            },
            AstKind::ExportDefaultDeclaration(export) => match &export.declaration {
                ExportDefaultDeclarationKind::FunctionDeclaration(function) => {
                    Some(function.span.start)
                }
                expression => expression.as_expression().and_then(initialized_function),
            },
            AstKind::VariableDeclaration(declaration) => declaration
                .declarations
                .first()
                .and_then(|declarator| declarator.init.as_ref())
                .and_then(initialized_function),
            AstKind::VariableDeclarator(declarator) => {
                declarator.init.as_ref().and_then(initialized_function)
            }
            AstKind::MethodDefinition(method) => Some(method.value.span.start),
            AstKind::ObjectProperty(property) => initialized_function(&property.value),
            AstKind::PropertyDefinition(property) => {
                property.value.as_ref().and_then(initialized_function)
            }
            _ => None,
        };
        if let Some(target) = suppression_target {
            self.suppression_targets.insert(node.span().start, target);
        }
        let assertion = match node {
            AstKind::TSAnyKeyword(_) => {
                self.escapes.push((node.span(), Escape::Any));
                None
            }
            AstKind::TSNonNullExpression(_) => {
                let end = node.span().end;
                self.escapes
                    .push((Span::new(end - 1, end), Escape::NonNull));
                None
            }
            AstKind::TSAsExpression(assertion) if !const_assertion(&assertion.type_annotation) => {
                Some((&assertion.expression, assertion.type_annotation.span()))
            }
            AstKind::TSTypeAssertion(assertion) if !const_assertion(&assertion.type_annotation) => {
                Some((&assertion.expression, assertion.type_annotation.span()))
            }
            _ => None,
        };
        if let Some((expression, span)) = assertion {
            self.escapes.push((span, Escape::Assertion));
            if asserted(expression) {
                self.escapes.push((span, Escape::DoubleAssertion));
            }
        }
        if let AstKind::ParenthesizedExpression(expression) = node {
            self.branch_end_ranges.push(Span::new(
                expression.expression.without_parentheses().span().end,
                expression.span.end,
            ));
        }
        if let AstKind::JSXExpressionContainer(container) = node {
            // Empty comment containers have no executable value. Both forms
            // close before any following child or attribute.
            self.branch_end_ranges.push(Span::new(
                container
                    .expression
                    .as_expression()
                    .map_or(container.span.start, |expression| {
                        expression.without_parentheses().span().end
                    }),
                container.span.end,
            ));
        }
        if let AstKind::JSXText(text) = node
            && text.value.trim().is_empty()
        {
            self.branch_end_ranges.push(text.span);
        }
        if let AstKind::JSXOpeningElement(element) = node
            && let Some(JSXAttributeItem::Attribute(attribute)) = element.attributes.last()
            && let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value
        {
            // Only the final attribute is followed solely by tag punctuation.
            self.branch_end_ranges
                .push(Span::new(container.span.end, element.span.end));
        }
        let jsx = match node {
            AstKind::JSXElement(element) => Some((&element.children, element.span.end)),
            AstKind::JSXFragment(fragment) => Some((&fragment.children, fragment.span.end)),
            _ => None,
        };
        if let Some((children, end)) = jsx
            && let Some(JSXChild::ExpressionContainer(container)) = children.last()
        {
            // Only a final expression child is followed solely by a closing tag.
            self.branch_end_ranges
                .push(Span::new(container.span.end, end));
        }
        match node {
            // Source maps can include an enclosing operator's punctuation, but
            // must stop before its next executable operand or outcome.
            AstKind::ConditionalExpression(expression) => {
                self.branch_end_ranges.push(Span::new(
                    expression.test.without_parentheses().span().end,
                    expression.consequent.without_parentheses().span().start,
                ));
                self.branch_end_ranges.push(Span::new(
                    expression.consequent.without_parentheses().span().end,
                    expression.alternate.without_parentheses().span().start,
                ));
            }
            AstKind::LogicalExpression(expression) => {
                self.branch_end_ranges.push(Span::new(
                    expression.left.without_parentheses().span().end,
                    expression.right.without_parentheses().span().start,
                ));
            }
            AstKind::IfStatement(statement) => {
                self.branch_end_ranges.push(Span::new(
                    statement.test.without_parentheses().span().end,
                    statement.consequent.span().start,
                ));
            }
            AstKind::ObjectExpression(expression) => {
                // A property's comma and the final closing brace evaluate no
                // code. Stop at the next property, including computed keys.
                for (index, property) in expression.properties.iter().enumerate() {
                    self.branch_end_ranges.push(Span::new(
                        property.span().end,
                        expression
                            .properties
                            .get(index + 1)
                            .map_or(expression.span.end, |next| next.span().start),
                    ));
                }
            }
            _ => {}
        }
        let branch = match node {
            AstKind::IfStatement(statement) => Some(BranchSite {
                kind: "if",
                span: statement.span,
                // Istanbul maps the true outcome to the entire if, and an
                // implicit else has no source location but still has a counter.
                outcomes: vec![
                    Some(statement.span),
                    statement.alternate.as_ref().map(GetSpan::span),
                ],
            }),
            AstKind::ConditionalExpression(expression) => Some(BranchSite {
                kind: "cond-expr",
                span: expression.span,
                outcomes: vec![
                    Some(expression.consequent.without_parentheses().span()),
                    Some(expression.alternate.without_parentheses().span()),
                ],
            }),
            AstKind::LogicalExpression(expression) => {
                fn leaves(expression: &Expression<'_>, outcomes: &mut Vec<Option<Span>>) {
                    match expression.without_parentheses() {
                        Expression::LogicalExpression(expression) => {
                            leaves(&expression.left, outcomes);
                            leaves(&expression.right, outcomes);
                        }
                        expression => outcomes.push(Some(expression.span())),
                    }
                }
                let mut outcomes = Vec::new();
                leaves(&expression.left, &mut outcomes);
                leaves(&expression.right, &mut outcomes);
                Some(BranchSite {
                    kind: "binary-expr",
                    span: expression.span,
                    outcomes,
                })
            }
            AstKind::FormalParameter(parameter) => {
                parameter.initializer.as_ref().map(|value| BranchSite {
                    kind: "default-arg",
                    span: parameter.span,
                    outcomes: vec![Some(value.without_parentheses().span())],
                })
            }
            AstKind::AssignmentPattern(pattern) => Some(BranchSite {
                kind: "default-arg",
                span: pattern.span,
                outcomes: vec![Some(pattern.right.without_parentheses().span())],
            }),
            AstKind::SwitchStatement(statement) => Some(BranchSite {
                kind: "switch",
                span: statement.span,
                outcomes: statement.cases.iter().map(|case| Some(case.span)).collect(),
            }),
            _ => None,
        };
        if let Some(branch) = branch {
            // Istanbul records one flattened logical tree. A logical expression
            // inside a leaf, such as a conditional or function, is a new site.
            let flattened = branch.kind == "binary-expr"
                && self.branches.iter().any(|parent| {
                    parent.kind == "binary-expr"
                        && parent.span.start <= branch.span.start
                        && branch.span.end <= parent.span.end
                        && !parent.outcomes.iter().flatten().any(|leaf| {
                            leaf.start <= branch.span.start && branch.span.end <= leaf.end
                        })
                });
            if !flattened {
                self.branches.push(branch);
            }
        }
        if let AstKind::ThrowStatement(statement) = node {
            // Error identity and instanceof Error are checked in the test process.
            if matches!(
                &statement.argument,
                oxc_ast::ast::Expression::NewExpression(_)
            ) {
                self.throws.push(statement.argument.span());
            }
        }
        if let AstKind::TryStatement(statement) = node
            && statement.handler.is_some()
        {
            self.caught_blocks.push(statement.block.span);
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
                type_safety: TypeSafety::default(),
                // Only claim emptiness where parameter evaluation cannot hide work.
                empty: b.statements.is_empty()
                    && b.directives.is_empty()
                    && plain_parameters(&f.params),
                extreme_skip: self.excluded_methods.get(&f.span.start).copied()
                    .or(if f.generator { Some("generator") } else if b.statements.is_empty() && b.directives.is_empty() { Some("empty") } else { None }),
                returns_value: false,
            }),
            AstKind::ArrowFunctionExpression(f) => Some(Scope {
                name: format!("arrow@{}", f.span.start),
                span: f.span,
                body: f.body.span(),
                complexity: 1,
                implicit: false,
                type_safety: TypeSafety::default(),
                empty: matches!(&f.body, ArrowFunctionBody::FunctionBody(b) if b.statements.is_empty() && b.directives.is_empty())
                    && plain_parameters(&f.params),
                extreme_skip: matches!(&f.body, ArrowFunctionBody::FunctionBody(b) if b.statements.is_empty() && b.directives.is_empty()).then_some("empty"),
                returns_value: !matches!(f.body, ArrowFunctionBody::FunctionBody(_))
                    && !self.void_functions.contains(&f.span.start)
                    && !f.body.as_expression().is_some_and(|expression| matches!(expression.without_parentheses(), Expression::UnaryExpression(unary) if unary.operator.as_str() == "void")),
            }),
            AstKind::PropertyDefinition(p) => p.value.as_ref().map(|v| Scope {
                name: format!("field@{}", p.span.start),
                span: v.span(),
                body: v.span(),
                complexity: 1,
                implicit: true,
                type_safety: TypeSafety::default(),
                empty: false,
                extreme_skip: Some("implicit-scope"),
                returns_value: false,
            }),
            AstKind::StaticBlock(b) => Some(Scope {
                name: format!("static@{}", b.span.start),
                span: b.span,
                body: b.span,
                complexity: 1,
                implicit: true,
                type_safety: TypeSafety::default(),
                empty: false,
                extreme_skip: Some("implicit-scope"),
                returns_value: false,
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
            | AstKind::LabeledStatement(_)
            | AstKind::DebuggerStatement(_)
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
            AstKind::BindingProperty(p) if p.computed => {
                self.parameter_values.push(p.key.span());
            }
            AstKind::Decorator(decorator) => {
                self.parameter_values.push(decorator.expression.span());
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

pub fn supports_line_positions(source: &str) -> bool {
    !source.contains(['\u{2028}', '\u{2029}']) && !source.replace("\r\n", "").contains('\r')
}

impl Analysis {
    pub fn load_failure_sites(&self, source: &str) -> Vec<[usize; 4]> {
        // The bounded observer verifies LF/CRLF positions; reject other JS line separators.
        if !supports_line_positions(source) {
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
                !self.caught_blocks.iter().any(|block| {
                    block.start <= span.start
                        && span.end <= block.end
                        // A function declared inside this block may be called elsewhere.
                        // Static blocks and fields do not create function boundaries.
                        && !self.scopes.iter().any(|scope| {
                            !scope.implicit
                                && block.start <= scope.span.start
                                && scope.span.start <= span.start
                                && span.end <= scope.span.end
                                && scope.span.end <= block.end
                        })
                })
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
        let source_type = SourceType::from_path(path).map_err(|e| e.to_string())?;
        let parsed = Parser::new(&allocator, source, source_type).parse();
        if parsed.panicked || !parsed.diagnostics.is_empty() {
            return Err(format!("parse error: {:?}", parsed.diagnostics));
        }
        let mut result = Self {
            // The program body excludes hashbangs and directive prologues. Helpers must
            // follow both, or preparation can break syntax and disable strict mode.
            switching_start: (source_type.is_typescript()
                && !source_type.is_typescript_definition())
            .then(|| {
                parsed
                    .program
                    .body
                    .first()
                    .map_or(source.len() as u32, |statement| statement.span().start)
            }),
            ..Self::default()
        };
        result.visit_program(&parsed.program);
        for span in std::mem::take(&mut result.return_values) {
            if let Some(index) = result.owner(span.start) {
                let scope = &mut result.scopes[index];
                if !result.void_functions.contains(&scope.span.start) {
                    scope.returns_value = true;
                }
            }
        }
        for (span, escape) in std::mem::take(&mut result.escapes) {
            result.count_escape(result.owner(span.start), escape);
        }
        for comment in &parsed.program.comments {
            let span = comment.content_span();
            let content = &source[span.start as usize..span.end as usize];
            // TypeScript line directives start the comment; block directives use its last line.
            let line = if comment.is_line() {
                content
                    .strip_prefix('/')
                    .unwrap_or(content)
                    .trim_start_matches(javascript_whitespace)
            } else {
                // Keep delimiters before whitespace to match TypeScript's directive prefix.
                source[comment.span.start as usize..comment.span.end as usize]
                    .split(['\r', '\n', '\u{2028}', '\u{2029}'])
                    .next_back()
                    .unwrap_or("")
                    .trim_start_matches(javascript_whitespace)
                    .trim_start_matches(['/', '*'])
                    .trim_start_matches(javascript_whitespace)
            };
            let directive = [
                ("@ts-ignore", Escape::Ignore),
                ("@ts-expect-error", Escape::ExpectError),
                ("@ts-nocheck", Escape::Nocheck),
            ]
            .into_iter()
            .find(|(name, _)| {
                if *name == "@ts-nocheck" {
                    comment.is_line()
                        && line
                            .get(..name.len())
                            .is_some_and(|prefix| prefix.eq_ignore_ascii_case(name))
                        && line.get(name.len()..).is_some_and(|rest| {
                            rest.is_empty()
                                || rest.starts_with(':')
                                || rest.starts_with(javascript_whitespace)
                        })
                } else {
                    line.starts_with(name)
                }
            });
            if let Some((kind, escape)) = directive {
                let first_code = parsed
                    .program
                    .directives
                    .first()
                    .map(GetSpan::span)
                    .or_else(|| parsed.program.body.first().map(GetSpan::span));
                let file_level = kind == "@ts-nocheck"
                    && first_code.is_none_or(|span| comment.span.end <= span.start);
                let owner = if file_level {
                    None
                } else if comment.is_leading() {
                    let target = result
                        .suppression_targets
                        .get(&comment.attached_to)
                        .copied()
                        .unwrap_or(comment.attached_to);
                    result
                        .owner(target)
                        .or_else(|| result.owner(comment.span.start))
                } else {
                    result.owner(comment.span.start)
                };
                result.suppressions.push(json!({"kind":kind,"start":comment.span.start,
                    "end":comment.span.end,"owner":owner.map(|index| result.scopes[index].span.start),
                    "fileLevel":file_level}));
                result.count_escape(owner, escape);
            }
        }
        result.branch_end_ranges.sort_by_key(|range| range.start);
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

    fn count_escape(&mut self, owner: Option<usize>, escape: Escape) {
        if let Some(index) = owner {
            self.scopes[index].type_safety.count(escape);
        } else {
            self.unowned_type_safety.count(escape);
        }
    }

    pub fn type_safety(&self) -> Value {
        json!({"unowned":self.unowned_type_safety,"suppressions":self.suppressions})
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

    pub fn replace_extreme(&self, source: &str, index: usize) -> Result<String, String> {
        let scope = self.scopes.get(index).ok_or("unknown function")?;
        if scope.extreme_skip.is_some() {
            return Err("function is excluded from extreme mutation".into());
        }
        Ok(format!(
            "{}{}{}",
            &source[..scope.body.start as usize],
            self.extreme_body(scope),
            &source[scope.body.end as usize..]
        ))
    }

    pub fn extreme_body(&self, scope: &Scope) -> &'static str {
        if scope.returns_value {
            // Target functions can shadow the identifier `undefined`.
            "{ return void 0; }"
        } else {
            "{}"
        }
    }

    pub fn switched(&self, source: &str) -> Result<String, String> {
        self.switched_with_offset(source, 0)
    }

    pub fn switched_with_offset(&self, source: &str, id_offset: usize) -> Result<String, String> {
        let start = self
            .switching_start
            .ok_or("experimental switching requires a non-declaration TypeScript source")?;
        if source.contains("__seshat_") {
            return Err("proof helper name collision".into());
        }
        fn render(a: &Analysis, source: &str, start: u32, end: u32, id_offset: usize) -> String {
            let mut out = String::new();
            let mut cursor = start;
            for c in &a.comparisons {
                if c.span.start < cursor || c.span.end > end {
                    continue;
                }
                out.push_str(&source[cursor as usize..c.span.start as usize]);
                let left = render(a, source, c.left.start, c.left.end, id_offset);
                let right = render(a, source, c.right.start, c.right.end, id_offset);
                out.push_str(&format!(
                    "__seshat_compare({}, ({left}), ({right}), {:?})",
                    c.first_id + id_offset,
                    c.original
                ));
                cursor = c.span.end;
            }
            out.push_str(&source[cursor as usize..end as usize]);
            out
        }
        let mut alternatives = vec![Value::Null; id_offset];
        alternatives.extend(self.comparisons.iter().flat_map(|c| {
            c.replacements
                .iter()
                .enumerate()
                .map(move |(i, op)| json!([c.first_id + id_offset + i, c.first_id + id_offset, op]))
        }));
        // This helper proof intentionally measures transpile-only execution. Strict type checking
        // and syntax that observes transformed function text are separate compatibility checks.
        let prefix = format!(
            "\nif (!(globalThis as any).process?.env) throw new Error('experimental switching requires globalThis.process.env');\nconst __seshat_active = Number((globalThis as any).process.env.SESHAT_MUTANT_ID ?? -1);\nconst __seshat_alternatives = {};\n",
            json!(alternatives)
        );
        let helper = "function __seshat_compare(site: number, a: any, b: any, op: string) {\n  const alternative = __seshat_alternatives[__seshat_active];\n  if (alternative && alternative[1] === site) op = alternative[2] as string;\n  switch(op) { case '<': return a < b; case '<=': return a <= b; case '>': return a > b; case '>=': return a >= b; case '==': return a == b; case '!=': return a != b; case '===': return a === b; case '!==': return a !== b; default: throw Error('unknown comparison'); }\n}\n";
        Ok(source[..start as usize].to_owned()
            + &prefix
            + helper
            + &render(self, source, start, source.len() as u32, id_offset))
    }

    pub fn json(&self) -> Value {
        json!({"scopes": self.scopes.iter().map(|s| json!({"name":s.name,"start":s.span.start,"end":s.span.end,"complexity":s.complexity,"implicit":s.implicit,"empty":s.empty,"typeSafety":s.type_safety})).collect::<Vec<_>>(),
            "typeSafety":self.type_safety(),
            "mutants": self.comparisons.iter().flat_map(|c| c.replacements.iter().enumerate().map(move |(i, op)| json!({"id":c.first_id+i,"offset":c.offset,"original":c.original,"replacement":op}))).collect::<Vec<_>>()})
    }
}

#[test]
fn extreme_mutation_replaces_only_the_owning_body() {
    for (source, expected) in [
        (
            "function side() { console.log('side'); }",
            "function side() {}",
        ),
        ("function side() { return; }", "function side() {}"),
        (
            "function side(): void { return work(); }",
            "function side(): void {}",
        ),
        (
            "function side() { return void work(); }",
            "function side() {}",
        ),
        (
            "const side = (): void => work();",
            "const side = (): void => {};",
        ),
        ("const side = () => void work();", "const side = () => {};"),
        (
            "function outer() { function inner() { return 1; } inner(); }",
            "function outer() {}",
        ),
        (
            "async function value() { return 1; }",
            "async function value() { return void 0; }",
        ),
        (
            "const value = () => ({ answer: 42 });",
            "const value = () => { return void 0; };",
        ),
        (
            "function value(undefined: number) { return 1; }",
            "function value(undefined: number) { return void 0; }",
        ),
        (
            "const undefined = 1; const value = () => 1;",
            "const undefined = 1; const value = () => { return void 0; };",
        ),
        (
            "const side = () => { console.log('side'); };",
            "const side = () => {};",
        ),
    ] {
        let analysis = Analysis::inspect("fixture.ts", source).unwrap();
        let replacement = analysis.replace_extreme(source, 0).unwrap();
        assert_eq!(replacement, expected, "{source}");
        Analysis::inspect("fixture.ts", &replacement).unwrap();
    }
}

#[test]
fn extreme_mutation_skips_empty_functions_and_special_methods() {
    let source = "function empty(a = work()) {} function* generator() { yield 1; } const obj = { get value() { return 1; }, set value(v) { work(v); }, method() { return 1; } }; class C { constructor() { work(); } get value() { return 1; } set value(v) { work(v); } method() { work(); } }";
    let analysis = Analysis::inspect("fixture.ts", source).unwrap();
    let reasons: Vec<_> = analysis
        .scopes
        .iter()
        .map(|scope| scope.extreme_skip)
        .collect();
    assert_eq!(
        reasons,
        [
            Some("empty"),
            Some("generator"),
            Some("accessor"),
            Some("accessor"),
            None,
            Some("constructor"),
            Some("accessor"),
            Some("accessor"),
            None
        ]
    );
    for (index, scope) in analysis.scopes.iter().enumerate() {
        assert_eq!(
            analysis.replace_extreme(source, index).is_err(),
            scope.extreme_skip.is_some()
        );
    }
}

#[test]
fn switching_preserves_hashbangs_and_directives() {
    for source in [
        "",
        "#!/usr/bin/env node",
        "#!/usr/bin/env node\n1 < 2;",
        "\u{feff}\"use strict\"; 1 < 2;",
        "/* 🎸 */ 'use client'; \"use strict\"\n1 < 2;",
        "'use strict' // trailing comment",
        "#!/usr/bin/env node\r\n'use strict'\r\n1 < 2;",
        "'use strict'\u{2028}1 < 2;",
    ] {
        let analysis = Analysis::inspect("source.ts", source).unwrap();
        let switched = analysis.switched(source).unwrap();
        let allocator = Allocator::default();
        let before = Parser::new(&allocator, source, SourceType::ts()).parse();
        let after = Parser::new(&allocator, &switched, SourceType::ts()).parse();
        assert!(
            after.diagnostics.is_empty(),
            "{source}: {:?}",
            after.diagnostics
        );
        assert_eq!(
            before.program.hashbang.as_ref().map(|h| h.value.as_str()),
            after.program.hashbang.as_ref().map(|h| h.value.as_str()),
            "{source}"
        );
        assert_eq!(
            before
                .program
                .directives
                .iter()
                .map(|d| d.directive.as_str())
                .collect::<Vec<_>>(),
            after
                .program
                .directives
                .iter()
                .map(|d| d.directive.as_str())
                .collect::<Vec<_>>(),
            "{source}"
        );
    }
}

#[test]
fn type_safety_counts_syntax_and_preserves_unowned_suppressions() {
    let source = r#"// @TS-NOCHECK
let moduleValue: any;
// @ts-ignore deliberate suppression
export function outer<T extends any>(value: any): any {
  const quoted = "any as T ! // @ts-ignore";
  const template = `@ts-expect-error ${value}`;
  /* mention @ts-ignore, not a directive */
  // prose @ts-ignore is not a directive
  /* @ts-nocheck is not a file pragma */
  const narrowed = value as const;
  const asserted = value as unknown as string;
  const angle = <number>value;
  const present = value!;
  // @ts-expect-error nested declaration
  function nested(input: Array<any>): any {
    /* @ts-ignore reason */
    return input[0] as any;
  }
  return nested(value);
}
const callback = ((input: any): any => input) as unknown as Function;
"#;
    let analysis = Analysis::inspect("source.ts", source).unwrap();
    let scopes = analysis.json()["scopes"].as_array().unwrap().clone();
    assert_eq!(
        scopes[0]["typeSafety"],
        json!({"explicitAny":3,"typeAssertions":3,
        "doubleAssertions":1,"nonNullAssertions":1,"tsIgnore":1,"tsExpectError":0,"tsNocheck":0})
    );
    assert_eq!(
        scopes[1]["typeSafety"],
        json!({"explicitAny":3,"typeAssertions":1,
        "doubleAssertions":0,"nonNullAssertions":0,"tsIgnore":1,"tsExpectError":1,"tsNocheck":0})
    );
    assert_eq!(scopes[2]["typeSafety"]["explicitAny"], 2);
    assert_eq!(scopes[2]["typeSafety"]["typeAssertions"], 0);
    let file = analysis.type_safety();
    assert_eq!(file["unowned"]["explicitAny"], 1);
    assert_eq!(file["unowned"]["typeAssertions"], 2);
    assert_eq!(file["unowned"]["doubleAssertions"], 1);
    assert_eq!(file["unowned"]["tsNocheck"], 1);
    assert_eq!(file["suppressions"].as_array().unwrap().len(), 4);
    assert_eq!(file["suppressions"][0]["fileLevel"], true);
    assert_eq!(file["suppressions"][0]["owner"], Value::Null);
    let failed_coverage =
        crate::coverage::attribute(&analysis, "source.ts", source, std::iter::empty());
    assert_eq!(
        failed_coverage["functions"][0]["typeSafety"],
        scopes[0]["typeSafety"]
    );
    assert_eq!(failed_coverage["typeSafety"], file);
}

#[test]
fn type_safety_assigns_leading_suppressions_to_initialized_functions_and_methods() {
    let source = r#"function outer() {
  // @ts-ignore
  const inner = (value: number = "wrong"): number => value;
  // @ts-expect-error
  const expression = function expression(value: number = "wrong"): number { return value; };
  const object = {
    // @ts-ignore
    method(value: number = "wrong"): number { return value; },
    // @ts-expect-error
    callback: (value: number = "wrong"): number => value,
  };
}
class Base { method(): number { return 1; } }
class Model extends Base {
  // @ts-ignore
  override method(): string { return "wrong"; }
  // @ts-expect-error
  callback = (value: number = "wrong"): number => value;
}
// @ts-ignore
export const exported = (value: number = "wrong"): number => value;
"#;
    let analysis = Analysis::inspect("source.ts", source).unwrap();
    let findings = analysis.type_safety();
    let suppressions = findings["suppressions"].as_array().unwrap();
    let targets = [
        "const inner = (value",
        "const expression = function expression(value",
        "method(value",
        "callback: (value",
        "override method()",
        "callback = (value",
        "export const exported = (value",
    ];
    assert_eq!(suppressions.len(), targets.len());
    for (suppression, target) in suppressions.iter().zip(targets) {
        let start = source.find(target).unwrap() + target.find('(').unwrap();
        let owner = analysis.owner(start as u32).unwrap();
        assert_eq!(
            suppression["owner"], analysis.scopes[owner].span.start,
            "{suppression}, target {target}"
        );
        let counts = serde_json::to_value(&analysis.scopes[owner].type_safety).unwrap();
        assert_eq!(
            counts[if suppression["kind"] == "@ts-ignore" {
                "tsIgnore"
            } else {
                "tsExpectError"
            }],
            1
        );
    }
    assert_eq!(analysis.json()["scopes"][0]["typeSafety"]["tsIgnore"], 0);
    assert_eq!(
        analysis.json()["scopes"][0]["typeSafety"]["tsExpectError"],
        0
    );
    assert_eq!(findings["unowned"]["tsIgnore"], 0);
    assert_eq!(findings["unowned"]["tsExpectError"], 0);
}

#[test]
fn type_safety_assigns_leading_suppressions_to_default_export_functions() {
    for expression in [
        r#"(value: number = "wrong"): number => value"#,
        r#"((value: number = "wrong"): number => value)"#,
        r#"(((value: number = "wrong"): number => value))"#,
        r#"(function(value: number = "wrong"): number { return value; })"#,
        r#"function declared(value: number = "wrong"): number { return value; }"#,
    ] {
        for (kind, field) in [
            ("@ts-ignore", "tsIgnore"),
            ("@ts-expect-error", "tsExpectError"),
        ] {
            let source = format!("// {kind}\nexport default {expression};");
            let analysis = Analysis::inspect("source.ts", &source).unwrap();
            let findings = analysis.type_safety();
            let scopes = analysis.json()["scopes"].as_array().unwrap().clone();
            assert_eq!(scopes.len(), 1, "{source}");
            assert_eq!(findings["suppressions"].as_array().unwrap().len(), 1);
            assert_eq!(
                findings["suppressions"][0]["owner"], scopes[0]["start"],
                "{source}"
            );
            assert_eq!(findings["suppressions"][0]["fileLevel"], false);
            assert_eq!(scopes[0]["typeSafety"][field], 1, "{source}");
            assert_eq!(findings["unowned"][field], 0, "{source}");
        }
    }
}

#[test]
fn type_safety_nocheck_uses_typescript_pragma_separators() {
    for (suffix, count) in [
        ("", 1),
        (": temporary", 1),
        ("::", 1),
        (" temporary", 1),
        ("\t", 1),
        ("\u{feff}temporary", 1),
        ("er", 0),
        ("!", 0),
        ("-temporary", 0),
        ("/", 0),
        ("\u{0085}temporary", 0),
    ] {
        let source = format!(
            "// @ts-nocheck{suffix}\nfunction f(value: number = \"wrong\") {{ return value; }}"
        );
        let analysis = Analysis::inspect("source.ts", &source).unwrap();
        let findings = analysis.type_safety();
        assert_eq!(
            findings["suppressions"].as_array().unwrap().len(),
            count,
            "{source}"
        );
        assert_eq!(findings["unowned"]["tsNocheck"], count, "{source}");
        assert_eq!(analysis.json()["scopes"][0]["typeSafety"]["tsNocheck"], 0);
        if count != 0 {
            assert_eq!(findings["suppressions"][0]["fileLevel"], true);
            assert_eq!(findings["suppressions"][0]["owner"], Value::Null);
        }
    }
}

#[test]
fn type_safety_directives_use_javascript_whitespace() {
    for (prefix, count) in [
        ("\t", 1),
        ("\u{000b}", 1),
        ("\u{000c}", 1),
        (" ", 1),
        ("\u{00a0}", 1),
        ("\u{1680}", 1),
        ("\u{2000}", 1),
        ("\u{2001}", 1),
        ("\u{2002}", 1),
        ("\u{2003}", 1),
        ("\u{2004}", 1),
        ("\u{2005}", 1),
        ("\u{2006}", 1),
        ("\u{2007}", 1),
        ("\u{2008}", 1),
        ("\u{2009}", 1),
        ("\u{200a}", 1),
        ("\u{202f}", 1),
        ("\u{205f}", 1),
        ("\u{3000}", 1),
        ("\u{feff}", 1),
        ("\u{0085}", 0),
        ("\u{180e}", 0),
        ("\u{200b}", 0),
    ] {
        for comment in [
            format!("// {prefix}@ts-ignore"),
            format!("/// {prefix}@ts-expect-error: reason"),
            format!("/* {prefix}@ts-ignore */"),
            format!("/* explanation\n{prefix}* @ts-expect-error */"),
            format!("// {prefix}@ts-nocheck"),
        ] {
            let source =
                format!("{comment}\nfunction f(value: number = \"wrong\") {{ return value; }}");
            let analysis = Analysis::inspect("source.ts", &source).unwrap();
            assert_eq!(
                analysis.type_safety()["suppressions"]
                    .as_array()
                    .unwrap()
                    .len(),
                count,
                "{comment:?}"
            );
        }
    }
    for comment in [
        "// @ts-ignore!",
        "// @ts-ignorex",
        "// @ts-expect-error:",
        "// @ts-expect-errorx",
    ] {
        let source =
            format!("{comment}\nfunction f(value: number = \"wrong\") {{ return value; }}");
        let analysis = Analysis::inspect("source.ts", &source).unwrap();
        assert_eq!(
            analysis.type_safety()["suppressions"]
                .as_array()
                .unwrap()
                .len(),
            1,
            "{comment}"
        );
    }
}

#[test]
fn type_safety_block_directives_preserve_prefix_order_and_last_line() {
    for (comment, count) in [
        ("/* * @ts-ignore */", 0),
        ("/* / @ts-expect-error */", 0),
        ("/* @ts-ignore */", 1),
        ("/** @ts-expect-error */", 1),
        ("/* explanation\n * @ts-ignore */", 1),
        ("/* explanation\r\n * @ts-expect-error */", 1),
        ("/* @ts-ignore\n */", 0),
    ] {
        let source = format!("function f() {{\n{comment}\nreturn 1;\n}}");
        let analysis = Analysis::inspect("source.ts", &source).unwrap();
        let findings = analysis.type_safety();
        assert_eq!(
            findings["suppressions"].as_array().unwrap().len(),
            count,
            "{comment}"
        );
        let counts = &analysis.json()["scopes"][0]["typeSafety"];
        assert_eq!(
            counts["tsIgnore"].as_u64().unwrap() + counts["tsExpectError"].as_u64().unwrap(),
            count as u64,
            "{comment}"
        );
    }
}

#[test]
fn type_safety_handles_tsx_and_angle_const_assertions() {
    for (path, source) in [
        (
            "source.tsx",
            "// @ts-ignore\nexport default function render(value: any) { return <div>{(value as string)!}</div>; }",
        ),
        (
            "source.ts",
            "// @ts-ignore\nexport default (value: any) => { const literal = <const>[1]; return <string>value!; };",
        ),
    ] {
        let analysis = Analysis::inspect(path, source).unwrap();
        let counts = &analysis.json()["scopes"][0]["typeSafety"];
        assert_eq!(counts["explicitAny"], 1);
        assert_eq!(counts["typeAssertions"], 1);
        assert_eq!(counts["nonNullAssertions"], 1);
        assert_eq!(counts["tsIgnore"], 1);
    }
}

#[test]
fn switched_sources_can_use_run_wide_ids_and_reject_helper_collisions() {
    let source = "export const first = value >= 1;\nexport const second = value < 3;\n";
    let analysis = Analysis::inspect("source.ts", source).unwrap();
    let switched = analysis.switched_with_offset(source, 7).unwrap();
    assert!(switched.contains("__seshat_compare(7"));
    assert!(switched.contains("[7,7,\">\"]"));
    assert!(switched.contains("[9,9,\"<=\"]"));

    let collision = "const __seshat_compare = () => true;\nexport const value = 1 < 2;\n";
    let analysis = Analysis::inspect("source.ts", collision).unwrap();
    assert!(matches!(
        analysis.switched(collision),
        Err(error) if error == "proof helper name collision"
    ));
}
