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
  writeSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, dirname, extname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const {values} = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: false,
  options: {
    cli: {type: 'string'},
    archives: {type: 'string'},
    output: {type: 'string'},
  },
});
const usage = 'usage: node examples/verify.mjs (--cli PATH | --archives DIR) [--output PATH]';
assert.equal(Number(Boolean(values.cli)) + Number(Boolean(values.archives)), 1, usage);

const archiveTargets = [
  {key: 'entry', file: 'entry.tgz', packageName: '@binary-balance/seshat'},
  {key: 'linux-x64', file: 'linux-x64.tgz', packageName: '@binary-balance/seshat-linux-x64', executable: 'seshat'},
  {key: 'linux-arm64', file: 'linux-arm64.tgz', packageName: '@binary-balance/seshat-linux-arm64', executable: 'seshat'},
  {key: 'darwin-x64', file: 'darwin-x64.tgz', packageName: '@binary-balance/seshat-darwin-x64', executable: 'seshat'},
  {key: 'darwin-arm64', file: 'darwin-arm64.tgz', packageName: '@binary-balance/seshat-darwin-arm64', executable: 'seshat'},
  {key: 'win32-x64', file: 'win32-x64.tgz', packageName: '@binary-balance/seshat-win32-x64', executable: 'seshat.exe'},
];
const optionalArchiveTargets = archiveTargets.slice(1);
const archiveDirectory = values.archives ? resolve(values.archives) : null;
const nativeTarget = optionalArchiveTargets.find(target =>
  target.key === `${process.platform}-${process.arch}`);

function fileIdentity(path) {
  const bytes = readFileSync(path);
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
  };
}

function npmIntegrity(path) {
  return `sha512-${createHash('sha512').update(readFileSync(path)).digest('base64')}`;
}

function commandFor(path) {
  const extension = extname(path).toLowerCase();
  if (['.bat', '.cmd'].includes(extension)) {
    assert.equal(process.platform, 'win32', 'Windows command shims can only run on Windows');
    return [process.env.ComSpec ?? process.env.COMSPEC ?? 'cmd.exe', '/d', '/s', '/c', 'call', path];
  }
  return ['.cjs', '.js', '.mjs'].includes(extension) ? [process.execPath, path] : [path];
}

function commandKind(path) {
  const extension = extname(path).toLowerCase();
  return ['.bat', '.cmd'].includes(extension)
    ? 'windows-npm-shim'
    : ['.cjs', '.js', '.mjs'].includes(extension) ? 'node-launcher' : 'native-executable';
}

const cli = values.cli ? resolve(values.cli) : null;
const cliKind = cli ? commandKind(cli) : null;
const cliIdentity = cli ? (() => {
  assert.ok(existsSync(cli) && statSync(cli).isFile(), `Seshat executable is missing: ${cli}`);
  return fileIdentity(cli);
})() : null;
const cliCommand = cli ? commandFor(cli) : null;
if (cli) {
  if (process.env.SESHAT_EXPECTED_BINARY_SHA256) {
    assert.equal(cliKind, 'native-executable', 'SESHAT_EXPECTED_BINARY_SHA256 requires a native executable');
    assert.equal(cliIdentity.sha256, process.env.SESHAT_EXPECTED_BINARY_SHA256);
  }
}

const archiveInfo = archiveDirectory ? (() => {
  assert.ok(existsSync(archiveDirectory), `archive directory is missing: ${archiveDirectory}`);
  assert.ok(statSync(archiveDirectory).isDirectory(), `archive input is not a directory: ${archiveDirectory}`);
  const expectedFiles = archiveTargets.map(target => target.file).sort();
  const actualFiles = readdirSync(archiveDirectory).sort();
  assert.deepEqual(actualFiles, expectedFiles,
    `archive directory must contain exactly ${expectedFiles.join(', ')}`);
  return archiveTargets.map(target => {
    const path = join(archiveDirectory, target.file);
    assert.ok(existsSync(path) && statSync(path).isFile(), `archive is not a regular file: ${path}`);
    return {
      key: target.key,
      file: target.file,
      ...fileIdentity(path),
      integrity: npmIntegrity(path),
    };
  });
})() : null;
if (archiveDirectory) {
  assert.ok(nativeTarget, `--archives does not support the host ${process.platform}/${process.arch}`);
}
const archiveByKey = archiveInfo && new Map(archiveInfo.map(archive => [archive.key, archive]));
const npmExecPath = process.env.npm_execpath && !/\.(?:cmd|bat)$/i.test(process.env.npm_execpath)
  ? process.env.npm_execpath : null;
const npm = npmExecPath
  ? [process.execPath, npmExecPath]
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
  ...(cli ? {cli: {kind: cliKind, sha256: cliIdentity.sha256, bytes: cliIdentity.bytes}} : {archives: archiveInfo}),
  examples: {},
};

