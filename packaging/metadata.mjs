import assert from 'node:assert/strict';
import {existsSync, readdirSync} from 'node:fs';
import {join} from 'node:path';

export function packageVersion(manifest) {
  const lines = manifest.split(/\r?\n/);
  const start = lines.findIndex(line => /^[ \t]*\[package\][ \t]*(?:#.*)?$/.test(line));
  assert.ok(start >= 0, 'Cargo manifest is missing [package]');
  const following = lines.slice(start + 1);
  const end = following.findIndex(line => /^[ \t]*\[/.test(line));
  const section = (end < 0 ? following : following.slice(0, end)).join('\n');
  // Packaging requires a literal version owned by this crate, not workspace inheritance.
  const version = section.match(/^[ \t]*version[ \t]*=[ \t]*(["'])([^"'\r\n]+)\1[ \t]*(?:#.*)?$/m)?.[2];
  assert.ok(version, 'Cargo [package] must declare a literal version');
  return version;
}

export function windowsSdkInfo(env = process.env) {
  const directory = env.WindowsSdkDir?.replace(/[\\/]+$/, '') ??
    join(env['ProgramFiles(x86)'] ?? env.ProgramFiles ?? 'C:\\Program Files (x86)', 'Windows Kits', '10');
  const versions = () => existsSync(join(directory, 'Lib'))
    ? readdirSync(join(directory, 'Lib'), {withFileTypes:true})
      .filter(entry => entry.isDirectory() && /^\d+(?:\.\d+)+$/.test(entry.name))
      .map(entry => entry.name).sort((a, b) => a.localeCompare(b, 'en', {numeric:true})).at(-1) ?? null
    : null;
  const version = env.WindowsSDKVersion?.replace(/[\\/]+$/, '') || versions();
  return {directory, version, ucrtVersion:env.UCRTVersion ?? null};
}
