import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const compiler = process.argv[2] || require.resolve('typescript/bin/tsc');
const ts = require(join(dirname(dirname(compiler)), 'lib/typescript.js'));
const helper = fileURLToPath(new URL('../../crates/seshat/src/execution/project/compiler-strictness.cjs', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'seshat-strictness-'));
const outside = `${root}-outside.args`;
const write = (name, contents) => {
  const filename = join(root, name);
  mkdirSync(dirname(filename), { recursive: true });
  writeFileSync(filename, contents);
};
let runs = 0;
const inspect = (args, cwd = root, script = compiler, sources) => {
  const context = join(root, `context-${runs}.json`);
  const receipt = join(root, `receipt-${runs++}.json`);
  writeFileSync(context, JSON.stringify({ compiler: script, args, root, sources }));
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

  write('packages/rules/options.args', '--project . --strict --noImplicitAny true');
  write('packages/rules/nested.args', '@options.args');
  for (const response of ['options.args', 'nested.args']) {
    const captured = inspect([`@${response}`], cwd);
    assert.equal(captured.state, 'known', captured.error);
    assert.equal(captured.config, inherited.config);
    assert.equal(captured.options.strict, true);
    assert.equal(captured.options.noImplicitAny, true);
  }
  writeFileSync(outside, '--project . --strict');
  for (const response of [relative(cwd, outside), outside]) {
    const uncaptured = inspect([`@${response}`], cwd);
    assert.equal(uncaptured.state, 'unknown', `uncaptured response: ${response}`);
    assert.equal(uncaptured.options, null);
    assert.match(uncaptured.error, /read file/i);
  }

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

  write('tsconfig.json', JSON.stringify({ files: ['subject.ts', 'plain.js', 'ambient.d.ts', 'view.tsx'], compilerOptions: {
    strict: true, noImplicitAny: false, noEmit: true, skipLibCheck: true, allowJs: true, esModuleInterop: true, jsx: 'preserve',
  } }));
  const subject = `\uFEFF// 🎸 non-ASCII offsets\r\nimport loose from 'untyped';
export function parse(text: string) {
  const value = JSON.parse(text);
  const read = () => value.answer;
  return read();
}
export function annotated(value: any) { return (value as any)!; }
export function typed(value: unknown) { return value; }
export const imported = loose();
`;
  write('subject.ts', subject);
  write('ambient.d.ts', "declare module 'untyped';");
  write('plain.js', 'export function plain(value) { return value; }');
  const view = `declare global { namespace JSX { interface Element {} interface IntrinsicElements { div: {}; 'svg:path': {}; } } }
declare const Component: any;
declare const base: any;
export function view(value: any) { const object = { value }; class Child extends base {} return <div><Component></Component><svg:path /></div>; }`;
  write('view.tsx', view);
  write('excluded.ts', 'export const excluded = JSON.parse("{}");');
  write('node_modules/untyped/package.json', '{"name":"untyped","main":"index.js"}');
  write('node_modules/untyped/index.js', 'module.exports = () => 1;');
  const selected = ['subject.ts', 'plain.js', 'excluded.ts', 'view.tsx'];
  const inferred = inspect(['-p', '.'], root, compiler, selected);
  assert.equal(inferred.state, 'known', inferred.error);
  assert.equal(inferred.inferredAny.state, 'known', inferred.inferredAny.error);
  assert(inferred.inferredAny.ms >= 0);
  const [values, plain, excluded] = inferred.inferredAny.sources;
  const snippets = values.locations.map(({ start, end }) => Buffer.from(subject).subarray(start, end).toString());
  assert.deepEqual(snippets, ['JSON.parse(text)', 'value.answer', 'value', 'read()', 'value', 'loose()', 'loose']);
  assert.equal(plain.state, 'known');
  assert.deepEqual(plain.locations.map(({ start, end }) => 'export function plain(value) { return value; }'.slice(start, end)), ['value']);
  assert.equal(excluded.state, 'not-in-program');
  assert.equal(excluded.locations, null);
  assert.deepEqual(inferred.inferredAny.sources[3].locations.map(({ start, end }) => view.slice(start, end)), ['value', 'base', 'Component']);

  write('subject.ts', 'export function broken() { return missing.value(); }');
  const errors = inspect(['-p', '.'], root, compiler, selected);
  assert.equal(errors.state, 'known', errors.error);
  assert.equal(errors.inferredAny.state, 'unknown');
  assert.equal(errors.inferredAny.sources, null);
  assert.match(errors.inferredAny.error, /missing/);
  write('subject.ts', '// @ts-ignore\nexport const broken = missing.value();');
  const suppressed = inspect(['-p', '.'], root, compiler, selected);
  assert.equal(suppressed.inferredAny.state, 'unknown');
  assert.match(suppressed.inferredAny.error, /unresolved any/);

  write('subject.ts', "import loose from 'untyped'; export const value = loose();");
  write('ambient.d.ts', '');
  const untyped = inspect(['-p', '.'], root, compiler, selected);
  assert.equal(untyped.inferredAny.state, 'unknown');
  assert.match(untyped.inferredAny.error, /unresolved any/);

  write('subject.ts', 'export const value = 1;');
  if (ts.optionDeclarations.some(option => option.name === 'noCheck')) {
    const unchecked = inspect(['-p', '.', '--noCheck'], root, compiler, selected);
    assert.equal(unchecked.state, 'known', unchecked.error);
    assert.equal(unchecked.inferredAny.state, 'unknown');
    assert.match(unchecked.inferredAny.error, /noCheck/);
  }
  write('node_modules/future-typescript/package.json', '{"name":"typescript"}');
  write('node_modules/future-typescript/bin/tsc', '');
  write('node_modules/future-typescript/lib/typescript.js', `
    const ts = require(${JSON.stringify(join(dirname(dirname(compiler)), 'lib/typescript.js'))});
    module.exports = { ...ts, versionMajorMinor: '7.0' };
  `);
  const future = inspect(['-p', '.'], root, join(root, 'node_modules/future-typescript/bin/tsc'), selected);
  assert.equal(future.state, 'known', future.error);
  assert.equal(future.inferredAny.state, 'unknown');
  assert.match(future.inferredAny.error, /TypeScript >=5.0 <7.0/);

  write('reference/tsconfig.json', JSON.stringify({ compilerOptions: { composite: true }, files: ['source.ts'] }));
  write('reference/source.ts', 'export function parse(text: string) { return JSON.parse(text); }');
  write('reference/source.d.ts', 'export declare function parse(text: string): any;');
  write('reference-user.ts', "import { parse } from './reference/source'; export function user(text: string) { return parse(text); }");
  write('references.json', JSON.stringify({ compilerOptions: { noEmit: true, skipLibCheck: true },
    files: ['reference-user.ts'], references: [{ path: './reference' }] }));
  const references = inspect(['-p', 'references.json'], root, compiler, ['reference-user.ts', 'reference/source.ts']);
  assert.equal(references.inferredAny.state, 'known', references.inferredAny.error);
  assert.equal(references.inferredAny.sources[0].locations.length, 1);
  assert.equal(references.inferredAny.sources[1].state, 'not-in-program');
  rmSync(join(root, 'reference/source.d.ts'));
  const missingOutput = inspect(['-p', 'references.json'], root, compiler, ['reference-user.ts']);
  assert.equal(missingOutput.inferredAny.state, 'unknown');
  assert.match(missingOutput.inferredAny.error, /not been built/);
  console.log(`compiler strictness proof passed with TypeScript ${ts.version}, ${runs} cases`);
} finally {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { force: true });
}
