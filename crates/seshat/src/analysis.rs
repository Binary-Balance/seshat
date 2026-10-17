// Bounded experiment, not a production analyser.
use oxc_allocator::{Allocator, Vec as ArenaVec};
use oxc_ast::{
    AstKind,
    ast::{
        AccessorPropertyType, ArrowFunctionBody, Declaration, ExportDefaultDeclarationKind,
        Expression, FormalParameters, FunctionType, JSXAttributeItem, JSXAttributeValue, JSXChild,
        MethodDefinitionKind, PropertyDefinitionType, PropertyKind, Statement, TSType, TSTypeName,
        VariableDeclarationKind,
    },
};
use oxc_ast_visit::{Visit, walk};
use oxc_parser::Parser;
use oxc_span::{GetSpan, SourceType, Span};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

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

// JavaScript whitespace differs from Rust's Unicode set.
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
    pub cognitive_complexity: u32,
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

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MutationOperator {
    Comparison,
    Logical,
    Arithmetic,
    Boolean,
}

pub fn default_mutation_operators() -> Vec<MutationOperator> {
    vec![
        MutationOperator::Comparison,
        MutationOperator::Logical,
        MutationOperator::Arithmetic,
        MutationOperator::Boolean,
    ]
}

enum OperatorExpression {
    Binary { left: Span, right: Span },
    BooleanLiteral,
    LogicalNot,
}

pub struct OperatorSite {
    pub kind: MutationOperator,
    pub span: Span,
    expression: OperatorExpression,
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
    pub operators: Vec<OperatorSite>,
    non_runtime: Vec<Span>,
    expression_statements: BTreeSet<u32>,
    switching_reference_sites: BTreeSet<u32>,
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
    cognitive_owner: Option<usize>,
    cognitive_depth: u32,
    cognitive_stack: Vec<(Option<usize>, u32)>,
    cognitive_parameter_decorators: BTreeMap<u32, (Option<usize>, u32)>,
    cognitive_initializers: Vec<(Span, usize)>,
    cognitive_bodies: BTreeSet<(u32, u32)>,
    else_ifs: BTreeSet<u32>,
    logical_children: BTreeSet<u32>,
    lexical_scopes: Vec<Span>,
    bindings: BTreeMap<String, usize>,
    functions: Vec<(String, Span, Span)>,
    calls: Vec<(usize, String, Span)>,
    write_ranges: Vec<Span>,
    writes: BTreeSet<String>,
    dynamic_bindings: bool,
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
    fn visit_statements(&mut self, statements: &ArenaVec<'a, Statement<'a>>) {
        for statement in statements {
            if let Statement::ExpressionStatement(statement) = statement {
                self.expression_statements.insert(statement.span.start);
            }
        }
        walk::walk_statements(self, statements);
    }

    fn visit_expression(&mut self, expression: &Expression<'a>) {
        let boolean = match expression {
            Expression::BooleanLiteral(literal) => Some((
                OperatorExpression::BooleanLiteral,
                if literal.value { "true" } else { "false" },
                if literal.value {
                    &["false"][..]
                } else {
                    &["true"][..]
                },
            )),
            Expression::UnaryExpression(unary) if unary.operator.as_str() == "!" => {
                Some((OperatorExpression::LogicalNot, "!", &[""][..]))
            }
            _ => None,
        };
        if let Some((shape, original, replacements)) = boolean {
            self.operators.push(OperatorSite {
                kind: MutationOperator::Boolean,
                span: expression.span(),
                expression: shape,
                offset: expression.span().start as usize,
                original,
                replacements,
                first_id: 0,
            });
        }
        walk::walk_expression(self, expression);
    }

    fn visit_ts_type(&mut self, annotation: &TSType<'a>) {
        self.non_runtime.push(annotation.span());
        walk::walk_ts_type(self, annotation);
    }

