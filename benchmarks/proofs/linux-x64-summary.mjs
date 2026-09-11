import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';

const selfCheck = process.argv[2] === '--self-check';
assert.ok(selfCheck || process.argv.length === 3,
  'usage: node benchmarks/proofs/linux-x64-summary.mjs <artifact directory> | --self-check');

const cliScenarios = value => {
  const summary = value?.checks?.['installed-cli-regression']?.stdout?.match(/CLI passed: (\d+) scenarios/);
  if (summary) return Number(summary[1]);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return Object.keys(value).length;
};
const statuses = value => Object.fromEntries(Object.entries(value?.checks ?? value ?? {}).map(([name, check]) => [name, check.status]));
const kernelAtLeast = value => {
  const match = String(value ?? '').match(/^(\d+)\.(\d+)/);
  return Boolean(match) && (Number(match[1]) > 6 || Number(match[1]) === 6 && Number(match[2]) >= 8);
};
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const runnerCases = {
  jestExpo: ['normal-1', 'assertion-kill', 'survivor', 'before-all'],
  vitest: ['stack', 'assertion', 'survived', 'before-all'],
};
const lifecycleCases = [
  ...['SIGINT', 'SIGTERM'].flatMap(signal => ['typecheck', 'baseline', 'coverage', 'mutation'].map(phase => `${signal}-${phase}`)),
  'timeout', 'overflow', 'leader-exit',
];
const environmentNames = ['CARGO_HOME', 'RUSTUP_HOME', 'CARGO_TARGET_DIR', 'NODE_OPTIONS', 'SESHAT_MUTANT_ID'];

function validateRunner(label, value, cases, packed, artifacts, fail) {
  if (!value) {
    fail(`${label} result missing`);
    return;
  }
  if (value.version !== 1) fail(`${label} result version missing`);
  if (value.checks?.requested !== cases.length || value.checks?.completed !== cases.length) {
    fail(`${label} did not retain ${cases.length} requested checks`);
  }
  if (!value.originalsPreserved) fail(`${label} source preservation check failed`);
  const noRust = value.noConsumingRust;
  if (!noRust) fail(`${label} no-Rust evidence missing`);
  else {
    for (const command of ['cargo', 'rustc']) {
      if (noRust.probes?.find(probe => probe.command === command)?.unavailable !== true) {
        fail(`${label} consuming ${command} probe was available`);
      }
    }
    if (!environmentNames.every(name => noRust.environmentUnset?.includes(name))) {
      fail(`${label} consuming environment was not sanitized`);
    }
  }
  if (value.cli?.source !== 'tarball') fail(`${label} did not record tarball installation`);
  if (value.cli?.version !== 'seshat 0.0.0 (candidate)') fail(`${label} candidate version missing`);
  if (packed && value.cli?.binarySha256 !== packed.binary) fail(`${label} binary hash differs from package metadata`);
  if (artifacts.tarball?.sha256 && value.cli?.tarballSha256 !== artifacts.tarball.sha256) {
    fail(`${label} tarball hash differs from retained archive`);
  }
  const runs = value.runs;
  if (!runs || Object.keys(runs).length !== cases.length) fail(`${label} result is partial`);
  for (const name of cases) {
    const run = runs?.[name];
    if (!run) {
      fail(`${label} check missing: ${name}`);
      continue;
    }
    const result = run.result ?? run.report?.result;
    const expectedComplete = name !== 'before-all';
    if (!run.report || run.report.complete !== expectedComplete) fail(`${label} report incomplete: ${name}`);
    if (result?.complete !== expectedComplete) fail(`${label} result verdict mismatch: ${name}`);
    if (run.execution?.status !== (expectedComplete ? 0 : 2)) fail(`${label} exit status mismatch: ${name}`);
    if (result?.mutation?.unresolved !== (expectedComplete ? 0 : 1)) fail(`${label} unresolved result mismatch: ${name}`);
  }
}

