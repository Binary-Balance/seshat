import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {pathToFileURL} from 'node:url';
import {runInNewContext} from 'node:vm';

const source = readFileSync(new URL('./node-load-observer.mjs', import.meta.url), 'utf8')
  .replace(/^import .*;\r?$/gm, '');

for (const [active, versions] of [
  [true, ['24.20.0', '24.20.1', '24.21.0', '24.22.0', '24.22.2', '24.99.99', '24.100.0']],
  [false, ['24.19.99', '25.0.0', '24.21.0-rc.1', '24.21.0+build', '024.21.0', '24.020.0', '24.20.00', '24.20', '']],
]) {
  for (const node of versions) {
    test(`observer ${active ? 'activates' : 'stays inactive'} on ${JSON.stringify(node)}`, () => {
      let subscribed = false;
      runInNewContext(source, {
        process: {versions: {node}, argv: ['node', '/fixture/check.mjs'],
          env: {NODE_TEST_CONTEXT: 'child-v8', SESHAT_LOAD_CONTEXT: '/fixture/context.json'},
          on() {}},
        pathToFileURL,
        readFileSync() { return JSON.stringify({sources: []}); },
        tracingChannel() { return {error: {subscribe() { subscribed = true; }}}; },
      });
      assert.equal(subscribed, active);
    });
  }
}