    fn enter_node(&mut self, node: AstKind<'a>) {
        self.cognitive_stack
            .push((self.cognitive_owner, self.cognitive_depth));
        let span = node.span();
        let declaration_only = match node {
            AstKind::VariableDeclaration(declaration) => declaration.declare,
            AstKind::Class(class) => class.declare,
            AstKind::Function(function) => function.body.is_none(),
            AstKind::PropertyDefinition(property) => {
                property.declare
                    || property.r#type == PropertyDefinitionType::TSAbstractPropertyDefinition
            }
            AstKind::AccessorProperty(property) => {
                property.r#type == AccessorPropertyType::TSAbstractAccessorProperty
            }
            AstKind::MethodDefinition(method) => method.value.body.is_none(),
            AstKind::TSEnumDeclaration(declaration) => declaration.declare,
            AstKind::TSNamespaceDeclaration(declaration) => declaration.declare,
            AstKind::TSExternalModuleDeclaration(_)
            | AstKind::TSGlobalDeclaration(_)
            | AstKind::TSInterfaceDeclaration(_)
            | AstKind::TSTypeAliasDeclaration(_) => true,
            _ => false,
        };
        if declaration_only {
            self.non_runtime.push(span);
        }
        let reference_context = match node {
            AstKind::CallExpression(call) => Some(&call.callee),
            AstKind::TaggedTemplateExpression(template) => Some(&template.tag),
            AstKind::UnaryExpression(unary)
                if matches!(unary.operator.as_str(), "delete" | "typeof") =>
            {
                Some(&unary.argument)
            }
            _ => None,
        };
        if let Some(expression) = reference_context
            && let Expression::UnaryExpression(unary) = expression.get_inner_expression()
            && unary.operator.as_str() == "!"
        {
            let argument = unary.argument.get_inner_expression();
            if argument.is_identifier_reference()
                || argument.is_member_expression()
                || matches!(argument, Expression::ChainExpression(_))
            {
                self.switching_reference_sites.insert(unary.span.start);
            }
        }
        if let AstKind::Decorator(decorator) = node
            && let Some(context) = self
                .cognitive_parameter_decorators
                .remove(&decorator.span.start)
        {
            (self.cognitive_owner, self.cognitive_depth) = context;
        }
        if self
            .cognitive_initializers
            .last()
            .is_some_and(|(initializer, _)| *initializer == span)
        {
            self.cognitive_owner = Some(self.cognitive_initializers.pop().unwrap().1);
            self.cognitive_depth = 0;
        }
        if self.cognitive_bodies.remove(&(span.start, span.end)) {
            self.cognitive_depth += 1;
        }
        match node {
            AstKind::BindingIdentifier(id) => {
                *self.bindings.entry(id.name.to_string()).or_default() += 1;
            }
            AstKind::Function(f) if f.body.is_some() => {
                // Parameter decorators execute when the enclosing scope defines the class.
                for decorator in f
                    .params
                    .items
                    .iter()
                    .flat_map(|p| &p.decorators)
                    .chain(f.params.rest.iter().flat_map(|p| &p.decorators))
                {
                    self.cognitive_parameter_decorators.insert(
                        decorator.span.start,
                        (self.cognitive_owner, self.cognitive_depth),
                    );
                }
                if let Some(id) = &f.id {
                    let visibility = if f.r#type == FunctionType::FunctionDeclaration {
                        *self.lexical_scopes.last().unwrap()
                    } else {
                        f.span
                    };
                    self.functions
                        .push((id.name.to_string(), f.span, visibility));
                }
            }
            AstKind::VariableDeclaration(declaration)
                if declaration.kind == VariableDeclarationKind::Const =>
            {
                for binding in &declaration.declarations {
                    if let Some(id) = binding.id.get_binding_identifier()
                        && let Some(init) = &binding.init
                        && matches!(
                            init.without_parentheses(),
                            Expression::FunctionExpression(_)
                                | Expression::ArrowFunctionExpression(_)
                        )
                    {
                        self.functions.push((
                            id.name.to_string(),
                            init.without_parentheses().span(),
                            *self.lexical_scopes.last().unwrap(),
                        ));
                    }
                }
            }
            AstKind::AssignmentExpression(a) => self.write_ranges.push(a.left.span()),
            AstKind::UpdateExpression(a) => self.write_ranges.push(a.argument.span()),
            AstKind::ForInStatement(a) => self.write_ranges.push(a.left.span()),
            AstKind::ForOfStatement(a) => self.write_ranges.push(a.left.span()),
            AstKind::IdentifierReference(id)
                if self
                    .write_ranges
                    .iter()
                    .any(|range| range.start <= span.start && span.end <= range.end) =>
            {
                self.writes.insert(id.name.to_string());
            }
            AstKind::CallExpression(call) => {
                if let Expression::Identifier(id) = call.callee.without_parentheses() {
                    self.dynamic_bindings |= id.name == "eval";
                    if let Some(owner) = self.cognitive_owner {
                        self.calls.push((owner, id.name.to_string(), call.span));
                    }
                }
            }
            AstKind::WithStatement(_) => self.dynamic_bindings = true,
            _ => {}
        }
        if lexical_boundary(node) {
            // Case bindings are not visible while evaluating the discriminant.
            let visibility = match node {
                AstKind::SwitchStatement(statement) => {
                    Span::new(statement.discriminant.span().end, span.end)
                }
                _ => span,
            };
            self.lexical_scopes.push(visibility);
        }
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
            AstKind::AccessorProperty(property) => {
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
        let field = match node {
            AstKind::PropertyDefinition(p) => p.value.as_ref().map(|value| (p.span, value)),
            AstKind::AccessorProperty(p) => p.value.as_ref().map(|value| (p.span, value)),
            _ => None,
        };
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
                cognitive_complexity: 0,
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
                cognitive_complexity: 0,
                implicit: false,
                type_safety: TypeSafety::default(),
                empty: matches!(&f.body, ArrowFunctionBody::FunctionBody(b) if b.statements.is_empty() && b.directives.is_empty())
                    && plain_parameters(&f.params),
                extreme_skip: matches!(&f.body, ArrowFunctionBody::FunctionBody(b) if b.statements.is_empty() && b.directives.is_empty()).then_some("empty"),
                returns_value: !matches!(f.body, ArrowFunctionBody::FunctionBody(_))
                    && !self.void_functions.contains(&f.span.start)
                    && !f.body.as_expression().is_some_and(|expression| matches!(expression.without_parentheses(), Expression::UnaryExpression(unary) if unary.operator.as_str() == "void")),
            }),
            AstKind::StaticBlock(b) => Some(Scope {
                name: format!("static@{}", b.span.start),
                span: b.span,
                body: b.span,
                complexity: 1,
                cognitive_complexity: 0,
                implicit: true,
                type_safety: TypeSafety::default(),
                empty: false,
                extreme_skip: Some("implicit-scope"),
                returns_value: false,
            }),
            _ => field.map(|(span, value)| Scope {
                name: format!("field@{}", span.start),
                span: value.span(),
                body: value.span(),
                complexity: 1,
                cognitive_complexity: 0,
                implicit: true,
                type_safety: TypeSafety::default(),
                empty: false,
                extreme_skip: Some("implicit-scope"),
                returns_value: false,
            }),
        };
        if let Some(scope) = scope {
            if field.is_some() {
                // Computed keys and decorators execute in the enclosing scope.
                self.cognitive_initializers
                    .push((scope.span, self.scopes.len()));
            } else {
                self.cognitive_owner = Some(self.scopes.len());
                self.cognitive_depth = 0;
            }
            self.scopes.push(scope);
        }
        self.cognitive_node(node);
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
        let (span, left, right, original) = match node {
            AstKind::BinaryExpression(b) => {
                (b.span, b.left.span(), b.right.span(), b.operator.as_str())
            }
            AstKind::LogicalExpression(b) => {
                (b.span, b.left.span(), b.right.span(), b.operator.as_str())
            }
            _ => return,
        };
        let replacements: &'static [&'static str] = match original {
            "<" => &["<=", ">="],
            "<=" => &["<", ">"],
            ">" => &[">=", "<="],
            ">=" => &[">", "<"],
            "==" => &["!="],
            "!=" => &["=="],
            "===" => &["!=="],
            "!==" => &["==="],
            "&&" => &["||"],
            "||" => &["&&"],
            "+" => &["-"],
            "-" => &["+"],
            "*" => &["/"],
            "/" => &["*"],
            _ => return,
        };
        self.operators.push(OperatorSite {
            kind: match original {
                "&&" | "||" => MutationOperator::Logical,
                "+" | "-" | "*" | "/" => MutationOperator::Arithmetic,
                _ => MutationOperator::Comparison,
            },
            span,
            expression: OperatorExpression::Binary { left, right },
            offset: 0,
            original,
            replacements,
            first_id: 0,
        });
    }

    fn leave_node(&mut self, node: AstKind<'a>) {
        if lexical_boundary(node) {
            self.lexical_scopes.pop();
        }
        (self.cognitive_owner, self.cognitive_depth) = self.cognitive_stack.pop().unwrap();
    }
}

