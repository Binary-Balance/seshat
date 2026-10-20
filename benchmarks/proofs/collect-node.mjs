// Trusted fixture collector, not a distributed adapter. Tool dependencies stay here;
// application sources, tests and generated coverage all belong to the captured copy.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync, readdirSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import instrument from 'istanbul-lib-instrument';
import coverage from 'istanbul-lib-coverage';

const report = process.env.SESHAT_COVERAGE_REPORT;
const directory = dirname(report);
mkdirSync(directory, {recursive:true});
const counters = join(directory, 'counters');
mkdirSync(counters);
const initial = coverage.createCoverageMap({});
const prepared = {};
for (const path of JSON.parse(readFileSync(process.env.SESHAT_SOURCES, 'utf8'))) {
  // Instrument original spans; transpile/remap can lose multiline operand ends.
  const tool = instrument.createInstrumenter({esModules:true, parserPlugins:['typescript', 'importAttributes']});
  prepared[pathToFileURL(path).href] = tool.instrumentSync(readFileSync(path, 'utf8'), path);
  initial.addFileCoverage(tool.lastFileCoverage());
}
const hook = join(directory, 'hook.mjs');
writeFileSync(hook, `import {registerHooks} from 'node:module';import {writeFileSync} from 'node:fs';
const prepared=${JSON.stringify(prepared)};
registerHooks({load(url,context,next){return Object.hasOwn(prepared,url)?{format:'module-typescript',shortCircuit:true,source:prepared[url]}:next(url,context);}});
process.on('exit',()=>{if(globalThis.__coverage__)writeFileSync(${JSON.stringify(counters)}+'/'+process.pid+'.json',JSON.stringify(globalThis.__coverage__));});`);
const run = spawnSync(process.execPath, ['--import', pathToFileURL(hook).href, '--test', '--test-concurrency=1',
  `--test-reporter=${process.env.SESHAT_NODE_REPORTER}`, ...process.argv.slice(2)], {stdio:'inherit'});
assert.ifError(run.error);
if (run.status !== 0) process.exit(run.status ?? 2);
for (const name of readdirSync(counters)) initial.merge(JSON.parse(readFileSync(join(counters, name), 'utf8')));
writeFileSync(report, JSON.stringify(initial.toJSON()));
