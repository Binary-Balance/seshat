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
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, dirname, extname, join, resolve} from 'node:path';
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
const cliExtension = extname(cli).toLowerCase();
assert.ok(!['.bat', '.cmd'].includes(cliExtension),
  'pass a native executable or Node launcher; the Windows npm .cmd shim is a separate release check');
const cliIsNodeLauncher = ['.cjs', '.js', '.mjs'].includes(cliExtension);
const cliKind = cliIsNodeLauncher ? 'node-launcher' : 'native-executable';
const cliCommand = cliIsNodeLauncher ? [process.execPath, cli] : [cli];
const cliHash = createHash('sha256').update(readFileSync(cli)).digest('hex');
if (process.env.SESHAT_EXPECTED_BINARY_SHA256) {
  assert.equal(cliKind, 'native-executable', 'SESHAT_EXPECTED_BINARY_SHA256 requires a native executable');
  assert.equal(cliHash, process.env.SESHAT_EXPECTED_BINARY_SHA256);
}
const npm = process.env.npm_execpath
  ? [process.execPath, process.env.npm_execpath]
  : process.platform === 'win32'
    // npm.cmd is a command script and cannot be spawned without a shell.
    ? [process.execPath, join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')]
    : ['npm'];
if (process.platform === 'win32') assert.ok(existsSync(npm[1]), `npm CLI is missing: ${npm[1]}`);

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
  cli: {kind: cliKind, sha256: cliHash, bytes: statSync(cli).size},
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

function workspaceLinkSnapshot(project) {
  const link = join(project, 'node_modules/@seshat/example-rules');
  return {raw: readlinkSync(link), resolved: realpathSync(link)};
}

function assertUnchanged(name, project, original, originalLink) {
  for (const [path, source] of Object.entries(original)) {
    assert.equal(readFileSync(join(project, path), 'utf8'), source, `${name}: source changed: ${path}`);
  }
  assert.deepEqual(readdirSync(scratch), [], `${name}: Seshat scratch was not cleaned`);
  if (name === 'workspaces') {
    const link = join(project, 'node_modules/@seshat/example-rules');
    assert.ok(existsSync(link), 'workspaces: npm link disappeared');
    assert.ok(lstatSync(link).isSymbolicLink(), 'workspaces: npm did not create a link');
    assert.equal(readlinkSync(link), originalLink.raw, 'workspaces: npm link target representation changed');
    assert.equal(realpathSync(link), originalLink.resolved, 'workspaces: npm link destination changed');
    assert.equal(realpathSync(link), realpathSync(join(project, 'packages/rules')),
      'workspaces: npm link does not resolve to the workspace package');
  }
}

function normalizedPath(path) {
  return path.replaceAll('\\', '/');
}

function runCheck(name, project, configName, expectedStatus = 0) {
  const child = run(cliCommand[0], [
    ...cliCommand.slice(1),
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

const expected = {
  node: {
    scope: ['src/rules.ts'],
    functions: {
      'src/rules.ts': [
        {name: 'classify', covered: 3, total: 3, crap: 2},
        {name: 'arrow@139', covered: 1, total: 1, crap: 1},
      ],
    },
    mutation: {planned: 4, killed: 3, survived: 1, unresolved: 0, score: 75},
  },
  'jest-expo': {
    scope: ['src/status.tsx'],
    functions: {
      'src/status.tsx': [
        {name: 'classify', covered: 3, total: 3, crap: 2},
        {name: 'isPositive', covered: 1, total: 1, crap: 1},
        {name: 'statusCard', covered: 1, total: 1, crap: 1},
      ],
    },
    mutation: {planned: 4, killed: 3, survived: 1, unresolved: 0, score: 75},
  },
  vitest: {
    scope: ['src/server.ts', 'src/tempo.ts', 'src/view.tsx'],
    functions: {
      'src/server.ts': [
        {name: 'createApp', covered: 3, total: 3, crap: 1},
        {name: 'arrow@358', covered: 1, total: 1, crap: 1},
      ],
      'src/tempo.ts': [
        {name: 'tempoLabel', covered: 5, total: 5, crap: 3},
      ],
      'src/view.tsx': [
        {name: 'Tempo', covered: 1, total: 1, crap: 1},
      ],
    },
    mutation: {planned: 4, killed: 4, survived: 0, unresolved: 0, score: 100},
  },
  workspaces: {
    scope: ['packages/rules/index.ts', 'src/compare.ts'],
    functions: {
      'packages/rules/index.ts': [
        {name: 'arrow@22', covered: 1, total: 1, crap: 1},
      ],
      'src/compare.ts': [
        {name: 'arrow@68', covered: 1, total: 1, crap: 1},
        {name: 'workspaceAnswer', covered: 1, total: 1, crap: 1},
      ],
    },
    mutation: {planned: 2, killed: 2, survived: 0, unresolved: 0, score: 100},
  },
};

function assertExpected(name, report, workers) {
  const fixture = expected[name];
  const scope = (report.scope?.files ?? []).map(normalizedPath);
  assert.deepEqual(scope, fixture.scope, `${name}: resolved source scope differs`);

  const sources = report.result?.sources ?? [];
  assert.deepEqual(sources.map(source => normalizedPath(source.path)), fixture.scope,
    `${name}: source assessments differ from resolved scope`);
  for (const [path, functions] of Object.entries(fixture.functions)) {
    const source = sources.find(candidate => normalizedPath(candidate.path) === path);
    assert.ok(source, `${name}: missing source assessment: ${path}`);
    const actual = source.result?.functions ?? [];
    assert.deepEqual(actual.map(functionResult => functionResult.name), functions.map(functionResult => functionResult.name),
      `${name}: function assessments differ: ${path}`);
    for (const [index, fixtureFunction] of functions.entries()) {
      const functionResult = actual[index];
      assert.equal(functionResult.coverage, 1, `${name}: function is not fully covered: ${path}/${fixtureFunction.name}`);
      assert.equal(functionResult.covered, fixtureFunction.covered, `${name}: covered count changed: ${path}/${fixtureFunction.name}`);
      assert.equal(functionResult.total, fixtureFunction.total, `${name}: total count changed: ${path}/${fixtureFunction.name}`);
      assert.equal(functionResult.crap, fixtureFunction.crap, `${name}: CRAP changed: ${path}/${fixtureFunction.name}`);
      assert.equal(functionResult.status, 'measured', `${name}: function is not measured: ${path}/${fixtureFunction.name}`);
    }
  }

  const mutation = report.result?.mutation;
  assert.ok(mutation, `${name}: mutation assessment is missing`);
  for (const [field, value] of Object.entries(fixture.mutation)) {
    assert.equal(mutation[field], value, `${name}: mutation ${field} differs`);
  }
  assert.equal(mutation.completed, mutation.planned, `${name}: mutation completion count differs`);
  assert.equal(mutation.outcomes?.length, mutation.planned, `${name}: mutation outcome count differs`);
  assert.equal(mutation.workersRequested, workers, `${name}: requested worker count differs`);
  assert.equal(mutation.workersUsed, workers, `${name}: effective worker count differs`);
  assert.equal(mutation.outcomes.filter(outcome => outcome.verdict === 'killed').length, mutation.killed,
    `${name}: killed outcome count differs`);
  assert.equal(mutation.outcomes.filter(outcome => outcome.verdict === 'survived').length, mutation.survived,
    `${name}: survived outcome count differs`);
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

function portable(value, root = work) {
  const normalizedRoot = normalizedPath(root);
  if (typeof value === 'string') {
    return value.replaceAll(root, '<work>').replaceAll(normalizedRoot, '<work>');
  }
  if (Array.isArray(value)) return value.map(entry => portable(entry, root));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) =>
      [portable(key, root), portable(entry, root)]));
  }
  return value;
}

const windowsWork = 'C:\\Users\\Gaelian\\AppData\\Local\\Temp\\seshat-public-examples';
assert.deepEqual(portable({
  raw: `${windowsWork}\\node\\report.json`,
  slash: `${normalizedPath(windowsWork)}/node/report.json`,
}, windowsWork), {
  raw: '<work>\\node\\report.json',
  slash: '<work>/node/report.json',
});

let passed = false;
let error;
try {
  for (const [name, sourcePaths] of Object.entries(examples)) {
    const project = join(work, name);
    copyExample(name, project);
    install(project);
    const original = sourceSnapshot(name, project);
    const originalLink = name === 'workspaces' ? workspaceLinkSnapshot(project) : null;
    if (originalLink) {
      assert.equal(originalLink.resolved, realpathSync(join(project, 'packages/rules')),
        'workspaces: npm link does not resolve to the workspace package');
    }
    const normal = runCheck(name, project, 'seshat.json');
    assert.equal(normal.complete, true, `${name}: normal check was incomplete`);
    assert.equal(normal.quality.state, 'not-configured');
    assertExpected(name, normal, 1);
    assertUnchanged(name, project, original, originalLink);

    const parallelConfig = JSON.parse(readFileSync(join(project, 'seshat.json'), 'utf8'));
    parallelConfig.workers = 2;
    writeFileSync(join(project, 'seshat-workers2.json'), JSON.stringify(parallelConfig, null, 2) + '\n');
    const parallel = runCheck(name, project, 'seshat-workers2.json');
    assert.equal(parallel.complete, true, `${name}: workers=2 check was incomplete`);
    assertExpected(name, parallel, 2);
    assert.deepEqual(stable(parallel), stable(normal), `${name}: workers=1/2 results differ`);
    assertUnchanged(name, project, original, originalLink);

    results.examples[name] = {
      sourceFiles: sourcePaths,
      normal: portable(normal),
      workers: {
        one: normal.result.mutation.workersUsed,
        two: parallel.result.mutation.workersUsed,
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
    assertUnchanged(name, project, original, originalLink);

    const failure = {...base, thresholds: {maxCrap: maxCrap - 0.001, minMutationScore: score}};
    writeFileSync(join(project, 'seshat-failure.json'), JSON.stringify(failure, null, 2) + '\n');
    const failureReport = runCheck(name, project, 'seshat-failure.json', 1);
    assert.equal(failureReport.complete, true);
    assert.equal(failureReport.quality.state, 'failed');
    assert.equal(failureReport.result.mutation.score, score);
    assertUnchanged(name, project, original, originalLink);

    const incomplete = structuredClone(base);
    incomplete.setups[0].test = [process.execPath, '-e', 'process.exit(1)'];
    writeFileSync(join(project, 'seshat-incomplete.json'), JSON.stringify(incomplete, null, 2) + '\n');
    const incompleteReport = runCheck(name, project, 'seshat-incomplete.json', 2);
    assert.equal(incompleteReport.complete, false);
    assert.equal(incompleteReport.quality.state, 'incomplete');
    assertUnchanged(name, project, original, originalLink);
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

console.log(`Verified ${Object.keys(examples).length} consumer examples with ${cliKind} ${cliHash}; expected assessments, worker counts, link preservation, and Node threshold/incomplete exits pass.`);