fn lexical_boundary(node: AstKind<'_>) -> bool {
    matches!(
        node,
        AstKind::Program(_)
            | AstKind::BlockStatement(_)
            | AstKind::StaticBlock(_)
            | AstKind::FunctionBody(_)
            | AstKind::ForStatement(_)
            | AstKind::ForInStatement(_)
            | AstKind::ForOfStatement(_)
            | AstKind::CatchClause(_)
            | AstKind::SwitchStatement(_)
            | AstKind::Class(_)
            | AstKind::TSModuleBlock(_)
    )
}

pub fn supports_line_positions(source: &str) -> bool {
    !source.contains(['\u{2028}', '\u{2029}']) && !source.replace("\r\n", "").contains('\r')
}

#[test]
fn cognitive_complexity_follows_flow_and_nesting_rules() {
    for (body, expected) in [
        ("return value;", 0),
        ("if(a) return 1; if(b) return 2;", 2),
        ("if(a) { if(b) { if(c) return 1; } }", 6),
        ("if(a) {} else if(b) {} else if(c) {} else {}", 4),
        (
            "if(a) { if(b) {} else if(c) { if(d) {} } else { if(e) {} } }",
            11,
        ),
        ("if(a) {} else { if(b) {} }", 4),
        ("for(;;) { while(a) { do {} while(b); } }", 6),
        ("for(const item in value) {} for(const item of value) {}", 2),
        (
            "try { if(a) {} } catch(error) { if(b) {} } finally { if(c) {} }",
            5,
        ),
        ("try { return value; } finally {}", 0),
        (
            "switch(value) { case 1: break; case 2: break; default: return 0; }",
            1,
        ),
        (
            "if(a) { switch(value) { case 1: if(b) {} break; default: break; } }",
            6,
        ),
        ("return a ? b : c;", 1),
        ("return a ? (b ? c : d) : (e ? f : g);", 5),
        ("return a && b && c && d;", 1),
        ("return a || b || c || d;", 1),
        ("return a && b || c || d && e;", 3),
        ("return a && (b || c) && d;", 3),
        ("return a && !(b && c);", 2),
        ("return call(a && b, c && d);", 2),
        ("if(a && b || c) {}", 3),
        ("value &&= a; value ||= b; value ??= c;", 2),
        ("return a?.b?.(c) ?? d;", 0),
        ("return a ?? (b && c);", 1),
        ("return a && (b ?? (c && d));", 2),
        ("outer: for(;;) { if(a) continue outer; break outer; }", 5),
        ("for(;;) { if(a) break; continue; } throw error;", 3),
        ("return <div>{a && b}{a ? b : c}</div>;", 2),
    ] {
        let source = format!("function f() {{{body}}}");
        let analysis = Analysis::inspect("fixture.tsx", &source).unwrap();
        assert_eq!(analysis.scopes[0].cognitive_complexity, expected, "{body}");
    }
}

#[test]
fn cognitive_complexity_owns_nested_functions_separately() {
    let source = "function outer(a = value ?? 1) { if(a) { const inner = () => { if(a) return 1; }; function nested() { while(a) {} } } } class C { field = value ? 1 : 2; static { if(value) {} } method() { if(value) {} } }";
    let analysis = Analysis::inspect("fixture.ts", source).unwrap();
    assert_eq!(
        analysis
            .scopes
            .iter()
            .map(|scope| scope.cognitive_complexity)
            .collect::<Vec<_>>(),
        [1, 1, 1, 1, 1, 1]
    );
    assert_eq!(
        analysis.scopes[0].complexity, 4,
        "cyclomatic defaults/nullish still count"
    );
    let unmeasured = crate::coverage::attribute(
        &analysis,
        "fixture.ts",
        source,
        std::iter::empty::<&Value>(),
    );
    assert_eq!(unmeasured["functions"][0]["status"], "unknown");
    assert_eq!(unmeasured["functions"][0]["cognitiveComplexity"], 1);
}

#[test]
fn cognitive_class_keys_stay_in_the_enclosing_scope() {
    for (source, expected) in [
        (
            "function outer() { class C { [a ? b : c] = value; } }",
            vec![1, 0],
        ),
        (
            "function outer() { class C { static [a ? b : c] = value; } }",
            vec![1, 0],
        ),
        (
            "function outer() { if(a) { class C { [a ? b : c] = a ? b : c; } } }",
            vec![3, 1],
        ),
        (
            "function outer() { class C { @decorate(a ? b : c) field = a ? b : c; } }",
            vec![1, 1],
        ),
        (
            "function outer() { class C { [(function key() { if(a) return b; return c; })()] = a ? b : c; } }",
            vec![0, 1, 1],
        ),
        (
            "function outer() { class C { [a ? b : c]() { if(a) work(); } } }",
            vec![1, 1],
        ),
        (
            "function outer() { class C { field = class D { [a ? b : c] = a ? b : c; }; } }",
            vec![0, 1, 1],
        ),
        (
            "function outer() { class C { static { if(a) work(); } } }",
            vec![0, 1],
        ),
        (
            "function outer() { class C { [outer()] = value; } }",
            vec![1, 0],
        ),
    ] {
        let analysis = Analysis::inspect("fixture.ts", source).unwrap();
        assert_eq!(
            analysis
                .scopes
                .iter()
                .map(|scope| scope.cognitive_complexity)
                .collect::<Vec<_>>(),
            expected,
            "{source}"
        );
    }
}

