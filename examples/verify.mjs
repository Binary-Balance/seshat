import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const {values} = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: false,
  options: {
    cli: {type: 'string'},
    output: {type: 'string'},
  },
});
assert.ok(values.cli, 'usage: node examples/verify.mjs --cli /absolute/path/to/seshat [--output PATH]');

const cli = resolve(values.cli);
assert.ok(statSync(cli).isFile(), `Seshat executable is missing: ${cli}`);
const cliHash = createHash('sha256').update(readFileSync(cli)).digest('hex');
if (process.env.SESHAT_EXPECTED_BINARY_SHA256) {
  assert.equal(cliHash, process.env.SESHAT_EXPECTED_BINARY_SHA256);
}
const npm = process.env.npm_execpath
  ? [process.execPath, process.env.npm_execpath]
  : [process.platform === 'win32' ? 'npm.cmd' : 'npm'];

const examples = {
  node: ['src/rules.ts', 'src/ignored.ts'],
  'jest-expo': ['src/status.tsx'],
  vitest: ['src/tempo.ts', 'src/view.tsx', 'src/server.ts', 'src/ignored.ts'],
  workspaces: ['src/compare.ts', 'packages/rules/index.ts'],
};
const work = mkdtempSync(join(tmpdir(), 'seshat-public-examples-'));
const scratch = join(work, 'scratch');
mkdirSync(scratch);
const results = {
  schemaVersion: 1,
  node: process.version,
  cli: {sha256: cliHash, bytes: statSync(cli).size},
  examples: {},
};

function run(command, args, cwd, expectedStatus = 0, timeout = 600000) {
  const child = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: {...process.env, npm_config_update_notifier: 'false'},
    maxBuffer: 32 * 1024 * 1024,
    timeout,
  });
  assert.ifError(child.error);
  assert.equal(child.status, expectedStatus, `${command} ${args.join(' ')}\n${child.stdout}\n${child.stderr}`);
  return child;
}

function install(project) {
  run(npm[0], [
    ...npm.slice(1),
    'ci',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
  ], project, 0, 600000);
}

function copyExample(name, project) {
  cpSync(join(here, name), project, {
    recursive: true,
    filter: path => basename(path) !== 'node_modules',
  });
}

function sourceSnapshot(name, project) {
  return Object.fromEntries(examples[name].map(path => [path, readFileSync(join(project, path), 'utf8')]));
}

function assertUnchanged(name, project, original) {
  for (const [path, source] of Object.entries(original)) {
    assert.equal(readFileSync(join(project, path), 'utf8'), source, `${name}: source changed: ${path}`);
  }
  assert.deepEqual(readdirSync(scratch), [], `${name}: Seshat scratch was not cleaned`);
  if (name === 'workspaces') {
    const link = join(project, 'node_modules/@seshat/example-rules');
    assert.ok(existsSync(link), 'workspaces: npm link disappeared');
    assert.ok(lstatSync(link).isSymbolicLink(), 'workspaces: npm did not create a link');
    assert.equal(readlinkSync(link), '../../packages/rules');
  }
}

function runCheck(name, project, configName, expectedStatus = 0) {
  const child = run(cli, [
    'check',
    '--config',
    configName,
    '--scratch',
    scratch,
    '--json',
    '--no-progress',
  ], project, expectedStatus);
  const report = JSON.parse(child.stdout);
  assert.equal(report.schemaVersion, 1, `${name}: unexpected report schema`);
  assert.equal(report.command, 'check', `${name}: unexpected report command`);
  return report;
}

function stable(report) {
  const result = report.result;
  const sources = (result.sources ?? []).map(source => ({
    path: source.path,
    functions: (source.result?.functions ?? []).map(functionResult => ({
      name: functionResult.name,
      complexity: functionResult.complexity,
      coverage: functionResult.coverage,
      covered: functionResult.covered,
      total: functionResult.total,
      crap: functionResult.crap,
      status: functionResult.status,
    })),
  }));
  const mutation = result.mutation;
  return {
    complete: report.complete,
    scope: report.scope?.files,
    sources,
    mutation: mutation && {
      planned: mutation.planned,
      killed: mutation.killed,
      survived: mutation.survived,
      unresolved: mutation.unresolved,
      score: mutation.score,
      outcomes: mutation.outcomes.map(({id, path, localId, offset, original, replacement, verdict}) =>
        ({id, path, localId, offset, original, replacement, verdict})),
    },
  };
}

