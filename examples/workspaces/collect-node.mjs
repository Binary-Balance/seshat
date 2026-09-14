// Bounded consumer adapter for TypeScript ESM and Node's built-in test runner.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {dirname, join} from 'node:path';
import {mkdirSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import instrument from 'istanbul-lib-instrument';
import coverage from 'istanbul-lib-coverage';
import sourceMaps from 'istanbul-lib-source-maps';

const report = process.env.SESHAT_COVERAGE_REPORT;
const sourceList = process.env.SESHAT_SOURCES;
assert.ok(report && sourceList, 'Seshat coverage environment is missing');

const directory = dirname(report);
mkdirSync(directory, {recursive: true});
const counters = join(directory, 'counters');
mkdirSync(counters, {recursive: true});
const initial = coverage.createCoverageMap({});
const prepared = {};

for (const path of JSON.parse(readFileSync(sourceList, 'utf8'))) {
  const compiled = ts.transpileModule(readFileSync(path, 'utf8'), {
    fileName: path,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      sourceMap: true,
      inlineSources: true,
    },
    reportDiagnostics: true,
  });
  assert.equal(compiled.diagnostics.length, 0);
  const tool = instrument.createInstrumenter({esModules: true});
  prepared[pathToFileURL(path).href] = tool.instrumentSync(
    compiled.outputText.replace(/\/\/# sourceMappingURL=.*$/m, ''),
    path,
    JSON.parse(compiled.sourceMapText),
  );
  initial.addFileCoverage(tool.lastFileCoverage());
}

const hook = join(directory, 'hook.mjs');
writeFileSync(hook, `import {registerHooks} from 'node:module';import {writeFileSync} from 'node:fs';
const prepared=${JSON.stringify(prepared)};
registerHooks({load(url,context,next){return Object.hasOwn(prepared,url)?{format:'module',shortCircuit:true,source:prepared[url]}:next(url,context);}});
process.on('exit',()=>{if(globalThis.__coverage__)writeFileSync(${JSON.stringify(counters)}+'/'+process.pid+'.json',JSON.stringify(globalThis.__coverage__));});`);

const run = spawnSync(process.execPath, [
  '--import',
  pathToFileURL(hook).href,
  '--test',
  '--test-concurrency=1',
  `--test-reporter=${process.env.SESHAT_NODE_REPORTER}`,
  ...process.argv.slice(2),
], {stdio: 'inherit'});
assert.ifError(run.error);
if (run.status !== 0) process.exit(run.status ?? 2);

for (const name of readdirSync(counters)) {
  initial.merge(JSON.parse(readFileSync(join(counters, name), 'utf8')));
}
const mapped = await sourceMaps.createSourceMapStore().transformCoverage(initial);
writeFileSync(report, JSON.stringify(mapped.toJSON()));
