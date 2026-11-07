import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {runInNewContext} from 'node:vm';

const source = readFileSync(new URL('./process.mjs', import.meta.url), 'utf8');
const helper = source.slice(source.indexOf('export function rustFreeEnvironment()'),
  source.indexOf('\nexport function killTree')).replace('export function', 'function');

for (const key of ['PATH', 'Path', 'pAtH']) {
  test(`Rust-free Windows proof preserves Node with ${key}`, () => {
    // Windows process.env lookups ignore case; a spread copy is a plain object.
    const variables = {[key]:'C:/node;C:/cargo;C:/Windows'};
    const env = new Proxy(variables, {get(target, name) {
      return target[Object.keys(target).find(key => key.toUpperCase() === String(name).toUpperCase())];
    }});
    const value = runInNewContext(`${helper}\nrustFreeEnvironment()`, {
      process:{env, platform:'win32'}, delimiter:';',
      join:(directory, file) => `${directory}/${file}`,
      existsSync:path => path === 'C:/cargo/cargo.exe',
    });
    assert.equal(value.PATH, 'C:/node;C:/Windows');
    assert.deepEqual(Object.keys(value).filter(key => key.toUpperCase() === 'PATH'), ['PATH']);
  });
}