#[test]
fn cognitive_accessors_use_implicit_initializer_scopes() {
    for (source, expected) in [
        (
            "function outer(flag: boolean) { if(flag) { class C { accessor field = flag ? 1 : 2; } } }",
            vec![(1, false), (1, true)],
        ),
        (
            "class C { accessor field = flag ? 1 : 2; }",
            vec![(1, true)],
        ),
        (
            "function outer() { if(a) { class C { static accessor #field = a ? b : c; } } }",
            vec![(1, false), (1, true)],
        ),
        (
            "function outer() { if(a) { class C { @decorate(a ? b : c) accessor [a ? b : c] = a ? b : c; } } }",
            vec![(5, false), (1, true)],
        ),
        (
            "function outer() { if(a) { class C { @decorate(a ? b : c) accessor [a ? b : c]: number; } } if(a) work(); }",
            vec![(6, false)],
        ),
        (
            "function outer() { if(a) { class C { accessor field = (value: any) => { if(a) work(); }; } } if(a) work(); }",
            vec![(2, false), (0, true), (1, false)],
        ),
        (
            "function outer() { class C { accessor field = (() => { if(a) { class D { method(@decorate(a ? b : c) value = a ? b : c) { if(a) work(); } } } return a ? b : c; })() || fallback; } }",
            vec![(0, false), (1, true), (4, false), (2, false)],
        ),
        (
            "function outer() { class C { accessor [outer()] = outer(); } }",
            vec![(1, false), (0, true)],
        ),
        (
            "class C {\n// @ts-ignore\naccessor field = (value: any) => value; }",
            vec![(0, true), (0, false)],
        ),
        (
            "function outer() { if(a) { class C { accessor first = a ? b : c; field = a ? b : c; accessor second = a ? b : c; method() { if(a) work(); } } } }",
            vec![(1, false), (1, true), (1, true), (1, true), (1, false)],
        ),
    ] {
        let analysis = Analysis::inspect("fixture.ts", source).unwrap();
        assert_eq!(
            analysis
                .scopes
                .iter()
                .map(|scope| (scope.cognitive_complexity, scope.implicit))
                .collect::<Vec<_>>(),
            expected,
            "{source}"
        );
        let ordinary = Analysis::inspect("fixture.ts", &source.replace("accessor ", "")).unwrap();
        assert_eq!(
            analysis
                .scopes
                .iter()
                .map(|scope| json!([scope.complexity, scope.type_safety]))
                .collect::<Vec<_>>(),
            ordinary
                .scopes
                .iter()
                .map(|scope| json!([scope.complexity, scope.type_safety]))
                .collect::<Vec<_>>(),
            "{source}"
        );
        let unmeasured = crate::coverage::attribute(
            &analysis,
            "fixture.ts",
            source,
            std::iter::empty::<&Value>(),
        );
        for (scope, row) in analysis
            .scopes
            .iter()
            .zip(unmeasured["functions"].as_array().unwrap())
        {
            if scope.implicit {
                assert_eq!(row["status"], "complexity-only", "{source}");
                assert_eq!(row["crap"], Value::Null, "{source}");
            }
        }
    }
}

#[test]
fn cognitive_parameter_decorators_stay_in_the_enclosing_scope() {
    for (source, expected) in [
        (
            "function outer(flag: boolean) { if(flag) { class C { method(@decorate(flag ? 'yes' : 'no') value: number) { return value; } } } }",
            vec![3, 0],
        ),
        (
            "function outer(flag: boolean) { if(flag) { class C { constructor(@decorate(flag ? 'yes' : 'no') value: number) { void value; } } } }",
            vec![3, 0],
        ),
        (
            "function outer() { if(a) { class C { method(@decorate(a ? b : c) ...values: number[]) {} } } }",
            vec![3, 0],
        ),
        (
            "function outer() { while(a) { if(b) { class C { method(@decorate(a ? b : c) value) {} } } } }",
            vec![6, 0],
        ),
        (
            "function outer() { if(a) { class C { method(@decorate(a ? b : c) value = a ? b : c) { if(a) work(); } } } if(a) work(); }",
            vec![4, 2],
        ),
        (
            "function outer() { if(a) { class C { constructor(@decorate(a ? b : c) public value = a ? b : c) { if(a) work(); } } } if(a) work(); }",
            vec![4, 2],
        ),
        (
            "function outer() { class C { field = (() => { if(a) { class D { method(@decorate(a ? b : c) value = a ? b : c) { if(a) work(); } } } return a ? b : c; })() || fallback; } }",
            vec![0, 1, 4, 2],
        ),
        (
            "function outer() { if(a) { class C { method(@decorate(() => { if(a) work(); }) value = a ? b : c) { if(a) work(); } } } }",
            vec![1, 2, 1],
        ),
        (
            "function outer() { class C { method(@decorate(outer()) value) {} constructor(@decorate(outer()) value) {} } }",
            vec![1, 0, 0],
        ),
        (
            "class C { method(@decorate(a ? b : c) value = a ? b : c) { if(a) work(); } }",
            vec![2],
        ),
    ] {
        let analysis = Analysis::inspect("fixture.ts", source).unwrap();
        assert_eq!(
            analysis
                .scopes
                .iter()
                .map(|scope| scope.cognitive_complexity)
                .collect::<Vec<_>>(),
            expected,
            "{source}"
        );
    }
}

#[test]
fn cognitive_recursion_respects_lexical_boundaries() {
    for (source, expected) in [
        (
            "class C { static { const Number = () => String(); Number(); } static { const String = () => Number(); String(); } }",
            vec![0, 0, 0, 0],
        ),
        (
            "class C { static { function Number() { return String(); } Number(); } static { function String() { return Number(); } String(); } }",
            vec![0, 0, 0, 0],
        ),
        (
            "class C { static { const first = () => second(); const second = () => first(); } }",
            vec![0, 1, 1],
        ),
        (
            "function outer() { outer(); class C { static { const inner = () => inner(); } } }",
            vec![1, 0, 1],
        ),
        (
            "function first() { second(); } function second() { first(); } class C { static { const inner = () => first(); } }",
            vec![1, 1, 0, 0],
        ),
        (
            "function Boolean() { switch(Symbol()) { default: const Symbol = () => Boolean(); } return 'ok'; }",
            vec![1, 0],
        ),
        (
            "function outer(value) { switch(value) { case 0: const first = () => second(); break; default: const second = () => first(); } }",
            vec![1, 1, 1],
        ),
        (
            "function Boolean() { for(let index = Number(); index < 1; index++) { const Number = () => Boolean(); } return true; }",
            vec![1, 0],
        ),
        (
            "function Boolean() { for(const item in {[Symbol()]: 0}) { const Symbol = () => Boolean(); } return true; }",
            vec![1, 0],
        ),
        (
            "function Boolean() { for(const item of [Symbol()]) { const Symbol = () => Boolean(); } return true; }",
            vec![1, 0],
        ),
        (
            "function outer() { for(;;) { const first = () => second(); const second = () => first(); } }",
            vec![1, 1, 1],
        ),
        (
            "function Boolean() { try { Number(); } catch(error) { const Number = () => Boolean(); } return true; }",
            vec![1, 0],
        ),
        (
            "function outer() { try {} catch(error) { const first = () => second(); const second = () => first(); } }",
            vec![1, 1, 1],
        ),
    ] {
        let analysis = Analysis::inspect("fixture.ts", source).unwrap();
        assert_eq!(
            analysis
                .scopes
                .iter()
                .map(|scope| scope.cognitive_complexity)
                .collect::<Vec<_>>(),
            expected,
            "{source}"
        );
    }
}

