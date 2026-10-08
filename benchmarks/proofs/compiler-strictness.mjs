import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const compiler = process.argv[2] || require.resolve('typescript/bin/tsc');
const ts = require(join(dirname(dirname(compiler)), 'lib/typescript.js'));
const helper = fileURLToPath(new URL('../../crates/seshat/src/execution/project/compiler-strictness.cjs', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'seshat-strictness-'));
const write = (name, contents) => {
  const filename = join(root, name);
  mkdirSync(dirname(filename), { recursive: true });
  writeFileSync(filename, contents);
};
let runs = 0;
const inspect = (args, cwd = root, script = compiler) => {
  const context = join(root, `context-${runs}.json`);
  const receipt = join(root, `receipt-${runs++}.json`);
  writeFileSync(context, JSON.stringify({ compiler: script, args, root }));
  const job = spawnSync(process.execPath, [helper, context, receipt], { cwd, timeout: 10000, encoding: 'utf8' });
  assert.equal(job.status, 0, job.stderr);
  return JSON.parse(readFileSync(receipt, 'utf8'));
};

try {
  write('base.json', '// JSONC base\n{"compilerOptions":{"strict":true,"noUncheckedIndexedAccess":true,}}');
  write('node_modules/config-preset/package.json', '{"name":"config-preset","tsconfig":"strict.json"}');
  write('node_modules/config-preset/strict.json', '{"compilerOptions":{"strict":false,"noImplicitAny":true,"skipLibCheck":true}}');
  write('packages/rules/tsconfig.json', '{"extends":["../../base.json","config-preset"],"compilerOptions":{"noImplicitAny":false},"files":["rule.ts"]}');
  write('packages/rules/rule.ts', 'export function rule(value: number) { return value; }');
  const cwd = join(root, 'packages/rules');
  const inherited = inspect(['-p', '.'], cwd);
  assert.equal(inherited.state, 'known', inherited.error);
  assert.equal(inherited.compilerVersion, ts.version);
  assert.equal(inherited.config, 'packages/rules/tsconfig.json');
  assert.equal(inherited.options.strict, false);
  assert.equal(inherited.options.noImplicitAny, false);
  assert.equal(inherited.options.noImplicitThis, false);
  assert.equal(inherited.options.noUncheckedIndexedAccess, true);
  assert(inherited.disabled.includes('strictNullChecks'));
  assert.deepEqual(inherited.enabledBypassOptions, ['skipLibCheck']);
  const override = inspect(['--project', 'tsconfig.json', '--strict', '--noImplicitAny', 'true'], cwd);
  assert.equal(override.state, 'known', override.error);
  assert.equal(override.options.strict, true);
  assert.equal(override.options.noImplicitAny, true);
  assert.equal(override.options.strictNullChecks, true);
  const search = inspect([], cwd);
  assert.equal(search.configSource, 'search');
  assert.equal(search.config, inherited.config);

  write('packages/rules/tsconfig.json', '{"files":["rule.ts"]}');
  const defaults = inspect(['-p', '.'], cwd);
  assert.equal(defaults.options.strict, Number(ts.version.split('.')[0]) >= 6);
  assert.equal(defaults.options.noImplicitAny, defaults.options.strict);
  assert.equal(defaults.options.alwaysStrict, Number(ts.version.split('.')[0]) >= 6);
  const directArgs = ['rule.ts', '--noEmit', '--strict', 'false'];
  if (ts.optionDeclarations.some(option => option.name === 'ignoreConfig')) {
    const conflict = inspect(directArgs, cwd);
    assert.equal(conflict.state, 'unknown');
    assert.match(conflict.error, /ignoreConfig/);
    directArgs.push('--ignoreConfig');
  }
  const direct = inspect(directArgs, cwd);
  assert.equal(direct.state, 'known', direct.error);
  assert.equal(direct.config, null);
  assert.equal(direct.configSource, 'command-line');
  assert.equal(direct.options.strict, false);
  assert.equal(direct.options.noUncheckedIndexedAccess, false);
  if (ts.optionDeclarations.some(option => option.name === 'noCheck')) {
    const bypassed = inspect([...directArgs, '--noCheck'], cwd);
    assert.equal(bypassed.options.noCheck, true);
    assert.deepEqual(bypassed.enabledBypassOptions, ['noCheck']);
  }

  for (const config of [
    '{"extends":"./missing.json","files":["rule.ts"]}',
    '{"compilerOptions":{"nonexistentCheckingFlag":true},"files":["rule.ts"]}',
    '{broken json',
  ]) {
    write('packages/rules/tsconfig.json', config);
    const invalid = inspect(['-p', '.'], cwd);
    assert.equal(invalid.state, 'unknown');
    assert.equal(invalid.options, null);
    assert(invalid.error);
  }
  const missingCompiler = inspect([], cwd, join(root, 'node_modules/typescript/bin/tsc'));
  assert.equal(missingCompiler.state, 'unknown');
  assert.equal(missingCompiler.compilerVersion, null);
  assert(missingCompiler.error);
  assert.equal(inspect(['--watch'], cwd).state, 'unknown');
  assert.equal(inspect(['--build'], cwd).state, 'unknown');
  assert.equal(inspect([], root).state, 'unknown');

  // Older compilers can lack a named option without disabling it.
  write('node_modules/older-typescript/package.json', '{"name":"typescript"}');
  write('node_modules/older-typescript/bin/tsc', '');
  write('node_modules/older-typescript/lib/typescript.js', `
    const ts = require(${JSON.stringify(join(dirname(dirname(compiler)), 'lib/typescript.js'))});
    module.exports = { ...ts, optionDeclarations: ts.optionDeclarations.filter(option => option.name !== 'noUncheckedIndexedAccess') };
  `);
  const unsupported = inspect(directArgs, cwd, join(root, 'node_modules/older-typescript/bin/tsc'));
  assert.equal(unsupported.state, 'known', unsupported.error);
  assert.equal(unsupported.options.noUncheckedIndexedAccess, null);
  assert(unsupported.unsupported.includes('noUncheckedIndexedAccess'));
  assert(!unsupported.disabled.includes('noUncheckedIndexedAccess'));
  console.log(`compiler strictness proof passed with TypeScript ${ts.version}, ${runs} cases`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
