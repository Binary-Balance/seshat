// Focused diagnostics regressions for runner identity and resolved concurrency.
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';

const work = mkdtempSync(join(tmpdir(), 'seshat-reporter-'));
const executableRoot = join(work, 'executable/node_modules');
const cwdRoot = join(work, 'cwd/node_modules');
const install = (root, name, version) => {
  const packageRoot = join(root, name);
  mkdirSync(join(packageRoot, 'bin'), {recursive: true});
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({name, version}));
  return packageRoot;
};
const jestRoot = install(executableRoot, 'jest', '30.5.1');
install(executableRoot, 'jest-expo', '60.0.0');
install(cwdRoot, 'jest', '29.7.0');
const selectedExpo = install(cwdRoot, 'jest-expo', '57.0.5');
mkdirSync(join(selectedExpo, 'src/preset'), {recursive: true});
writeFileSync(join(selectedExpo, 'src/preset/setup.js'), '');
const executable = join(jestRoot, 'bin/jest.js');
writeFileSync(executable, '#!/usr/bin/env node\n');
const wrapper = join(work, 'wrapper.mjs');
writeFileSync(wrapper, '');

const requireFromHere = createRequire(import.meta.url);
const Reporter = requireFromHere('./jest-reporter.cjs');
const previousCwd = process.cwd();
process.chdir(join(work, 'cwd'));
try {
  const selectedContext = [{config:{setupFiles:[join(selectedExpo, 'src/preset/setup.js')]}}];
  assert.deepEqual(Reporter.executingVersions(executable, selectedContext), {
    jest: '30.5.1',
    'jest-expo': '57.0.5',
  });
  assert.deepEqual(Reporter.executingVersions(executable), {jest: '30.5.1'});
  assert.deepEqual(Reporter.executingVersions(executable, [{config:{preset:'jest-expo'}}]), {
    jest: '30.5.1',
  });
  assert.deepEqual(Reporter.executingVersions(wrapper, selectedContext), {});
} finally {
  process.chdir(previousCwd);
  rmSync(work, {recursive: true, force: true});
}

console.log('Reporter diagnostics checks passed: executable package identity is independent of cwd and wrappers remain unavailable.');
