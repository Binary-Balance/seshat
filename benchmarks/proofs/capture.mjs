// End-to-end capture check. No consuming-project source or dependencies are used.
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, symlinkSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const work = mkdtempSync(join(repo, 'work/assurance-proofs/capture-check-'));
const project = join(work, 'input project 🎸');
const scratch = join(work, 'scratch');
for (const directory of ['src', 'packages/rules', 'node_modules/@capture', 'tests']) {
  mkdirSync(join(project, directory), {recursive:true});
}
mkdirSync(scratch);
const originals = {
  'package.json':'{"type":"module","workspaces":["packages/*"]}\n',
  'src/compare.ts':'export const adult = (age: number) => age >= 18;\n',
  'src/compare.test.ts':'throw Error("not assessment source");\n',
  'packages/rules/package.json':'{"name":"@capture/rules","type":"module","exports":"./index.ts"}\n',
  'packages/rules/index.ts':'export const answer = () => 42;\n',
  'tests/check.mjs':'throw Error("capture must not run tests");\n',
};
for (const [path, source] of Object.entries(originals)) writeFileSync(join(project, path), source);
symlinkSync('../../packages/rules', join(project, 'node_modules/@capture/rules'));
const config = {
  source:{include:['src/**/*.ts', 'packages/**/*.ts'], exclude:['**/*.test.ts']},
  capture:['package.json', 'src', 'packages', 'node_modules', 'tests'],
  setups:[{name:'unit', runner:'node', cwd:'.', test:['node', '--test', 'tests/check.mjs'],
    coverage:{command:['node', 'coverage.mjs'], report:'coverage/coverage-final.json'}}],
};
const configPath = join(project, 'seshat.json');
writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
function capture() {
  const child = spawnSync(join(repo, 'benchmarks/rust/target/release/seshat-proofs'), ['capture', configPath, scratch], {encoding:'utf8', timeout:30000});
  assert.ifError(child.error);
  const result = JSON.parse(child.stdout);
  assert.equal(child.status, result.complete ? 0 : 2, child.stderr + child.stdout);
  assert.deepEqual(readdirSync(scratch), [], 'owned copy must be removed');
  return result;
}
const result = capture();
assert.equal(result.complete, true);
assert.equal(result.commandsRun, 0);
assert.equal(result.rewrittenLinks, 1);
assert.equal(result.capturedFiles, Object.keys(originals).length);
assert.deepEqual(result.sources.map(source => source.path), ['packages/rules/index.ts', 'src/compare.ts']);
assert.equal(result.sources[1].analysis.mutants.length, 2);
assert.deepEqual(capture(), result, 'capture ordering and analysis must be deterministic');
for (const [path, source] of Object.entries(originals)) assert.equal(readFileSync(join(project, path), 'utf8'), source);
assert.equal(readlinkSync(join(project, 'node_modules/@capture/rules')), '../../packages/rules');
writeFileSync(join(project, 'src/compare.ts'), 'export const = ;\n');
const invalid = capture();
assert.equal(invalid.complete, false);
assert.ok(invalid.sources[0].analysis);
assert.match(invalid.sources[1].error, /parse error/);
writeFileSync(join(project, 'src/compare.ts'), originals['src/compare.ts']);
const output = join(work, 'result.json');
writeFileSync(output, JSON.stringify({result, invalid, originalsPreserved:true}, null, 2) + '\n');
console.log(`Capture checks passed: scope, links, deterministic output, parse failure, source preservation and cleanup. Results: ${output}`);