#[test]
fn cognitive_recursion_requires_unambiguous_visible_bindings() {
    for (source, expected) in [
        ("function f() { f(); f(); }", vec![1]),
        ("function f() { g(); } function g() { f(); }", vec![1, 1]),
        ("const f = () => f();", vec![1]),
        ("const f = function named() { named(); };", vec![1]),
        (
            "function outer() { function f() { g(); } function g() { f(); } }",
            vec![0, 1, 1],
        ),
        ("function f(f) { f(); }", vec![0]),
        ("function f() { const f = external; f(); }", vec![0]),
        ("function f() { f(); } f = external;", vec![0]),
        ("function f() { f(); } ({f} = external);", vec![0]),
        ("function f() { f(); } for(f of external) {}", vec![0]),
        ("function f(n) { n--; f(n); }", vec![1]),
        ("function f() { this.f(); }", vec![0]),
        ("function f() { const alias = f; alias(); }", vec![0]),
        ("let f = () => f();", vec![0]),
        (
            "const f = function g() { f(); }; function h() { g(); }",
            vec![1, 0],
        ),
        (
            "{ function f() { g(); } } function g() { f(); }",
            vec![0, 0],
        ),
        (
            "function f() { f(); } function g() { eval('f = external'); }",
            vec![0, 0],
        ),
    ] {
        let analysis = Analysis::inspect("fixture.ts", source).unwrap();
        assert_eq!(
            analysis
                .scopes
                .iter()
                .map(|scope| scope.cognitive_complexity)
                .collect::<Vec<_>>(),
            expected,
            "{source}"
        );
    }
}

impl Analysis {
    fn cognitive_node(&mut self, node: AstKind<'_>) {
        let Some(owner) = self.cognitive_owner else {
            return;
        };
        let mut increment = 0;
        let mut bodies = Vec::new();
        match node {
            AstKind::IfStatement(statement) => {
                increment = if self.else_ifs.remove(&statement.span.start) {
                    1
                } else {
                    1 + self.cognitive_depth
                };
                bodies.push(statement.consequent.span());
                if let Some(alternate) = &statement.alternate {
                    if let Statement::IfStatement(next) = alternate {
                        self.else_ifs.insert(next.span.start);
                    } else {
                        increment += 1;
                        bodies.push(alternate.span());
                    }
                }
            }
            AstKind::ForStatement(statement) => bodies.push(statement.body.span()),
            AstKind::ForInStatement(statement) => bodies.push(statement.body.span()),
            AstKind::ForOfStatement(statement) => bodies.push(statement.body.span()),
            AstKind::WhileStatement(statement) => bodies.push(statement.body.span()),
            AstKind::DoWhileStatement(statement) => bodies.push(statement.body.span()),
            AstKind::CatchClause(clause) => bodies.push(clause.body.span),
            AstKind::SwitchStatement(statement) => {
                increment = 1 + self.cognitive_depth;
                bodies.extend(statement.cases.iter().map(GetSpan::span));
            }
            AstKind::ConditionalExpression(expression) => {
                bodies.extend([expression.consequent.span(), expression.alternate.span()]);
            }
            AstKind::BreakStatement(statement) if statement.label.is_some() => increment = 1,
            AstKind::ContinueStatement(statement) if statement.label.is_some() => increment = 1,
            AstKind::AssignmentExpression(expression)
                if matches!(expression.operator.as_str(), "&&=" | "||=") =>
            {
                increment = 1
            }
            AstKind::LogicalExpression(expression)
                if expression.operator.as_str() != "??"
                    && !self.logical_children.contains(&expression.span.start) =>
            {
                fn operators(
                    expression: &Expression<'_>,
                    result: &mut Vec<&'static str>,
                    children: &mut BTreeSet<u32>,
                ) {
                    if let Expression::LogicalExpression(expression) =
                        expression.without_parentheses()
                        && expression.operator.as_str() != "??"
                    {
                        children.insert(expression.span.start);
                        operators(&expression.left, result, children);
                        result.push(expression.operator.as_str());
                        operators(&expression.right, result, children);
                    }
                }
                let mut sequence = Vec::new();
                operators(&expression.left, &mut sequence, &mut self.logical_children);
                sequence.push(expression.operator.as_str());
                operators(&expression.right, &mut sequence, &mut self.logical_children);
                increment = 1 + sequence
                    .windows(2)
                    .filter(|pair| pair[0] != pair[1])
                    .count() as u32;
            }
            _ => {}
        }
        if increment == 0 && !bodies.is_empty() {
            increment = 1 + self.cognitive_depth;
        }
        self.scopes[owner].cognitive_complexity += increment;
        self.cognitive_bodies
            .extend(bodies.into_iter().map(|body| (body.start, body.end)));
    }