function portable(value) {
  return JSON.parse(JSON.stringify(value).replaceAll(work, '<work>'));
}

let passed = false;
let error;
try {
  for (const [name, sourcePaths] of Object.entries(examples)) {
    const project = join(work, name);
    copyExample(name, project);
    install(project);
    const original = sourceSnapshot(name, project);
    const normal = runCheck(name, project, 'seshat.json');
    assert.equal(normal.complete, true, `${name}: normal check was incomplete`);
    assert.equal(normal.quality.state, 'not-configured');
    assertUnchanged(name, project, original);

    const parallelConfig = JSON.parse(readFileSync(join(project, 'seshat.json'), 'utf8'));
    parallelConfig.workers = 2;
    writeFileSync(join(project, 'seshat-workers2.json'), JSON.stringify(parallelConfig, null, 2) + '\n');
    const parallel = runCheck(name, project, 'seshat-workers2.json');
    assert.equal(parallel.complete, true, `${name}: workers=2 check was incomplete`);
    assert.deepEqual(stable(parallel), stable(normal), `${name}: workers=1/2 results differ`);
    assertUnchanged(name, project, original);

    results.examples[name] = {
      sourceFiles: sourcePaths,
      normal: portable(normal),
      workers: {
        one: normal.result.mutation?.workersUsed ?? 1,
        two: parallel.result.mutation?.workersUsed ?? 1,
        parity: true,
      },
    };

    if (name !== 'node') continue;
    const base = JSON.parse(readFileSync(join(project, 'seshat.json'), 'utf8'));
    const functions = normal.result.sources.flatMap(source => source.result?.functions ?? [])
      .filter(functionResult => Number.isFinite(functionResult.crap));
    const maxCrap = Math.max(...functions.map(functionResult => functionResult.crap));
    const score = normal.result.mutation.score;
    assert.ok(Number.isFinite(maxCrap) && Number.isFinite(score), 'node: no measured thresholds');

    const equality = {...base, thresholds: {maxCrap, minMutationScore: score}};
    writeFileSync(join(project, 'seshat-equality.json'), JSON.stringify(equality, null, 2) + '\n');
    const equalityReport = runCheck(name, project, 'seshat-equality.json');
    assert.equal(equalityReport.complete, true);
    assert.equal(equalityReport.quality.state, 'passed');
    assert.ok(equalityReport.quality.checks.every(check => check.state === 'passed'));
    assertUnchanged(name, project, original);

    const failure = {...base, thresholds: {maxCrap: maxCrap - 0.001, minMutationScore: score}};
    writeFileSync(join(project, 'seshat-failure.json'), JSON.stringify(failure, null, 2) + '\n');
    const failureReport = runCheck(name, project, 'seshat-failure.json', 1);
    assert.equal(failureReport.complete, true);
    assert.equal(failureReport.quality.state, 'failed');
    assert.equal(failureReport.result.mutation.score, score);
    assertUnchanged(name, project, original);

    const incomplete = structuredClone(base);
    incomplete.setups[0].test = [process.execPath, '-e', 'process.exit(1)'];
    writeFileSync(join(project, 'seshat-incomplete.json'), JSON.stringify(incomplete, null, 2) + '\n');
    const incompleteReport = runCheck(name, project, 'seshat-incomplete.json', 2);
    assert.equal(incompleteReport.complete, false);
    assert.equal(incompleteReport.quality.state, 'incomplete');
    assertUnchanged(name, project, original);
    results.thresholds = {
      equality: equalityReport.quality,
      failure: failureReport.quality,
      incomplete: incompleteReport.quality,
    };
  }
  passed = true;
} catch (caught) {
  error = String(caught);
  throw caught;
} finally {
  const output = values.output && resolve(values.output);
  if (output) {
    mkdirSync(dirname(output), {recursive: true});
    writeFileSync(output, JSON.stringify({
      ...results,
      validation: {passed, error: error ?? null},
    }, null, 2) + '\n');
  }
  rmSync(work, {recursive: true, force: true});
}

console.log(`Verified ${Object.keys(examples).length} consumer examples with ${cliHash}; workers 1/2 agree, sources survive, and Node threshold/incomplete exits pass.`);
