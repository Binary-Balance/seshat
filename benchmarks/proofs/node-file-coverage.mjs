import {tracingChannel} from 'node:diagnostics_channel';
import {readFileSync, writeFileSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {observeCoverage} from './coverage-observer.cjs';

const supported = /^24\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(process.versions.node)
  && Number(process.versions.node.split('.')[1]) >= 20;
let parent;
try { parent = JSON.parse(process.env.SESHAT_NODE_TEST_PARENT); } catch {}
const file = process.argv[1], executionId = process.env.SESHAT_EXECUTION_ID;
if (supported && process.env.NODE_TEST_CONTEXT === 'child-v8'
  && parent?.pid === process.ppid && parent.executionId === executionId
  && typeof executionId === 'string' && executionId.length > 0
  && typeof file === 'string' && isAbsolute(file)
  && process.env.SESHAT_TEST_SELECTION === '1' && process.env.SESHAT_COVERAGE_REPORT
  && process.env.SESHAT_NODE_ISTANBUL === '1'
  && process.env.SESHAT_SOURCES && process.env.SESHAT_RECEIPT) {
  let sources;
  try { sources = JSON.parse(readFileSync(process.env.SESHAT_SOURCES, 'utf8')); } catch {}
  if (Array.isArray(sources) && sources.every(path => typeof path === 'string' && isAbsolute(path))
    && new Set(sources).size === sources.length) {
    const stem = `${process.env.SESHAT_RECEIPT}.events-node-${process.pid}`;
    let invalidated = false, started = false, finished = false;
    const invalidate = () => {
      if (invalidated) return;
      writeFileSync(`${stem}.invalid`, executionId, {flag:'wx'});
      invalidated = true;
    };
    const observer = observeCoverage(globalThis, sources, invalidate);
    tracingChannel('node.test').start.subscribe(context => {
      if (!started && context.type === 'test' && context.name !== '<root>' && context.file === file
        && typeof context.name === 'string' && Number.isSafeInteger(context.nesting) && context.nesting >= 0) {
        started = true;
        observer.start();
      }
    });
    const emit = process.emit;
    const observeExit = function(event, ...args) {
      if (event !== 'exit') return Reflect.apply(emit, this, [event, ...args]);
      try {
        return Reflect.apply(emit, this, [event, ...args]);
      } finally {
        // A preload's exit listener precedes application cleanup and collector listeners.
        let result = observer.finish();
        if (process.emit !== observeExit) result = {complete:false, sources:[]};
        if (finished) invalidate();
        else {
          finished = true;
          const record = {version:1, executionId, file, pid:process.pid, parentPid:process.ppid,
            coverage:started ? result : {complete:false, sources:[]}};
          let json = JSON.stringify(record);
          if (Buffer.byteLength(json) > 16384) {
            record.coverage = {complete:false, sources:[]};
            json = JSON.stringify(record);
          }
          writeFileSync(`${stem}.json`, json, {flag:'wx'});
        }
      }
    };
    process.emit = observeExit;
  }
}
