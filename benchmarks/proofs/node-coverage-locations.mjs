// Exercise each Node collector through real coverage collection and CRAP assessment.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const {values} = parseArgs({options: {
  cli: {type: 'string'},
  dependencies: {type: 'string', default: join(repo, 'examples/node/node_modules')},
}});
assert.ok(values.cli, 'usage: node benchmarks/proofs/node-coverage-locations.mjs --cli PATH [--dependencies DIR]');
const cli = resolve(values.cli);
mkdirSync(join(repo, 'work/assurance-proofs'), {recursive: true});
const work = mkdtempSync(join(repo, 'work/assurance-proofs/node-coverage-locations-'));
try {
  const project = join(work, 'input');
  const scratch = join(work, 'scratch');
  mkdirSync(project);
  mkdirSync(scratch);
  cpSync(realpathSync(values.dependencies), join(project, 'node_modules'), {recursive: true, verbatimSymlinks: true});

  const source = `type Value = number;
export function identity(value: Value): number { return value; }
export function binary(flag: boolean, value: number) {
  return flag && identity(
    value,
  );
}
export function conditional(flag: boolean, value: number) {
  return flag ? identity(
    value,
  ) : identity(
    0,
  );
}
export function outer(flag: boolean) {
  function inner(value: boolean) { return value ? 1 : 0; }
  return inner(flag);
}
export function straight(value: number) {
  const next: number = value + 1;
  return next;
}
`;
  const unloaded = `export function absent(flag: boolean) { return flag ? 1 : 0; }
export function untouched() { return 7; }
`;
  const inputs = {
    'package.json': '{"private":true,"type":"module"}\n',
    'subject.ts': source,
    'unloaded.ts': unloaded,
    'test.mjs': `import assert from 'node:assert/strict';
import {test} from 'node:test';
import {binary, conditional, outer, straight} from './subject.ts';
test('multiline operands and ordinary functions', () => {
  assert.equal(binary(true, 3), 3);
  assert.equal(conditional(true, 4), 4);
  assert.equal(outer(true), 1);
  assert.equal(straight(1), 2);
});
`,
  };
  for (const [path, contents] of Object.entries(inputs)) writeFileSync(join(project, path), contents);
  const sources = join(work, 'sources.json');
  writeFileSync(sources, JSON.stringify(['subject.ts', 'unloaded.ts'].map(path => join(project, path))));

  function run(command, args, options = {}) {
    const child = spawnSync(command, args, {cwd: project, encoding: 'utf8', timeout: 60000,
      maxBuffer: 8 * 1024 * 1024, ...options});
    assert.ifError(child.error);
    return child;
  }

  for (const collector of ['examples/node/collect-node.mjs', 'examples/workspaces/collect-node.mjs',
    'benchmarks/proofs/collect-node.mjs']) {
    const name = collector.split('/')[1];
    // Public adapters resolve dependencies within the captured project; the proof collector is trusted tooling.
    cpSync(join(repo, collector), join(project, 'collect-node.mjs'));
    const command = collector.startsWith('examples/') ? 'collect-node.mjs' : join(repo, collector);
    const coveragePath = join(work, name, 'coverage.json');
    const collected = run(process.execPath, [command, 'test.mjs'], {env: {...process.env,
      SESHAT_SOURCES: sources, SESHAT_COVERAGE_REPORT: coveragePath, SESHAT_NODE_REPORTER: 'tap'}});
    assert.equal(collected.status, 0, collected.stdout + collected.stderr);
    const coverage = JSON.parse(readFileSync(coveragePath, 'utf8'));
    const file = coverage[join(project, 'subject.ts')];
    const invalid = Object.values(file.branchMap).flatMap(branch => branch.locations)
      .filter(location => location.end.column === null);
    console.log(`${name}: null branch ends=${invalid.length}`);
    const config = {source: {include: ['*.ts']},
      capture: ['package.json', 'subject.ts', 'unloaded.ts', 'test.mjs', 'collect-node.mjs', 'node_modules'],
      setups: [{name: 'node', runner: 'node', cwd: '.', timeoutMs: 15000,
        test: [process.execPath, '--test', '--test-reporter={seshatReporter}', 'test.mjs'],
        coverage: {command: [process.execPath, command, 'test.mjs'], report: 'coverage/final.json'}}]};
    writeFileSync(join(project, 'seshat.json'), JSON.stringify(config));
    const assessed = run(cli, ['crap', '--config', 'seshat.json', '--scratch', scratch, '--json', '--no-progress']);
    const report = JSON.parse(assessed.stdout);
    console.log(`${name}: assessment exit=${assessed.status}, complete=${report.complete}`);
    for (const file of report.result.sources ?? []) {
      for (const problem of file.result.problems) console.log(`${file.path}: ${problem}`);
    }
    assert.deepEqual(readdirSync(scratch), [], 'assessment must clean its execution copy');
    for (const [path, contents] of Object.entries(inputs)) {
      assert.equal(readFileSync(join(project, path), 'utf8'), contents, `${name}: changed source ${path}`);
    }
    assert.equal(assessed.status, 0, `${name}: assessment must complete\n${assessed.stderr}`);
    assert.equal(report.complete, true);
    assert.equal(invalid.length, 0);

    const span = (line, column, endLine, endColumn) => ({
      start: {line, column}, end: {line: endLine, column: endColumn},
    });
    const branches = Object.values(file.branchMap);
    assert.deepEqual(branches.find(branch => branch.type === 'binary-expr').locations,
      [span(4, 9, 4, 13), span(4, 17, 6, 3)], `${name}: multiline binary operand`);
    assert.deepEqual(branches.find(branch => branch.type === 'cond-expr').locations,
      [span(9, 16, 11, 3), span(11, 6, 13, 3)], `${name}: both multiline conditional operands`);
    const statements = Object.values(file.statementMap);
    assert.deepEqual(statements.find(location => location.start.line === 4), span(4, 2, 6, 4),
      `${name}: multiline return statement`);
    assert.deepEqual(statements.find(location => location.start.line === 20), span(20, 23, 20, 32),
      `${name}: typed variable initializer`);
    const unloadedCoverage = coverage[join(project, 'unloaded.ts')];
    assert.ok(Object.values(unloadedCoverage.s).every(count => count === 0));
    assert.ok(Object.values(unloadedCoverage.f).every(count => count === 0));
    assert.ok(Object.values(unloadedCoverage.b).flat().every(count => count === 0));

    const rows = report.result.sources.flatMap(file => file.result.functions);
    assert.deepEqual(rows.map(({name, covered, total, branchCovered, branchTotal, coverageBasis, crap}) =>
      [name, covered, total, branchCovered, branchTotal, coverageBasis, crap]), [
      ['identity', 1, 1, 0, 0, 'statement', 1],
      ['binary', 1, 1, 2, 2, 'branch', 2],
      ['conditional', 1, 1, 1, 2, 'branch', 2.5],
      ['outer', 1, 1, 0, 0, 'statement', 1],
      ['inner', 1, 1, 1, 2, 'branch', 2.5],
      ['straight', 2, 2, 0, 0, 'statement', 1],
      ['absent', 0, 1, 0, 2, 'branch', 6],
      ['untouched', 0, 1, 0, 0, 'statement', 2],
    ], `${name}: measured coverage, nested attribution and CRAP`);
  }
  console.log('All Node collectors preserve multiline branch locations and source bytes.');
} finally {
  rmSync(work, {recursive: true, force: true});
}
