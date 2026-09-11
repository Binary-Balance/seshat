// Focused native Windows CLI proof. Package installation and publication are separate slices.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const binary = resolve(
  process.env.SESHAT_CLI_BINARY ?? join(repo, 'benchmarks/rust/target/release/seshat.exe'),
);
assert.ok(existsSync(binary), `Windows CLI binary is missing: ${binary}`);

const work = mkdtempSync(join(tmpdir(), 'seshat-windows-runtime-'));
const project = join(work, 'input path 🎸');
const scratch = join(work, 'scratch');
mkdirSync(join(project, 'src'), {recursive: true});
mkdirSync(join(project, 'packages', 'rules'), {recursive: true});
mkdirSync(join(project, 'node_modules', '@fixture'), {recursive: true});
mkdirSync(join(project, 'tests'));
mkdirSync(scratch);

const originals = {
  'package.json': '{"type":"module","workspaces":["packages/*"]}\n',
  'src/subject.ts': 'export const value = (input: number) => input >= 0;\n',
  'packages/rules/package.json': '{"name":"@fixture/rules","type":"module","exports":"./index.ts"}\n',
  'packages/rules/index.ts': 'export const answer = () => 42;\n',
  'tests/check.mjs': [
    "import {test} from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import {value} from '../src/subject.ts';",
    "import {answer} from '@fixture/rules';",
    "test('native Windows capture', () => { assert.equal(value(1), true); assert.equal(answer(), 42); });",
  ].join(''),
};
for (const [relative, content] of Object.entries(originals)) {
  writeFileSync(join(project, relative), content);
}

// npm represents a Windows workspace package with a junction. The runtime must recognize it
// as a link and rewrite it into the private captured copy without falling back to a directory copy.
const workspaceLink = join(project, 'node_modules', '@fixture', 'rules');
symlinkSync(join(project, 'packages', 'rules'), workspaceLink, 'junction');

const configPath = join(project, 'seshat.json');
const config = {
  source: {include: ['src/**/*.ts']},
  capture: ['package.json', 'src', 'packages', 'node_modules', 'tests'],
  setups: [{
    name: 'node',
    runner: 'node',
    cwd: '.',
    timeoutMs: 30_000,
    typecheck: [
      process.execPath,
      join(repo, 'benchmarks/node_modules/typescript/bin/tsc'),
      '--ignoreConfig', '--strict', '--noEmit', '--skipLibCheck', 'src/subject.ts',
    ],
    test: [process.execPath, '--test', '--test-reporter={seshatReporter}', 'tests/check.mjs'],
    coverage: {
      command: [process.execPath, join(here, 'collect-node.mjs'), 'tests/check.mjs'],
      report: 'coverage/coverage-final.json',
    },
  }],
};
writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

try {
  const result = spawnSync(
    binary,
    ['check', '--config', configPath, '--scratch', scratch, '--json', '--no-progress'],
    {cwd: project, encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024},
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const report = JSON.parse(result.stdout);
  assert.equal(report.complete, true, JSON.stringify(report));
  assert.deepEqual(report.scope.files, ['src/subject.ts']);
  assert.ok(report.result.jobsAttempted >= 3);
  assert.deepEqual(readdirSync(scratch), [], 'captured scratch must be cleaned');
  for (const [relative, content] of Object.entries(originals)) {
    assert.equal(readFileSync(join(project, relative), 'utf8'), content, relative);
  }
  assert.ok(existsSync(workspaceLink), 'original workspace junction must survive');
  console.log('Windows native CLI proof passed: junction capture, Unicode/space paths, Node/TypeScript jobs, coverage and cleanup');
} finally {
  rmSync(work, {recursive: true, force: true});
}