function phase(label, action) {
  writeSync(2, `seshat-public-examples: ${label} started\n`);
  try {
    const result = action();
    writeSync(2, `seshat-public-examples: ${label} completed\n`);
    return result;
  } catch (error) {
    writeSync(2, `seshat-public-examples: ${label} failed\n`);
    throw error;
  }
}

function run(command, args, cwd, expectedStatus = 0, timeout = 600000) {
  const child = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: {...process.env, npm_config_update_notifier: 'false'},
    maxBuffer: 32 * 1024 * 1024,
    timeout,
    shell: false,
  });
  assert.ifError(child.error);
  assert.equal(child.status, expectedStatus, `${command} ${args.join(' ')}\n${child.stdout}\n${child.stderr}`);
  return child;
}

function install(name, project) {
  return phase(`install:${name}`, () => run(npm[0], [
    ...npm.slice(1),
    'ci',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
  ], project, 0, 600000));
}

function projectPath(project, path) {
  return normalizedPath(relative(project, path));
}

function verifyLocalInstallation(project) {
  const packageJson = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(project, 'package-lock.json'), 'utf8'));
  const entrySpec = 'file:vendor/seshat/entry.tgz';
  assert.equal(packageJson.devDependencies?.[archiveTargets[0].packageName], entrySpec,
    'local install: entry archive is not the root dev dependency');
  assert.equal(lock.packages?.['']?.devDependencies?.[archiveTargets[0].packageName], entrySpec,
    'local install: entry archive is missing from the root lock record');

  const optionalLock = [];
  for (const target of optionalArchiveTargets) {
    const spec = `file:vendor/seshat/${target.file}`;
    const record = lock.packages?.[`node_modules/${target.packageName}`];
    assert.equal(packageJson.optionalDependencies?.[target.packageName], spec,
      `local install: ${target.key} is not a root optional dependency`);
    assert.equal(lock.packages?.['']?.optionalDependencies?.[target.packageName], spec,
      `local install: ${target.key} is missing from the root lock record`);
    assert.ok(record, `local install: ${target.key} lock record is missing`);
    assert.equal(record.resolved, spec, `local install: ${target.key} lock path is not project-relative`);
    assert.equal(record.integrity, archiveByKey.get(target.key).integrity,
      `local install: ${target.key} lock integrity differs from the archive`);
    assert.equal(record.optional, true, `local install: ${target.key} lock record is not optional`);
    optionalLock.push({package: target.packageName, resolved: record.resolved, integrity: record.integrity});
  }

  const installedPackages = optionalArchiveTargets.map(target => {
    const packageRoot = join(project, 'node_modules', target.packageName);
    const installed = existsSync(packageRoot);
    assert.equal(installed, target === nativeTarget,
      `local install: unexpected installed native package for ${target.key}`);
    return {target, packageRoot, installed};
  });
  const nativePackage = installedPackages.find(({target}) => target === nativeTarget);
  assert.ok(nativePackage?.installed, 'local install: matching native package is missing');
  const nativeManifestPath = join(nativePackage.packageRoot, 'package.json');
  const nativeManifest = JSON.parse(readFileSync(nativeManifestPath, 'utf8'));
  assert.equal(nativeManifest.name, nativeTarget.packageName, 'local install: native package name changed');
  const nativeExecutable = join(nativePackage.packageRoot, 'bin', nativeTarget.executable);
  assert.ok(statSync(nativeExecutable).isFile(), 'local install: native executable is missing');

  const entryManifestPath = join(project, 'node_modules', archiveTargets[0].packageName, 'package.json');
  const entryManifest = JSON.parse(readFileSync(entryManifestPath, 'utf8'));
  assert.equal(entryManifest.name, archiveTargets[0].packageName, 'local install: entry package name changed');
  const entryLauncher = join(project, 'node_modules', archiveTargets[0].packageName, 'bin', 'seshat.mjs');
  assert.ok(statSync(entryLauncher).isFile(), 'local install: entry launcher is missing');

  const launcher = join(project, 'node_modules', '.bin', process.platform === 'win32' ? 'seshat.cmd' : 'seshat');
  assert.ok(statSync(launcher).isFile(), 'local install: npm .bin launcher is missing');
  const launcherLink = lstatSync(launcher).isSymbolicLink() ? readlinkSync(launcher) : null;
  return {
    host: {platform: process.platform, arch: process.arch},
    optionalLock,
    native: {
      package: nativeTarget.packageName,
      path: projectPath(project, nativeExecutable),
      ...fileIdentity(nativeExecutable),
    },
    launcher: {
      kind: process.platform === 'win32' ? 'windows-npm-shim' : 'posix-bin-link',
      path: projectPath(project, launcher),
      ...(launcherLink ? {link: normalizedPath(launcherLink)} : {}),
      ...fileIdentity(launcher),
    },
    entry: {
      package: archiveTargets[0].packageName,
      path: projectPath(project, entryLauncher),
      ...fileIdentity(entryLauncher),
    },
  };
}