function validateLifecycle(value, fail) {
  if (!value) {
    fail('lifecycle result missing');
    return;
  }
  if (Object.keys(value).length !== lifecycleCases.length || lifecycleCases.some(name => !value[name])) {
    fail('lifecycle result is partial');
  }
  for (const name of lifecycleCases) {
    const row = value[name];
    if (!row) continue;
    if (row.leaderAlive !== false || row.descendantAlive !== false) fail(`lifecycle cleanup failed: ${name}`);
    if (!Array.isArray(row.remainingScratch) || row.remainingScratch.length) fail(`lifecycle scratch was not empty: ${name}`);
    let report;
    try { report = JSON.parse(row.stdout); } catch { report = null; }
    if (!report || report.complete !== false) fail(`lifecycle report incomplete: ${name}`);
    const signal = name.match(/^(SIGINT|SIGTERM)-/)?.[1];
    if (signal) {
      if (report.cancelled !== true || row.exit?.code !== (signal === 'SIGINT' ? 130 : 143)) {
        fail(`lifecycle cancellation verdict mismatch: ${name}`);
      }
    } else if (report.cancelled === true || row.exit?.code !== 2) {
      fail(`lifecycle failure verdict mismatch: ${name}`);
    }
  }
}

function validate({preflight, packed, npm, standalone, debian, jestExpo, vitest, lifecycle}, parseErrors = {}, artifactDirectory = null, artifacts = {}) {
  const failures = Object.entries(parseErrors).map(([name, message]) => `${name}: invalid JSON (${message})`);
  const fail = message => failures.push(message);
  if (!preflight) fail('preflight result missing');
  else if (preflight.validation?.passed !== true) fail('preflight validation failed');

  if (!packed) fail('package result missing');
  else {
    if (!packed.binary || !packed.binaryBytes) fail('package binary metadata missing');
    if (artifactDirectory) {
      for (const name of ['seshat-linux-x64.tgz', 'seshat-linux-x64-standalone.tar.gz']) {
        if (!existsSync(join(artifactDirectory, name))) fail(`artifact missing: ${name}`);
      }
      if (!artifacts.tarball?.sha256) fail('npm tarball hash missing');
      if (packed.tarballSha256 && artifacts.tarball?.sha256 && artifacts.tarball.sha256 !== packed.tarballSha256) fail('npm tarball hash differs from package evidence');
      if (!artifacts.standalone?.sha256) fail('standalone archive hash missing');
      if (packed.standalone?.sha256 && artifacts.standalone?.sha256 && artifacts.standalone.sha256 !== packed.standalone.sha256) fail('standalone archive hash differs from package evidence');
    }
  }

  if (!npm) fail('npm result missing');
  else {
    if (Object.keys(npm.checks ?? {}).length !== 16) fail('npm proof did not retain 16 checks');
    if (npm.checks?.['installed-cli-regression']?.status !== 0) fail('npm installed CLI check failed');
    if (cliScenarios(npm) !== 43) fail('npm proof did not retain 43 CLI scenarios');
    if (packed && npm.build?.binarySha256 !== packed.binary) fail('npm binary hash differs from package metadata');
  }

  if (!standalone) fail('standalone result missing');
  else {
    for (const name of ['archive-list', 'extract', 'installed-cli', 'installed-parallel']) {
      if (standalone.checks?.[name]?.status !== 0) fail(`standalone ${name} check failed`);
    }
    if (standalone.cliScenarios !== 43) fail('standalone proof did not retain 43 CLI scenarios');
    if (Object.keys(standalone.parallelChecks ?? {}).length !== 11) fail('standalone proof did not retain 11 parallel controls');
    if (artifacts.standalone?.sha256 !== standalone.archiveSha256) fail('standalone archive hash differs from proof evidence');
    if (packed && standalone.build?.binarySha256 !== packed.binary) fail('standalone binary hash differs from package metadata');
  }

  if (!debian) fail('Debian 11 result missing');
  else {
    if (debian.architecture !== 'x64') fail('Debian proof architecture mismatch');
    if (debian.glibc !== '2.31') fail('Debian proof did not run with glibc 2.31');
    if (debian.rustAvailable !== false) fail('Debian proof exposed a Rust toolchain');
    if (debian.network !== 'isolated namespace') fail('Debian proof network isolation missing');
    if (!kernelAtLeast(debian.kernel)) fail(`Debian proof kernel is below Linux 6.8: ${debian.kernel ?? 'unknown'}`);
    if (preflight?.environment?.kernel?.release && debian.kernel !== preflight.environment.kernel.release) {
      fail('Debian proof kernel differs from native preflight');
    }
    for (const name of ['installed-package', 'installed-parallel', 'installed-standalone']) {
      if (debian.checks?.[name]?.status !== 0) fail(`Debian ${name} check failed`);
    }
    if (cliScenarios(debian.cliChecks) !== 43) fail('Debian npm proof did not retain 43 CLI scenarios');
    if (Object.keys(debian.parallelChecks ?? {}).length !== 11) fail('Debian npm proof did not retain 11 parallel controls');
    if (debian.standaloneCliScenarios !== 43) fail('Debian standalone proof did not retain 43 CLI scenarios');
    if (Object.keys(debian.standaloneParallelChecks ?? {}).length !== 11) fail('Debian standalone proof did not retain 11 parallel controls');
    if (artifacts.tarball?.sha256 && debian.tarballSha256 !== artifacts.tarball.sha256) fail('Debian npm archive hash differs from retained archive');
    if (artifacts.standalone?.sha256 && debian.standaloneArchiveSha256 !== artifacts.standalone.sha256) fail('Debian standalone archive hash differs from retained archive');
  }
  validateRunner('Jest/Expo', jestExpo, runnerCases.jestExpo, packed, artifacts, fail);
  validateRunner('Vitest', vitest, runnerCases.vitest, packed, artifacts, fail);
  validateLifecycle(lifecycle, fail);
  return failures;
}

