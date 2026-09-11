// Temporary maintainer-only diagnostic. It is deliberately bounded to six clean packs.
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {basename, dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const scriptRepo = resolve(here, '..');
const sourceRepo = resolve(process.env.SESHAT_NATIVE_SOURCE ?? scriptRepo);
const baseCommit = '3251118dbc4612334bfff825f03ed2f04b8ed029';
const expectedNode = 'v24.20.0';
const expectedTarget = 'x86_64-unknown-linux-gnu';
const inputDirectory = resolve(process.argv[2] ?? '');
const outputDirectory = resolve(process.env.SESHAT_CAPTURE_OUTPUT ?? '');
assert.equal(process.argv.length, 3, 'usage: SESHAT_CAPTURE_OUTPUT=dir node packaging/native-repro-capture.mjs <Debian archive directory>');
assert.ok(process.env.SESHAT_CAPTURE_OUTPUT, 'SESHAT_CAPTURE_OUTPUT is required');
assert.equal(process.platform, 'linux', 'native capture requires Linux');
assert.equal(process.arch, 'x64', 'native capture requires x64 Node');
assert.equal(process.version, expectedNode, `native capture requires Node ${expectedNode}`);
assert.equal(execFileSync('uname', ['-m'], {encoding: 'utf8'}).trim(), 'x86_64', 'native capture requires x86_64');
assert.equal(execFileSync('git', ['status', '--porcelain'], {cwd: sourceRepo, encoding: 'utf8'}).trim(), '', 'native capture requires a clean source tree');
assert.equal(execFileSync('git', ['merge-base', '--is-ancestor', baseCommit, 'HEAD'], {cwd: sourceRepo}).toString(), '', 'native capture must remain based on the frozen PR28 head');
assert.ok(!existsSync(outputDirectory), `capture output already exists: ${outputDirectory}`);
mkdirSync(outputDirectory, {recursive: true});

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const commandAt = (cwd, name, args, options = {}) => execFileSync(name, args, {
  cwd,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
  ...options,
}).trim();
const command = (name, args, options = {}) => commandAt(sourceRepo, name, args, options);
const relativeOutput = path => relative(outputDirectory, path);
const diagnosticCommit = commandAt(scriptRepo, 'git', ['rev-parse', 'HEAD']);
const inputHashes = [
  ['libc6.deb', '05f7264da867b37f4c5ce49266b558ea1e81e05a9464f623152fca70f3550282'],
  ['libc6-dev.deb', 'e7f7b45d9c5cfcf37609f0b6efd3c645272c812144703af89dfd32218fcb0fd3'],
  ['libgcc-s1.deb', 'e478f2709d8474165bb664de42e16950c391f30eaa55bc9b3573281d83a29daf'],
].map(([file, expected]) => {
  const bytes = readFileSync(join(inputDirectory, file));
  assert.equal(sha256(bytes), expected, `unexpected pinned input: ${file}`);
  return {file, sha256: expected, bytes: bytes.length};
});

const host = {
  platform: process.platform,
  arch: process.arch,
  uname: {
    system: command('uname', ['-s']),
    release: command('uname', ['-r']),
    machine: command('uname', ['-m']),
  },
  glibc: process.report.getReport().header.glibcVersionRuntime,
  runner: process.env.RUNNER_NAME ?? null,
  image: process.env.ImageOS ?? null,
};
const toolchain = {
  node: process.version,
  npm: command('npm', ['--version']),
  cargo: command('cargo', ['--version']),
  rustc: command('rustc', ['--version']),
};
const packer = join(sourceRepo, 'packaging/pack.mjs');
const rustcWrapper = join(here, 'rustc-capture.mjs');
const packWorkRoot = join(sourceRepo, 'work');
const outputFile = join(outputDirectory, 'capture.json');

function packDirectories() {
  if (!existsSync(packWorkRoot)) return [];
  return readdirSync(packWorkRoot, {withFileTypes: true})
    .filter(entry => entry.isDirectory() && entry.name.startsWith('npm-pack-'))
    .map(entry => join(packWorkRoot, entry.name));
}

function validPackDirectory(path) {
  const directory = resolve(path);
  return dirname(directory) === resolve(packWorkRoot) && basename(directory).startsWith('npm-pack-');
}

function parseJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function fileEvidence(path, file = basename(path)) {
  if (!existsSync(path)) return null;
  const bytes = readFileSync(path);
  return {file, sha256: sha256(bytes), bytes: bytes.length};
}

function extractArchive(source, member, destination, maxBuffer) {
  try {
    const bytes = execFileSync('tar', ['-xOf', source, member], {cwd: sourceRepo, maxBuffer});
    writeFileSync(destination, bytes);
    return fileEvidence(destination);
  } catch (error) {
    writeFileSync(`${destination}.error`, `${error.stderr ?? error.message ?? error}\n`);
    return null;
  }
}

function smoke(binary) {
  if (!binary) return null;
  const checks = {};
  for (const flag of ['--version', '--help']) {
    const result = spawnSync(binary, [flag], {
      cwd: sourceRepo,
      env: {PATH: '/usr/bin:/bin'},
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
    });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    checks[flag] = {
      status: result.status,
      signal: result.signal,
      firstLine: output.trim().split('\n', 1)[0] || null,
      outputSha256: sha256(Buffer.from(output)),
      outputBytes: Buffer.byteLength(output),
    };
  }
  return checks;
}

function rustcFlags(path) {
  const records = existsSync(path)
    ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
    : [];
  const lto = [...new Set(records.flatMap(record => record.args).flatMap((arg, index, args) => {
    if (arg === '-C' && /^lto=/.test(args[index + 1] ?? '')) return [args[index + 1].slice(4)];
    if (/^-Clto=/.test(arg)) return [arg.slice(5)];
    return [];
  }))].sort();
  return {
    invocations: records.length,
    lto,
    ltoOff: lto.includes('off'),
    sha256: fileEvidence(path)?.sha256 ?? null,
  };
}

function retainPack(runDirectory, result) {
  const retained = {npmArchive: null, standaloneArchive: null, binary: null, build: null, proofBinary: null};
  const archive = result?.tarball && resolve(result.tarball);
  const standalone = result?.standalone?.path && resolve(result.standalone.path);
  if (archive && existsSync(archive)) {
    assert.ok(validPackDirectory(dirname(archive)), `unexpected pack archive path: ${archive}`);
    const destination = join(runDirectory, 'package.tgz');
    copyFileSync(archive, destination);
    retained.npmArchive = fileEvidence(destination);
    extractArchive(destination, 'package/bin/seshat', join(runDirectory, 'seshat'), 32 * 1024 * 1024);
    retained.binary = fileEvidence(join(runDirectory, 'seshat'));
    retained.build = extractArchive(destination, 'package/BUILD.json', join(runDirectory, 'BUILD.json'), 2 * 1024 * 1024);
    const listing = spawnSync('tar', ['-tzf', destination], {encoding: 'utf8'});
    writeFileSync(join(runDirectory, 'archive-list.txt'), `${listing.stdout ?? ''}${listing.stderr ?? ''}`);
  }
  if (standalone && existsSync(standalone)) {
    assert.ok(validPackDirectory(dirname(standalone)), `unexpected standalone archive path: ${standalone}`);
    const destination = join(runDirectory, 'standalone.tar.gz');
    copyFileSync(standalone, destination);
    retained.standaloneArchive = fileEvidence(destination);
  }
  const proofBinary = result?.proofBinary && resolve(result.proofBinary);
  if (proofBinary && existsSync(proofBinary) && validPackDirectory(dirname(proofBinary))) {
    const destination = join(runDirectory, 'proof-binary');
    copyFileSync(proofBinary, destination);
    retained.proofBinary = fileEvidence(destination);
  }
  return retained;
}

function cleanupPackDirectories(before) {
  for (const directory of packDirectories()) {
    if (!before.includes(directory) && validPackDirectory(directory)) rmSync(directory, {recursive: true, force: true});
  }
}

function runPack(index, ltoOverride) {
  const runDirectory = join(outputDirectory, `run-${index + 1}`);
  mkdirSync(runDirectory, {recursive: true});
  const resultPath = join(runDirectory, 'pack-result.json');
  const rustcLog = join(runDirectory, 'rustc-commands.jsonl');
  const rustcVersion = command('rustc', ['-vV']) + '\n';
  writeFileSync(join(runDirectory, 'rustc-vV.txt'), rustcVersion);
  const before = packDirectories();
  const env = {
    ...process.env,
    CARGO_BUILD_JOBS: '1',
    RUSTC_WRAPPER: rustcWrapper,
    SESHAT_PACK_RESULT: resultPath,
    SESHAT_RUSTC_LOG: rustcLog,
  };
  delete env.CARGO_PROFILE_RELEASE_LTO;
  if (ltoOverride) env.CARGO_PROFILE_RELEASE_LTO = ltoOverride;
  const child = spawnSync(process.execPath, [packer, inputDirectory], {
    cwd: sourceRepo,
    env,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  writeFileSync(join(runDirectory, 'pack.stdout.log'), child.stdout ?? '');
  writeFileSync(join(runDirectory, 'pack.stderr.log'), child.stderr ?? '');
  process.stdout.write(child.stdout ?? '');
  process.stderr.write(child.stderr ?? '');

  const resultFromOutput = parseJson(resultPath);
  const newDirectories = packDirectories().filter(directory => !before.includes(directory));
  const resultFromDirectory = newDirectories
    .map(directory => join(directory, 'result.json'))
    .map(path => ({path, result: parseJson(path)}))
    .find(entry => entry.result)?.result ?? null;
  const result = resultFromOutput ?? resultFromDirectory;
  if (result && !existsSync(resultPath)) {
    const sourceResult = newDirectories.map(directory => join(directory, 'result.json')).find(existsSync);
    if (sourceResult) copyFileSync(sourceResult, resultPath);
  }
  const retained = retainPack(runDirectory, result);
  const flags = rustcFlags(rustcLog);
  writeFileSync(join(runDirectory, 'flags.json'), JSON.stringify(flags, null, 2) + '\n');
  const binaryPath = join(runDirectory, 'seshat');
  const record = {
    index: index + 1,
    label: ltoOverride ? `control-${index - 3}` : `baseline-${index + 1}`,
    profileLto: ltoOverride,
    status: child.status,
    signal: child.signal,
    error: child.error?.message ?? null,
    succeeded: child.status === 0 && !child.error,
    rustcVersion: relativeOutput(join(runDirectory, 'rustc-vV.txt')),
    rustcFlags: relativeOutput(join(runDirectory, 'flags.json')),
    rustcCommands: relativeOutput(rustcLog),
    rustcInvocations: flags.invocations,
    actualLto: flags.lto,
    packResult: existsSync(resultPath) ? relativeOutput(resultPath) : null,
    result: result ? {
      binary: result.binary ?? null,
      binaryBytes: result.binaryBytes ?? null,
      tarballSha256: result.tarballSha256 ?? null,
      standalone: result.standalone ? {
        sha256: result.standalone.sha256 ?? null,
        bytes: result.standalone.bytes ?? null,
      } : null,
    } : null,
    artifacts: retained,
    smoke: smoke(retained.binary ? binaryPath : null),
    errors: ltoOverride && !flags.ltoOff ? ['CARGO_PROFILE_RELEASE_LTO=off did not reach a rustc invocation'] : [],
  };
  writeFileSync(join(runDirectory, 'smoke.json'), JSON.stringify(record.smoke, null, 2) + '\n');
  cleanupPackDirectories(before);
  return record;
}

const runs = [];
for (let index = 0; index < 6; index += 1) {
  runs.push(runPack(index, index < 4 ? null : 'off'));
}

function comparePair(left, right) {
  const a = left.artifacts.binary;
  const b = right.artifacts.binary;
  return {
    left: left.label,
    right: right.label,
    leftSha256: a?.sha256 ?? null,
    rightSha256: b?.sha256 ?? null,
    leftBytes: a?.bytes ?? null,
    rightBytes: b?.bytes ?? null,
    passed: Boolean(a && b && a.sha256 === b.sha256 && a.bytes === b.bytes),
  };
}

function compareGroup(indices) {
  const pairs = [];
  for (let left = 0; left < indices.length; left += 1) {
    for (let right = left + 1; right < indices.length; right += 1) {
      pairs.push(comparePair(runs[indices[left]], runs[indices[right]]));
    }
  }
  return {members: indices.map(index => runs[index].label), pairs, passed: pairs.every(pair => pair.passed)};
}

const comparisons = {baseline: compareGroup([0, 1, 2, 3]), control: compareGroup([4, 5])};

function toolOutput(name, args) {
  const result = spawnSync(name, args, {cwd: sourceRepo, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024});
  return {
    status: result.status,
    signal: result.signal,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

function sectionDiff(directory, name, commandName, leftBinary, rightBinary, argsFor) {
  const left = toolOutput(commandName, argsFor(leftBinary));
  const right = toolOutput(commandName, argsFor(rightBinary));
  const leftPath = join(directory, `${name}.left`);
  const rightPath = join(directory, `${name}.right`);
  writeFileSync(leftPath, left.output);
  writeFileSync(rightPath, right.output);
  const diff = spawnSync('diff', ['-u', '--label', `a/${name}`, leftPath, '--label', `b/${name}`, rightPath], {encoding: 'utf8'});
  writeFileSync(join(directory, `${name}.diff`), `${diff.stdout ?? ''}${diff.stderr ?? ''}`);
  rmSync(leftPath, {force: true});
  rmSync(rightPath, {force: true});
  return {file: relativeOutput(join(directory, `${name}.diff`)), leftStatus: left.status, rightStatus: right.status, diffStatus: diff.status};
}

function byteRanges(leftPath, rightPath) {
  const left = readFileSync(leftPath);
  const right = readFileSync(rightPath);
  const ranges = [];
  let offset = 0;
  while (offset < Math.min(left.length, right.length) && ranges.length < 128) {
    if (left[offset] === right[offset]) {
      offset += 1;
      continue;
    }
    const start = offset;
    while (offset < Math.min(left.length, right.length) && left[offset] !== right[offset]) offset += 1;
    ranges.push({
      offset: start,
      bytes: offset - start,
      left: left.subarray(start, Math.min(offset, start + 16)).toString('hex'),
      right: right.subarray(start, Math.min(offset, start + 16)).toString('hex'),
    });
  }
  if (left.length !== right.length) ranges.push({leftBytes: left.length, rightBytes: right.length});
  return ranges;
}

function generateBaselineDiffs() {
  const mismatches = comparisons.baseline.pairs.filter(pair => !pair.passed);
  for (const mismatch of mismatches) {
    const left = runs.find(run => run.label === mismatch.left);
    const right = runs.find(run => run.label === mismatch.right);
    if (!left?.artifacts.binary || !right?.artifacts.binary) continue;
    const directory = join(outputDirectory, 'comparisons', `${mismatch.left}-vs-${mismatch.right}`);
    mkdirSync(directory, {recursive: true});
    const leftPath = join(outputDirectory, `run-${left.index}`, 'seshat');
    const rightPath = join(outputDirectory, `run-${right.index}`, 'seshat');
    const readelf = sectionDiff(directory, 'readelf-sections', 'readelf', leftPath, rightPath, path => ['-W', '-S', path]);
    const objdump = sectionDiff(directory, 'objdump-sections', 'objdump', leftPath, rightPath, path => ['-h', path]);
    writeFileSync(join(directory, 'byte-ranges.json'), JSON.stringify(byteRanges(leftPath, rightPath), null, 2) + '\n');
    mismatch.diagnostics = {readelf, objdump, byteRanges: relativeOutput(join(directory, 'byte-ranges.json'))};
  }
}

generateBaselineDiffs();
const validation = {
  baselinePassed: comparisons.baseline.passed,
  controlPassed: comparisons.control.passed,
  ltoOverrideReached: runs.slice(4).every(run => run.actualLto.includes('off')),
  passed: comparisons.baseline.passed && comparisons.control.passed && runs.slice(4).every(run => run.errors.length === 0),
  reason: comparisons.baseline.passed
    ? comparisons.control.passed ? 'baseline and control binary pairs matched' : 'control pair differed'
    : 'default baseline binary pair differed',
};
const report = {
  schemaVersion: 1,
  kind: 'seshat-native-linux-x64-repro-capture',
  experiment: {
    baseCommit,
    target: expectedTarget,
    builds: 6,
    baselineBuilds: 4,
    controlBuilds: 2,
    baselineProfile: 'Cargo.toml release profile (lto = thin)',
    controlProfile: 'CARGO_PROFILE_RELEASE_LTO=off',
    changedControlSetting: 'CARGO_PROFILE_RELEASE_LTO=off',
    retryPolicy: 'none',
  },
  sourceCommit: command('git', ['rev-parse', 'HEAD']),
  diagnosticCommit,
  host,
  toolchain,
  input: {mode: 'debian-x64', archives: inputHashes},
  runs,
  comparisons,
  validation,
};
writeFileSync(outputFile, JSON.stringify(report, null, 2) + '\n');
console.log(`Native reproducibility capture ${validation.passed ? 'completed' : 'failed'}: ${outputFile}`);
if (!validation.passed) process.exitCode = 1;