function installLocal(name, project) {
  return phase(`local-install:${name}`, () => {
    const vendor = join(project, 'vendor', 'seshat');
    mkdirSync(vendor, {recursive: true});
    for (const target of archiveTargets) {
      cpSync(join(archiveDirectory, target.file), join(vendor, target.file));
    }
    run(npm[0], [
      ...npm.slice(1),
      'install',
      '--save-dev',
      '--save-exact',
      '--ignore-scripts',
      'vendor/seshat/entry.tgz',
    ], project, 0, 600000);
    run(npm[0], [
      ...npm.slice(1),
      'install',
      '--save-optional',
      '--save-exact',
      '--ignore-scripts',
      ...optionalArchiveTargets.map(target => `vendor/seshat/${target.file}`),
    ], project, 0, 600000);
    run(npm[0], [
      ...npm.slice(1),
      'ci',
      '--ignore-scripts',
      '--offline',
    ], project, 0, 600000);
    const installed = verifyLocalInstallation(project);
    const launcher = join(project, 'node_modules', '.bin', process.platform === 'win32' ? 'seshat.cmd' : 'seshat');
    return {command: commandFor(launcher), installed};
  });
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

function runCheck(name, project, configName, expectedStatus = 0, command = cliCommand) {
  return phase(`check:${name}:${configName.replace(/\.json$/, '')}`, () => {
    const child = run(command[0], [
      ...command.slice(1),
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
  });
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
    install(name, project);
    const local = archiveDirectory ? installLocal(name, project) : null;
    const cliCommandForProject = local?.command ?? cliCommand;
    if (local) {
      if (results.installed) assert.deepEqual(local.installed, results.installed,
        `${name}: installed archive identity differs from the first project`);
      else results.installed = local.installed;
    }
    const original = sourceSnapshot(name, project);
    const originalLink = name === 'workspaces' ? workspaceLinkSnapshot(project) : null;
    if (originalLink) {
      assert.equal(originalLink.resolved, realpathSync(join(project, 'packages/rules')),
        'workspaces: npm link does not resolve to the workspace package');
    }
    const normal = runCheck(name, project, 'seshat.json', 0, cliCommandForProject);
    assert.equal(normal.complete, true, `${name}: normal check was incomplete`);
    assert.equal(normal.quality.state, 'not-configured');
    assertExpected(name, normal, 1);
    assertUnchanged(name, project, original, originalLink);

    const parallelConfig = JSON.parse(readFileSync(join(project, 'seshat.json'), 'utf8'));
    parallelConfig.workers = 2;
    writeFileSync(join(project, 'seshat-workers2.json'), JSON.stringify(parallelConfig, null, 2) + '\n');
    const parallel = runCheck(name, project, 'seshat-workers2.json', 0, cliCommandForProject);
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
    const equalityReport = runCheck(name, project, 'seshat-equality.json', 0, cliCommandForProject);
    assert.equal(equalityReport.complete, true);
    assert.equal(equalityReport.quality.state, 'passed');
    assert.ok(equalityReport.quality.checks.every(check => check.state === 'passed'));
    assertUnchanged(name, project, original, originalLink);

    const failure = {...base, thresholds: {maxCrap: maxCrap - 0.001, minMutationScore: score}};
    writeFileSync(join(project, 'seshat-failure.json'), JSON.stringify(failure, null, 2) + '\n');
    const failureReport = runCheck(name, project, 'seshat-failure.json', 1, cliCommandForProject);
    assert.equal(failureReport.complete, true);
    assert.equal(failureReport.quality.state, 'failed');
    assert.equal(failureReport.result.mutation.score, score);
    assertUnchanged(name, project, original, originalLink);

    const incomplete = structuredClone(base);
    incomplete.setups[0].test = [process.execPath, '-e', 'process.exit(1)'];
    writeFileSync(join(project, 'seshat-incomplete.json'), JSON.stringify(incomplete, null, 2) + '\n');
    const incompleteReport = runCheck(name, project, 'seshat-incomplete.json', 2, cliCommandForProject);
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

if (cli) {
  console.log(`Verified ${Object.keys(examples).length} consumer examples with ${cliKind} ${cliIdentity.sha256}; expected assessments, worker counts, link preservation, and Node threshold/incomplete exits pass.`);
} else {
  console.log(`Verified ${Object.keys(examples).length} consumer examples with local archives; expected assessments, worker counts, link preservation, and Node threshold/incomplete exits pass.`);
}
