// Compare original and inactive prepared TypeScript without making scripts into modules.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {runInNewContext} from 'node:vm';
import ts from '../node_modules/typescript/lib/typescript.js';

const binary = resolve(process.env.SESHAT_PROOF_BINARY ?? 'crates/seshat/target/release/seshat-proofs');
const work = mkdtempSync(join(tmpdir(), 'seshat-switching-syntax-'));
// Do not let TypeScript's defaults add strict mode and hide a lost directive.
const options = {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  moduleDetection: ts.ModuleDetectionKind.Legacy, alwaysStrict: false,
  ignoreDeprecations: '6.0', skipLibCheck: true};
function prepare(name, source) {
  const input = join(work, name);
  const output = join(work, `prepared-${name}`);
  writeFileSync(input, source);
  const child = spawnSync(binary, ['prepare', input, output], {encoding: 'utf8', timeout: 10000});
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stdout + child.stderr);
  return readFileSync(output, 'utf8');
}
function compile(source) {
  const result = ts.transpileModule(source, {compilerOptions: options, reportDiagnostics: true});
  assert.equal(result.diagnostics.length, 0,
    result.diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
  return result.outputText;
}
function execute(source, env = {}) {
  return runInNewContext(compile(source), {process: {env}}, {timeout: 1000});
}
function typecheck(source) {
  const input = join(work, 'enum.ts');
  writeFileSync(input, source);
  const program = ts.createProgram([input], {...options, noEmit: true, types: []});
  return ts.getPreEmitDiagnostics(program).map(d => d.code);
}
try {
  for (const [name, source, expected] of [
    ['hashbang.ts', '#!/usr/bin/env node\n1 < 2;', true],
    ['strict.cts', '"use strict"; function strictThis() { return this; } strictThis() === undefined;', true],
    ['sloppy.cts', 'function sloppyThis() { return this; } sloppyThis() === undefined;', false],
    ['preamble.ts', '#!/usr/bin/env node\r\n/* 🎸 */\r\n"use client";\r\n"use strict"\r\nfunction f() { return this; } f() === undefined;', true],
  ]) {
    assert.equal(execute(source), expected, `${name}: original`);
    const prepared = prepare(name, source);
    assert.equal(execute(prepared), expected, `${name}: inactive switching`);
    console.log(`${name}: original and inactive switching agree`);
  }

  for (const initializer of ['1 < 2 ? 1 : 0', '+(1 < 2)']) {
    const source = `enum E { A = ${initializer}, B = 2 } E.A;`;
    assert.deepEqual(typecheck(source), [], 'computed numeric enum must typecheck');
    const prepared = prepare('enum.ts', source);
    assert.equal(execute(prepared), execute(source));
    assert.equal(execute(prepared, {SESHAT_MUTANT_ID: '1'}), 0, 'enum mutant must activate');
  }
  assert.ok(typecheck('const enum E { A = 1 < 2 ? 1 : 0 }').includes(2474));
  assert.ok(typecheck('enum E { A = 1 < 2 }').includes(18033));
  console.log('Enums: valid computed members preserve behaviour and activate; invalid examples fail typechecking');

  const prepared = compile(prepare('environment.ts', '1 < 2;'));
  for (const context of [{}, {process: {}}, {process: null}]) {
    assert.throws(() => runInNewContext(prepared, context, {timeout: 1000}),
      /experimental switching requires globalThis.process.env/);
  }
  assert.equal(runInNewContext(prepared, {process: {env: {SESHAT_MUTANT_ID: '1'}}}), false);

  for (const name of ['source.js', 'source.jsx', 'source.mjs', 'source.cjs', 'source.d.ts', 'source.d.mts', 'source.d.cts']) {
    const input = join(work, name);
    const output = join(work, 'rejected.ts');
    writeFileSync(input, '');
    writeFileSync(output, 'untouched');
    const child = spawnSync(binary, ['prepare', input, output], {encoding: 'utf8', timeout: 10000});
    assert.ifError(child.error);
    assert.equal(child.status, 2, child.stdout + child.stderr);
    assert.match(JSON.parse(child.stdout).error, /requires a non-declaration TypeScript source/);
    assert.equal(readFileSync(output, 'utf8'), 'untouched');
  }
  console.log('Unsupported process environments and source types fail clearly');

  const modules = fileURLToPath(new URL('node_modules/', import.meta.url));
  const subject = compile(prepare('runner.ts', 'function compare(value: number) { return value < 2; }'));
  const check = `test('switching helper', () => {
    assert.deepEqual([compare(1), compare(2)], process.env.SESHAT_MUTANT_ID === '1' ? [false, true] : [true, false]);
  });`;
  writeFileSync(join(work, 'node.test.cjs'), `const {test} = require('node:test');\nconst assert = require('node:assert/strict');\n${subject}\n${check}`);
  writeFileSync(join(work, 'jest.test.cjs'), `const assert = require('node:assert/strict');\n${subject}\n${check}`);
  writeFileSync(join(work, 'vitest.test.mjs'), `import {test} from ${JSON.stringify(pathToFileURL(join(modules, 'vitest/dist/index.js')).href)};\nimport assert from 'node:assert/strict';\n${subject}\n${check}`);
  writeFileSync(join(work, 'vitest.config.mjs'), "export default {test:{include:['vitest.test.mjs'],maxWorkers:1,fileParallelism:false}};\n");
  for (const [runner, args] of [
    ['node', ['--test', 'node.test.cjs']],
    ['jest', [join(modules, 'jest/bin/jest.js'), '--runInBand', '--config', JSON.stringify({rootDir: work, testMatch: ['**/jest.test.cjs'], testEnvironment: 'node', transform: {}})]],
    ['vitest', [join(modules, 'vitest/vitest.mjs'), 'run', '--config', 'vitest.config.mjs']],
  ]) {
    for (const active of [undefined, '1']) {
      const env = {...process.env};
      delete env.SESHAT_MUTANT_ID;
      if (active !== undefined) env.SESHAT_MUTANT_ID = active;
      const child = spawnSync(process.execPath, args, {cwd: work, env, encoding: 'utf8', timeout: 30000});
      assert.ifError(child.error);
      assert.equal(child.status, 0, `${runner}: ${child.stdout}${child.stderr}`);
    }
    console.log(`${runner}: process.env supports inactive and active switching`);
  }
} finally {
  rmSync(work, {recursive: true, force: true});
}
