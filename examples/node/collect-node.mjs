// Bounded consumer adapter for TypeScript ESM and Node's built-in test runner.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {dirname, join} from 'node:path';
import {mkdirSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import instrument from 'istanbul-lib-instrument';
import coverage from 'istanbul-lib-coverage';

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
  // Instrument original spans; transpile/remap can lose multiline operand ends.
  const tool = instrument.createInstrumenter({
    esModules: true,
    parserPlugins: ['typescript', 'importAttributes'],
  });
  prepared[pathToFileURL(path).href] = tool.instrumentSync(readFileSync(path, 'utf8'), path);
  initial.addFileCoverage(tool.lastFileCoverage());
}

const hook = join(directory, 'hook.mjs');
writeFileSync(hook, `import {registerHooks} from 'node:module';import {writeFileSync} from 'node:fs';
const prepared=${JSON.stringify(prepared)};
registerHooks({load(url,context,next){return Object.hasOwn(prepared,url)?{format:'module-typescript',shortCircuit:true,source:prepared[url]}:next(url,context);}});
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
writeFileSync(report, JSON.stringify(initial.toJSON()));
