import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';

function windowsNpmCli() {
  for (const candidate of [process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')]) {
    if (!candidate || basename(candidate) !== 'npm-cli.js') continue;
    const cli = resolve(candidate);
    try {
      const manifest = JSON.parse(readFileSync(join(dirname(cli), '../package.json'), 'utf8'));
      if (manifest.name === 'npm' && statSync(cli).isFile()) return cli;
    } catch {
      // Another package manager or a missing npm_execpath uses the bundled npm fallback.
    }
  }
  throw new Error('npm CLI not found: use Node with bundled npm or npm_execpath pointing to npm/bin/npm-cli.js');
}

export function runNpm(args, work) {
  // A private prefix also prevents npm from reading a parent project's .npmrc.
  const directory = mkdtempSync(join(work, 'npm-'));
  const userConfig = join(directory, 'user.npmrc');
  const globalConfig = join(directory, 'global.npmrc');
  writeFileSync(userConfig, '');
  writeFileSync(globalConfig, '');
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^npm_config_/i.test(name)));
  const windows = process.platform === 'win32';
  return execFileSync(windows ? process.execPath : 'npm', [
    ...(windows ? [windowsNpmCli()] : []), ...args,
    '--prefix', directory, '--cache', join(directory, 'cache'),
    '--userconfig', userConfig, '--globalconfig', globalConfig,
    '--registry', 'https://registry.npmjs.org', '--offline', '--ignore-scripts',
    '--no-audit', '--no-fund', '--update-notifier=false',
  ], {cwd:directory, env, encoding:'utf8', maxBuffer:16 * 1024 * 1024,
    shell:false, stdio:['ignore', 'pipe', 'inherit']});
}