    fn cognitive_recursion(&mut self) {
        if self.dynamic_bindings {
            return;
        }
        // Syntax alone cannot resolve aliases or shadowing. Only unique, unwritten bindings qualify.
        let functions: BTreeMap<_, _> = self
            .functions
            .iter()
            .filter(|(name, _, _)| {
                self.bindings.get(name) == Some(&1) && !self.writes.contains(name)
            })
            .filter_map(|(name, target, visibility)| {
                self.scopes
                    .iter()
                    .position(|scope| !scope.implicit && scope.span == *target)
                    .map(|index| (name.as_str(), (index, *visibility)))
            })
            .collect();
        let mut edges = vec![BTreeSet::new(); self.scopes.len()];
        for (caller, name, span) in &self.calls {
            if let Some((callee, visibility)) = functions.get(name.as_str())
                && visibility.start <= span.start
                && span.end <= visibility.end
            {
                edges[*caller].insert(*callee);
            }
        }
        // shortcut: reachability per function, use strongly connected components if call graphs grow large.
        for start in 0..edges.len() {
            if edges[start].is_empty() {
                continue;
            }
            let mut pending: Vec<_> = edges[start].iter().copied().collect();
            let mut seen = BTreeSet::new();
            while let Some(next) = pending.pop() {
                if next == start {
                    self.scopes[start].cognitive_complexity += 1;
                    break;
                }
                if seen.insert(next) {
                    pending.extend(edges[next].iter().copied());
                }
            }
        }
    }

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
        Self::inspect_with_operators(path, source, &default_mutation_operators())
    }

    pub fn inspect_with_operators(
        path: &str,
        source: &str,
        enabled: &[MutationOperator],
    ) -> Result<Self, String> {
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
        result.cognitive_recursion();
        result.branch_end_ranges.sort_by_key(|range| range.start);
        let decisions = std::mem::take(&mut result.decisions);
        for span in decisions {
            if let Some(i) = result.owner(span.start) {
                result.scopes[i].complexity += 1;
            }
        }
        result.operators.retain(|site| {
            enabled.contains(&site.kind)
                && (site.kind != MutationOperator::Boolean
                    || (!source_type.is_typescript_definition()
                        && !result.non_runtime.iter().any(|range| {
                            range.start <= site.span.start && site.span.end <= range.end
                        })))
        });
        result
            .operators
            .sort_by_key(|c| (c.span.start, std::cmp::Reverse(c.span.end)));
        let mut id = 0;
        for c in &mut result.operators {
            let mut offset = c.offset;
            if let OperatorExpression::Binary { left, right } = c.expression {
                offset = left.end as usize;
                loop {
                    let gap = &source[offset..right.start as usize];
                    let trimmed = gap.trim_start_matches(javascript_whitespace);
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
        self.operators.iter().map(|c| c.replacements.len()).sum()
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

    fn statement_separator(&self, site: u32, rendered_start: u32) -> &'static str {
        // Parentheses must not join preceding statements or split recursive operands.
        if site > rendered_start && self.expression_statements.contains(&site) {
            ";"
        } else {
            ""
        }
    }

    pub fn replace(&self, source: &str, id: usize) -> Result<String, String> {
        for c in &self.operators {
            if let Some(op) = id
                .checked_sub(c.first_id)
                .and_then(|i| c.replacements.get(i))
            {
                if let OperatorExpression::LogicalNot = c.expression {
                    // Parentheses preserve the operand's grouping without converting its value.
                    return Ok(format!(
                        "{}{}({}){}",
                        &source[..c.offset],
                        self.statement_separator(c.span.start, 0),
                        &source[c.offset + 1..c.span.end as usize],
                        &source[c.span.end as usize..]
                    ));
                }
                if let OperatorExpression::BooleanLiteral = c.expression {
                    return Ok(format!(
                        "{}{op}{}",
                        &source[..c.offset],
                        &source[c.offset + c.original.len()..]
                    ));
                }
                if c.kind == MutationOperator::Logical
                    && let OperatorExpression::Binary { left, right } = c.expression
                {
                    // Keep the AST's operand grouping when &&/|| precedence changes.
                    return Ok(format!(
                        "{}{}(({}){}{}{}({})){}",
                        &source[..c.span.start as usize],
                        self.statement_separator(c.span.start, 0),
                        &source[c.span.start as usize..left.end as usize],
                        &source[left.end as usize..c.offset],
                        op,
                        &source[c.offset + c.original.len()..right.start as usize],
                        &source[right.start as usize..c.span.end as usize],
                        &source[c.span.end as usize..]
                    ));
                }
                // Separate tokens, including TypeScript's postfix ! before equality operators.
                let prefix = &source[..c.offset];
                let suffix = &source[c.offset + c.original.len()..];
                let before = if prefix.ends_with(javascript_whitespace) {
                    ""
                } else {
                    " "
                };
                let after = if suffix.starts_with(javascript_whitespace) {
                    ""
                } else {
                    " "
                };
                return Ok(format!("{prefix}{before}{op}{after}{suffix}"));
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
        // Conditional arms produce values, so they cannot expose an operand's reference.
        if self.operators.iter().any(|site| {
            site.kind == MutationOperator::Boolean
                && self.switching_reference_sites.contains(&site.span.start)
        }) {
            return Err("experimental switching cannot remove ! in call/tag targets or delete/typeof operands that expose references; use source replacement".into());
        }
        fn render(
            a: &Analysis,
            source: &str,
            start: u32,
            end: u32,
            id_offset: usize,
        ) -> Result<String, String> {
            let mut out = String::new();
            let mut cursor = start;
            for c in &a.operators {
                if c.span.start < cursor || c.span.end > end {
                    continue;
                }
                out.push_str(&source[cursor as usize..c.span.start as usize]);
                if c.kind == MutationOperator::Logical
                    || matches!(
                        c.expression,
                        OperatorExpression::BooleanLiteral | OperatorExpression::LogicalNot
                    )
                {
                    out.push_str(a.statement_separator(c.span.start, start));
                }
                match c.expression {
                    OperatorExpression::BooleanLiteral => {
                        out.push_str(&format!(
                            "(__seshat_active === {} ? {} : {})",
                            c.first_id + id_offset,
                            c.replacements[0],
                            c.original
                        ));
                    }
                    OperatorExpression::LogicalNot => {
                        let argument = render(a, source, c.span.start + 1, c.span.end, id_offset)?;
                        out.push_str(&format!(
                            "(__seshat_active === {} ? ({argument}) : !({argument}))",
                            c.first_id + id_offset
                        ));
                    }
                    OperatorExpression::Binary { left, right } => {
                        let left = render(a, source, left.start, left.end, id_offset)?;
                        let right = render(a, source, right.start, right.end, id_offset)?;
                        if c.kind == MutationOperator::Logical {
                            // Inline arms preserve short-circuiting, await/yield and direct eval scope.
                            out.push_str(&format!("(__seshat_active === {} ? (({left}) {} ({right})) : (({left}) {} ({right})))",
                        c.first_id + id_offset, c.replacements[0], c.original));
                        } else {
                            out.push_str(&format!(
                                "__seshat_compare({}, ({left}), ({right}), {:?})",
                                c.first_id + id_offset,
                                c.original
                            ));
                        }
                    }
                }
                // Nested inline arms duplicate text; fail explicitly before growth is unbounded.
                if out.len() > 8 * 1024 * 1024 {
                    return Err(
                        "experimental switching source exceeds 8 MiB; use source replacement"
                            .into(),
                    );
                }
                cursor = c.span.end;
            }
            out.push_str(&source[cursor as usize..end as usize]);
            if out.len() > 8 * 1024 * 1024 {
                return Err(
                    "experimental switching source exceeds 8 MiB; use source replacement".into(),
                );
            }
            Ok(out)
        }
        let mut alternatives = vec![Value::Null; id_offset];
        alternatives.extend(self.operators.iter().flat_map(|c| {
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
        let helper = "function __seshat_compare(site: number, a: any, b: any, op: string) {\n  const alternative = __seshat_alternatives[__seshat_active];\n  if (alternative && alternative[1] === site) op = alternative[2] as string;\n  switch(op) { case '<': return a < b; case '<=': return a <= b; case '>': return a > b; case '>=': return a >= b; case '==': return a == b; case '!=': return a != b; case '===': return a === b; case '!==': return a !== b; case '+': return a + b; case '-': return a - b; case '*': return a * b; case '/': return a / b; default: throw Error('unknown operator'); }\n}\n";
        Ok(source[..start as usize].to_owned()
            + &prefix
            + helper
            + &render(self, source, start, source.len() as u32, id_offset)?)
    }

    pub fn json(&self) -> Value {
        json!({"scopes": self.scopes.iter().map(|s| json!({"name":s.name,"start":s.span.start,"end":s.span.end,"complexity":s.complexity,"cognitiveComplexity":s.cognitive_complexity,"implicit":s.implicit,"empty":s.empty,"typeSafety":s.type_safety})).collect::<Vec<_>>(),
            "typeSafety":self.type_safety(),
            "mutants": self.operators.iter().flat_map(|c| c.replacements.iter().enumerate().map(move |(i, op)| json!({"id":c.first_id+i,"kind":c.kind,"offset":c.offset,"original":c.original,"replacement":op}))).collect::<Vec<_>>()})
    }
}

#[test]
fn boolean_mutants_follow_runtime_expressions_and_selected_families() {
    let source = "// true false !\nconst text = 'true false !'; type Flag = true | false; interface Flags { yes: true; false: false; } declare const fixed = true; declare namespace Ambient { const fixed = false; } declare class Declared { readonly yes = true; } const obj = {true: false, false: true}; function f(value: unknown) { return [true, false, !!value, value!]; }";
    let analysis = Analysis::inspect("source.ts", source).unwrap();
    let definitions = analysis.json();
    let rows = definitions["mutants"].as_array().unwrap();
    assert_eq!(rows.len(), 6);
    assert_eq!(
        rows.iter()
            .map(|row| (
                row["original"].as_str().unwrap(),
                row["replacement"].as_str().unwrap()
            ))
            .collect::<Vec<_>>(),
        [
            ("false", "true"),
            ("true", "false"),
            ("true", "false"),
            ("false", "true"),
            ("!", ""),
            ("!", "")
        ]
    );
    for (id, row) in rows.iter().enumerate() {
        assert_eq!(row["id"], id);
        assert_eq!(row["kind"], "boolean");
        let offset = row["offset"].as_u64().unwrap() as usize;
        assert!(source[offset..].starts_with(row["original"].as_str().unwrap()));
        let mutant = analysis.replace(source, id).unwrap();
        assert_ne!(mutant, source);
        Analysis::inspect("mutant.ts", &mutant).unwrap();
    }
    assert_eq!(
        Analysis::inspect("source.ts", source).unwrap().json(),
        definitions
    );
    assert_eq!(
        Analysis::inspect_with_operators("source.ts", source, &[MutationOperator::Boolean])
            .unwrap()
            .json(),
        definitions
    );
    assert_eq!(
        Analysis::inspect_with_operators(
            "source.ts",
            source,
            &[
                MutationOperator::Comparison,
                MutationOperator::Logical,
                MutationOperator::Arithmetic
            ]
        )
        .unwrap()
        .count(),
        0
    );
    for path in ["source.d.ts", "source.d.mts", "source.d.cts"] {
        assert_eq!(
            Analysis::inspect(path, "declare const fixed = true;")
                .unwrap()
                .count(),
            0
        );
    }
    let jsx = "const element = <div ready={true}>{false}{!value!}true false !</div>;";
    assert_eq!(Analysis::inspect("source.tsx", jsx).unwrap().count(), 3);
    let computed = "const obj = {[true as any]: false};";
    assert_eq!(Analysis::inspect("source.ts", computed).unwrap().count(), 2);
    for source in [
        "interface Flag { [!true]: false; }",
        "type Flag = { [!true]: false };",
        "class C { declare [!true]: boolean; }",
        "abstract class C { abstract [!true]: boolean; }",
        "abstract class C { abstract accessor [!true]: boolean; }",
        "abstract class C { abstract [!true](): boolean; }",
    ] {
        assert_eq!(
            Analysis::inspect("source.ts", source).unwrap().count(),
            0,
            "{source}"
        );
    }
}

#[test]
fn boolean_replacements_preserve_grouping_trivia_and_exactly_one_site() {
    for (source, expected) in [
        ("true;", "false;"),
        ("false.toString();", "true.toString();"),
        ("const value=!input;", "const value=(input);"),
        ("!!value;", "(!value);"),
        ("!(left && right);", "((left && right));"),
        ("!/* 🎸 ! */value!;", "(/* 🎸 ! */value!);"),
        ("!// ! retained\nvalue;", "(// ! retained\nvalue);"),
        (
            "function f(){return!value;}",
            "function f(){return(value);}",
        ),
        (
            "async function f(){return !await value;}",
            "async function f(){return (await value);}",
        ),
        (
            "function* f(){return !(yield value);}",
            "function* f(){return ((yield value));}",
        ),
        ("!eval('value');", "(eval('value'));"),
        ("!object.method();", "(object.method());"),
    ] {
        let analysis = Analysis::inspect("source.ts", source).unwrap();
        let mutant = analysis.replace(source, 0).unwrap();
        assert_eq!(mutant, expected, "{source}");
        Analysis::inspect("mutant.ts", &mutant).unwrap();
    }
    let nested = "!!value;";
    assert_eq!(
        Analysis::inspect("source.ts", nested)
            .unwrap()
            .replace(nested, 1)
            .unwrap(),
        "!(value);"
    );
}

#[test]
fn operator_rendering_preserves_statement_boundaries() {
    for (source, expected) in [
        ("a.x = 1\n!a.y;", "a.x = 1\n;(a.y);"),
        ("a.x = 1\nx && y;", "a.x = 1\n;((x) || (y));"),
        ("if (ready) !value;", "if (ready) (value);"),
        ("label: !value;", "label: (value);"),
        ("do !value; while (ready);", "do (value); while (ready);"),
    ] {
        let analysis = Analysis::inspect("source.ts", source).unwrap();
        assert_eq!(analysis.replace(source, 0).unwrap(), expected, "{source}");
    }
    for source in ["a.x = 1\n!a.y;", "a.x = 1\ntrue;", "a.x = 1\n!x && y;"] {
        let switched = Analysis::inspect("source.ts", source)
            .unwrap()
            .switched(source)
            .unwrap();
        assert!(
            switched.contains("a.x = 1\n;(__seshat_active"),
            "{switched}"
        );
        Analysis::inspect("switched.ts", &switched).unwrap();
    }
}

#[test]
fn boolean_switching_uses_inline_arms_and_global_ids() {
    for (path, source) in [
        ("source.ts", "!!true;"),
        (
            "source.tsx",
            "const element = <div ready={!true}>{false}</div>;",
        ),
        (
            "source.ts",
            "async function f(){return !await value;} function* g(){return !(yield value);}",
        ),
    ] {
        let analysis = Analysis::inspect(path, source).unwrap();
        let switched = analysis.switched_with_offset(source, 7).unwrap();
        assert!(switched.contains("__seshat_active === 7 ?"));
        assert!(!switched.contains("Boolean("));
        Analysis::inspect(path, &switched).unwrap();
    }
    let switched = Analysis::inspect("source.ts", "!!true;")
        .unwrap()
        .switched_with_offset("!!true;", 7)
        .unwrap();
    assert!(switched.contains("__seshat_active === 8 ?"));
    assert!(switched.contains("__seshat_active === 9 ? false : true"));
    let mixed = Analysis::inspect("source.ts", "!true && false;")
        .unwrap()
        .json();
    assert_eq!(
        mixed["mutants"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row["original"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["&&", "!", "true", "false"]
    );
    let nested = format!("{}value;", "!".repeat(25));
    assert!(
        Analysis::inspect("source.ts", &nested)
            .unwrap()
            .switched(&nested)
            .unwrap_err()
            .contains("exceeds 8 MiB")
    );
}

#[test]
fn switching_rejects_negation_removal_that_exposes_references() {
    for source in [
        "(!object.method)();",
        "(!object.method)?.();",
        "(!object?.method)();",
        "((!object.method) as any)();",
        "((!object.method) satisfies any)();",
        "(<any>!object.method)();",
        "((!object.method)<unknown>)();",
        "(!object.method)!();",
        "(!object.method)`tag`;",
        "(!eval)('value');",
        "delete (!object.field);",
        "typeof (!unbound);",
    ] {
        let analysis = Analysis::inspect("source.ts", source).unwrap();
        assert!(analysis.replace(source, 0).is_ok());
        assert!(
            analysis
                .switched(source)
                .unwrap_err()
                .contains("expose references"),
            "{source}"
        );
        let binary_only =
            Analysis::inspect_with_operators("source.ts", source, &[MutationOperator::Comparison])
                .unwrap();
        assert!(binary_only.switched(source).is_ok());
    }
    for source in [
        "!object.method();",
        "!eval('value');",
        "typeof (!call());",
        "delete (!call());",
    ] {
        assert!(
            Analysis::inspect("source.ts", source)
                .unwrap()
                .switched(source)
                .is_ok()
        );
    }
}

#[test]
fn operator_mutants_follow_ast_sites_and_selected_families() {
    let source = "// 🎸 && + ignored\nconst text = '|| /'; function f(a: number, b: number) { return [a && b, a || b, a + b, a - b, a * b, a / b, a < b, a ?? b, +a]; }";
    let analysis = Analysis::inspect("source.ts", source).unwrap();
    let definitions = analysis.json();
    let rows = definitions["mutants"].as_array().unwrap();
    assert_eq!(rows.len(), 8);
    assert_eq!(
        rows.iter()
            .map(|r| (
                r["original"].as_str().unwrap(),
                r["replacement"].as_str().unwrap()
            ))
            .collect::<Vec<_>>(),
        vec![
            ("&&", "||"),
            ("||", "&&"),
            ("+", "-"),
            ("-", "+"),
            ("*", "/"),
            ("/", "*"),
            ("<", "<="),
            ("<", ">=")
        ]
    );
    for (id, row) in rows.iter().enumerate() {
        assert_eq!(row["id"], id);
        let offset = row["offset"].as_u64().unwrap() as usize;
        assert!(source[offset..].starts_with(row["original"].as_str().unwrap()));
        Analysis::inspect("mutant.ts", &analysis.replace(source, id).unwrap()).unwrap();
    }
    let logical =
        Analysis::inspect_with_operators("source.ts", source, &[MutationOperator::Logical])
            .unwrap();
    assert_eq!(logical.count(), 2);
    assert_eq!(logical.json()["mutants"][1]["id"], 1);
    assert_eq!(
        Analysis::inspect_with_operators("source.ts", source, &[])
            .unwrap()
            .count(),
        0
    );
    let chain = "a && b && c;";
    let analysis = Analysis::inspect("source.ts", chain).unwrap();
    assert_eq!(analysis.replace(chain, 1).unwrap(), "((a) || (b)) && c;");
    let trivia = "a /* 🎸 && */ \u{feff}\u{2028}&& // || ignored\n b;";
    let analysis = Analysis::inspect("source.ts", trivia).unwrap();
    assert!(
        analysis
            .replace(trivia, 0)
            .unwrap()
            .contains("\u{2028}|| // || ignored")
    );
}

#[test]
fn operator_replacements_preserve_token_boundaries() {
    for (source, expected) in [
        ("a+-b;", "a - -b;"),
        ("a-+b;", "a + +b;"),
        ("a*/*comment*/b;", "a / /*comment*/b;"),
        ("8*/xx/.source.length;", "8 / /xx/.source.length;"),
        ("a/-b;", "a * -b;"),
        ("a+// comment\nb;", "a - // comment\nb;"),
        ("a!!=b;", "a! == b;"),
        ("a!!==b;", "a! === b;"),
        ("a != b;", "a == b;"),
    ] {
        let analysis = Analysis::inspect("source.ts", source).unwrap();
        let mutant = analysis.replace(source, 0).unwrap();
        assert_eq!(mutant, expected);
        Analysis::inspect("mutant.ts", &mutant).unwrap();
    }
}

#[test]
fn logical_switching_bounds_nested_expansion() {
    let source = format!("{}true;", "true && ".repeat(30));
    let analysis = Analysis::inspect("source.ts", &source).unwrap();
    assert!(
        analysis
            .switched(&source)
            .unwrap_err()
            .contains("exceeds 8 MiB")
    );
    assert!(analysis.replace(&source, 0).is_ok());
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
