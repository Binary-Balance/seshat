import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import type tsTypes from 'typescript';

type Result = { functions: number[][]; comparisons: [number, string][] };
const [engine, manifest, mode = 'analyze', repeatArg = '1', roundsArg = '1', warmupArg = '0'] = process.argv.slice(2);
const ts = engine === 'typescript' ? (await import('typescript')).default : undefined;
const oxc = engine === 'oxc' ? await import('oxc-parser') : undefined;
if (!ts && !oxc) throw new Error('Expected typescript or oxc');
const paths: string[] = JSON.parse(readFileSync(manifest, 'utf8'));
const sources = paths.map(path => ({ path, source: readFileSync(path, 'utf8') }));
const comparisonOps = new Set(['<', '<=', '>', '>=', '==', '!=', '===', '!==']);
const replacements = { '<': '<=', '<=': '<', '>': '>=', '>=': '>', '==': '!=', '!=': '==', '===': '!==', '!==': '===' };

function analyze(path: string, source: string, parseOnly = false): Result {
  const result: Result = { functions: [], comparisons: [] };
  const stack: number[] = [];
  // Canonical byte offsets let the two parser representations be compared exactly.
  let bytes: Uint32Array;
  function prepareOffsets() {
    bytes = new Uint32Array(source.length + 1);
    let byte = 0;
    for (let i = 0; i < source.length;) {
      const point = source.codePointAt(i)!;
      const width = point > 0xffff ? 2 : 1;
      bytes[i] = byte;
      byte += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
      i += width;
      bytes[i] = byte;
    }
  }
  function enter(start: number, end: number) {
    stack.push(result.functions.length);
    result.functions.push([bytes[start], bytes[end], 1, 0]);
  }
  function decision() { if (stack.length) result.functions[stack.at(-1)!][2]++; }
  if (ts) {
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, false);
    const diagnostics = (file as tsTypes.SourceFile & { parseDiagnostics: tsTypes.Diagnostic[] }).parseDiagnostics;
    if (diagnostics.length) throw new Error(`Parse failed: ${path}`);
    if (parseOnly) return result;
    prepareOffsets();
    const decisions = new Set([ts.SyntaxKind.IfStatement, ts.SyntaxKind.ForStatement,
      ts.SyntaxKind.ForInStatement, ts.SyntaxKind.ForOfStatement, ts.SyntaxKind.WhileStatement,
      ts.SyntaxKind.DoStatement, ts.SyntaxKind.CatchClause, ts.SyntaxKind.CaseClause,
      ts.SyntaxKind.ConditionalExpression]);
    const logical = new Set([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandEqualsToken,
      ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken]);
    function visit(node: tsTypes.Node) {
      const body = ts!.isFunctionLike(node) && 'body' in node ? node.body as tsTypes.Node | undefined : undefined;
      if (body) enter(body.getStart(file), body.end);
      if (decisions.has(node.kind)) decision();
      if (ts!.isBinaryExpression(node)) {
        if (logical.has(node.operatorToken.kind)) decision();
        const op = node.operatorToken.getText(file);
        if (comparisonOps.has(op)) result.comparisons.push([bytes[node.operatorToken.getStart(file)], op]);
      }
      ts!.forEachChild(node, visit);
      if (body) stack.pop();
    }
    visit(file);
  } else {
    const parsed = oxc!.parseSync(path, source, { sourceType: 'module' });
    if (parsed.errors.length) throw new Error(`Parse failed: ${path}`);
    const program = parsed.program;
    if (parseOnly) return result;
    prepareOffsets();
    const decisions = new Set(['IfStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement',
      'WhileStatement', 'DoWhileStatement', 'CatchClause', 'ConditionalExpression', 'LogicalExpression']);
    // The parser owns this discriminated AST; visitorKeys avoids walking metadata.
    function visit(node: any) {
      const body = ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type) ? node.body : null;
      if (body) enter(body.start, body.end);
      if (decisions.has(node.type) || node.type === 'SwitchCase' && node.test !== null ||
          node.type === 'AssignmentExpression' && ['&&=', '||=', '??='].includes(node.operator)) decision();
      if (node.type === 'BinaryExpression' && comparisonOps.has(node.operator)) {
        const gap = source.slice(node.left.end, node.right.start);
        const trivia = /^(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*)*/.exec(gap)![0].length;
        const start = node.left.end + trivia;
        if (!source.startsWith(node.operator, start)) throw new Error('Operator location mismatch');
        result.comparisons.push([bytes[start], node.operator]);
      }
      for (const key of oxc!.visitorKeys[node.type] ?? []) {
        const child = node[key];
        if (Array.isArray(child)) { for (const item of child) if (item) visit(item); }
        else if (child) visit(child);
      }
      if (body) stack.pop();
    }
    visit(program);
  }
  for (const row of result.functions) row[3] = row[2] * row[2] * 0.125 + row[2];
  result.functions.sort((a,b) => a[0] - b[0]);
  result.comparisons.sort((a,b) => a[0] - b[0]);
  return result;
}

if (mode === 'mutate') {
  const {path, source} = sources[0];
  const testPath = paths[1];
  const target = process.env.SESHAT_MUTANT_TARGET!;
  const run = () => spawnSync(process.execPath, ['--test', '--test-reporter=tap', testPath], { timeout: 10000, encoding: 'utf8' });
  writeFileSync(target, source);
  const baseline = run();
  if (baseline.status !== 0) throw new Error(`Baseline failed: ${baseline.stdout}\n${baseline.stderr}`);
  const start = performance.now();
  const outcomes = analyze(path, source).comparisons.map(([offset, operator]) => {
    const buffer = Buffer.from(source);
    const replacement = replacements[operator as keyof typeof replacements];
    writeFileSync(target, Buffer.concat([buffer.subarray(0, offset), Buffer.from(replacement), buffer.subarray(offset + operator.length)]));
    const test = run();
    if (test.error || test.signal || test.status !== 0 && !test.stdout.includes('ERR_ASSERTION')) throw new Error('Mutant execution error');
    return [offset, operator, test.status === 0 ? 'survived' : 'killed'];
  });
  console.log(JSON.stringify({outcomes, executionMs: performance.now() - start, maxRssKb: process.resourceUsage().maxRSS}));
} else if (mode === 'dump') {
  console.log(JSON.stringify(sources.map(({path, source}) => analyze(path, source))));
} else {
  const times: number[] = [];
  let checksum = 0;
  for (let round = -Number(warmupArg); round < Number(roundsArg); round++) {
    checksum = 0;
    const start = performance.now();
    for (let repeat = 0; repeat < Number(repeatArg); repeat++) {
      for (const {path, source} of sources) {
        const result = analyze(path, source, mode === 'parse');
        checksum += result.functions.length + result.comparisons.length;
      }
    }
    if (round >= 0) times.push(performance.now() - start);
  }
  console.log(JSON.stringify({times, checksum, maxRssKb: process.resourceUsage().maxRSS}));
}