const selfCheckRunner = cases => ({
  version: 1,
  cli: {source: 'tarball', version: 'seshat 0.0.0 (candidate)', tarballSha256: 'tarball', binarySha256: 'binary'},
  noConsumingRust: {
    probes: [{command: 'cargo', unavailable: true}, {command: 'rustc', unavailable: true}],
    environmentUnset: environmentNames,
  },
  checks: {requested: cases.length, completed: cases.length},
  originalsPreserved: true,
  runs: Object.fromEntries(cases.map(name => {
    const complete = name !== 'before-all';
    return [name, {
      execution: {status: complete ? 0 : 2},
      report: {complete, result: {complete, mutation: {unresolved: complete ? 0 : 1}}},
    }];
  })),
});

const selfCheckLifecycle = Object.fromEntries(lifecycleCases.map(name => {
  const signal = name.match(/^(SIGINT|SIGTERM)-/)?.[1];
  return [name, {
    exit: {code: signal ? (signal === 'SIGINT' ? 130 : 143) : 2},
    leaderAlive: false,
    descendantAlive: false,
    remainingScratch: [],
    stdout: JSON.stringify({complete: false, cancelled: Boolean(signal)}),
  }];
}));

function selfCheckSummary() {
  const checks = Object.fromEntries(Array.from({length: 15}, (_, index) => [`check-${index}`, {status: 0}]));
  checks['installed-cli-regression'] = {status: 0, stdout: 'CLI passed: 43 scenarios plus legacy parity'};
  const base = {
    preflight: {validation: {passed: true}, environment: {kernel: {release: '6.8.0-test'}}},
    packed: {binary: 'binary', binaryBytes: 1, tarballSha256: 'tarball', standalone: {sha256: 'standalone'}},
    npm: {build: {binarySha256: 'binary'}, checks},
    standalone: {
      archiveSha256: 'standalone', cliScenarios: 43, build: {binarySha256: 'binary'},
      checks: Object.fromEntries(['archive-list', 'extract', 'installed-cli', 'installed-parallel'].map(name => [name, {status: 0}])),
      parallelChecks: Object.fromEntries(Array.from({length: 11}, (_, index) => [`case-${index}`, {}])),
    },
    debian: {
      architecture: 'x64', glibc: '2.31', rustAvailable: false, network: 'isolated namespace', kernel: '6.8.0-test',
      checks: { 'installed-package': {status: 0}, 'installed-parallel': {status: 0}, 'installed-standalone': {status: 0} },
      cliChecks: Object.fromEntries(Array.from({length: 43}, (_, index) => [`scenario-${index}`, {status: 0}])),
      parallelChecks: Object.fromEntries(Array.from({length: 11}, (_, index) => [`case-${index}`, {}])),
      standaloneCliScenarios: 43,
      standaloneParallelChecks: Object.fromEntries(Array.from({length: 11}, (_, index) => [`case-${index}`, {}])),
      tarballSha256: 'tarball', standaloneArchiveSha256: 'standalone',
    },
    jestExpo: selfCheckRunner(runnerCases.jestExpo),
    vitest: selfCheckRunner(runnerCases.vitest),
    lifecycle: selfCheckLifecycle,
  };
  assert.deepEqual(validate(base, {}, null, {tarball: {sha256: 'tarball'}, standalone: {sha256: 'standalone'}}), []);
  assert.equal(cliScenarios(base.debian.cliChecks), 43);
  assert.equal(Object.keys(statuses(base.debian.cliChecks)).length, 43);
  assert.match(validate({...base, standalone: null}).join('\n'), /standalone result missing/);
  assert.match(validate({...base, debian: {...base.debian, kernel: '6.7.0-test'}}).join('\n'), /below Linux 6.8/);
  assert.match(validate(base, {}, '/missing-linux-x64-archives', {tarball: {sha256: 'tarball'}}).join('\n'), /standalone archive hash missing/);
  assert.match(validate({...base, vitest: null}).join('\n'), /Vitest result missing/);
  const partial = structuredClone(base);
  delete partial.jestExpo.runs['before-all'];
  assert.match(validate(partial).join('\n'), /Jest\/Expo result is partial/);
  const lifecycleFailure = structuredClone(base);
  lifecycleFailure.lifecycle.timeout.remainingScratch = ['left'];
  assert.match(validate(lifecycleFailure).join('\n'), /lifecycle scratch was not empty/);
  console.log('Linux x64 summary self-check passed');
}

