#!/usr/bin/env node
import {appendFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

const [rustc, ...args] = process.argv.slice(2);
const log = process.env.SESHAT_RUSTC_LOG;
if (!rustc || !log) {
  console.error('rustc-capture requires a compiler command and SESHAT_RUSTC_LOG');
  process.exit(2);
}

appendFileSync(log, JSON.stringify({rustc, args}) + '\n');
const result = spawnSync(rustc, args, {stdio: 'inherit'});
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