if (selfCheck) {
  selfCheckSummary();
} else {
  const directory = resolve(process.argv[2]);
  const parseErrors = {};
  const read = name => {
    const path = join(directory, name);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      parseErrors[name] = error.message;
      return null;
    }
  };
  const preflight = read('preflight.json');
  const packed = read('package-result.json');
  const npm = read('npm-package.json');
  const standalone = read('standalone.json');
  const debian = read('debian11.json');
  const jestExpo = read('jest-expo-check.json');
  const vitest = read('vitest-check.json');
  const lifecycle = read('lifecycle.json');
  const artifacts = {};
  for (const [key, name] of [['tarball', 'seshat-linux-x64.tgz'], ['standalone', 'seshat-linux-x64-standalone.tar.gz']]) {
    const path = join(directory, name);
    if (existsSync(path) && statSync(path).isFile()) artifacts[key] = {file: name, sha256: hash(path), bytes: statSync(path).size};
  }
  const failures = validate({preflight, packed, npm, standalone, debian, jestExpo, vitest, lifecycle}, parseErrors, directory, artifacts);
  const portablePackage = packed && artifacts.tarball && artifacts.standalone ? {
    ...packed,
    tarball: artifacts.tarball.file,
    proofBinary: null,
    tarballSha256: artifacts.tarball.sha256,
    standalone: {path: artifacts.standalone.file, sha256: artifacts.standalone.sha256, bytes: artifacts.standalone.bytes},
  } : null;
  const summary = {
    schemaVersion: 1,
    kind: 'seshat-linux-x64-package-proof',
    sourceCommit: process.env.GITHUB_SHA ?? preflight?.provenance?.sourceCommit ?? null,
    runner: 'ubuntu-22.04',
    userspace: 'Native Ubuntu 22.04 / glibc 2.35 host; pinned Debian 11 / glibc 2.31 installed proof',
    kernel: {
      candidateFloor: 'Linux 6.8 family',
      native: preflight?.environment?.kernel?.release ?? null,
      debian: debian?.kernel ?? null,
    },
    node: '24.20.0',
    rust: '1.98.1',
    architecture: 'x86_64',
    elfMachine: 62,
    glibcFloor: '2.31',
    preflight: preflight ? {environment: preflight.environment, validation: preflight.validation, provenance: preflight.provenance} : null,
    artifacts: packed ? {
      npmTarball: artifacts.tarball ?? null,
      standalone: artifacts.standalone ?? null,
      binary: {sha256: packed.binary ?? null, bytes: packed.binaryBytes ?? null},
    } : null,
    npm: npm ? {build: npm.build, tarballSha256: artifacts.tarball?.sha256 ?? null, cliScenarios: cliScenarios(npm), checks: statuses(npm)} : null,
    standalone: standalone ? {build: standalone.build, archiveSha256: standalone.archiveSha256, archiveBytes: standalone.archiveBytes, cliScenarios: standalone.cliScenarios, checks: statuses(standalone)} : null,
    debian11: debian ? {
      kernel: debian.kernel,
      glibc: debian.glibc,
      node: debian.node,
      npm: debian.npm,
      rustAvailable: debian.rustAvailable,
      network: debian.network,
      npmCliScenarios: cliScenarios(debian.cliChecks),
      npmParallelControls: Object.keys(debian.parallelChecks ?? {}).length,
      standaloneCliScenarios: debian.standaloneCliScenarios,
      standaloneParallelControls: Object.keys(debian.standaloneParallelChecks ?? {}).length,
      checks: statuses(debian),
      npmChecks: statuses(debian.cliChecks),
      standaloneChecks: statuses({checks: debian.standaloneChecks}),
    } : null,
    runners: {
      jestExpo: jestExpo ? {environment: jestExpo.environment, cli: jestExpo.cli, dependencies: jestExpo.dependencies, noConsumingRust: jestExpo.noConsumingRust, checks: jestExpo.checks, originalsPreserved: jestExpo.originalsPreserved} : null,
      vitest: vitest ? {environment: vitest.environment, cli: vitest.cli, dependencies: vitest.dependencies, noConsumingRust: vitest.noConsumingRust, checks: vitest.checks, originalsPreserved: vitest.originalsPreserved} : null,
      lifecycle: lifecycle ? {cases: Object.keys(lifecycle), cleanup: Object.fromEntries(Object.entries(lifecycle).map(([name, row]) => [name, {exit: row.exit, leaderAlive: row.leaderAlive, descendantAlive: row.descendantAlive, remainingScratch: row.remainingScratch}]))} : null,
    },
    validation: {
      package: Boolean(packed && portablePackage),
      npm: Boolean(npm),
      standalone: Boolean(standalone),
      debian11: Boolean(debian),
      jestExpo: Boolean(jestExpo),
      vitest: Boolean(vitest),
      lifecycle: Boolean(lifecycle),
      passed: failures.length === 0,
      failures,
    },
    limits: 'The Linux 6.8 family is a fail-closed candidate runner floor, verified on the recorded host kernel rather than by booting an older kernel. Debian 11 LTS ended 2026-08-31; its pinned userspace is retained as a compatibility snapshot. This proof does not establish support for glibc below 2.31, other Linux userspaces, macOS or Windows.',
  };
  writeFileSync(join(directory, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  if (portablePackage) writeFileSync(join(directory, 'package-result.json'), JSON.stringify(portablePackage, null, 2) + '\n');
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`Wrote ${join(directory, 'summary.json')}`);
  }
}
