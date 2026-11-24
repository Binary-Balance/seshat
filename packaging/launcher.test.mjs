import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import test from 'node:test';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('launcher selects Linux libc from positive process.report evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'seshat-launcher-'));
  try {
    mkdirSync(join(root, 'bin'));
    const launcher = join(root, 'bin/seshat.mjs');
    copyFileSync(join(repo, 'packages/seshat/bin/seshat.mjs'), launcher);
    writeFileSync(join(root, 'package.json'), JSON.stringify({version:'1.0.0'}));
    for (const cpu of ['x64', 'arm64']) {
      for (const libc of ['glibc', 'musl']) {
        const name = '@binary-balance/seshat-linux-' + cpu + (libc === 'musl' ? '-musl' : '');
        const directory = join(root, 'node_modules', name);
        mkdirSync(join(directory, 'bin'), {recursive:true});
        writeFileSync(join(directory, 'package.json'), JSON.stringify({name, version:'1.0.0'}));
        writeFileSync(join(directory, 'bin/seshat'), 'fixture');
        const report = libc === 'glibc' ? {header:{glibcVersionRuntime:'2.35'}}
          : {header:{}, sharedObjects:['/lib/ld-musl-' + (cpu === 'x64' ? 'x86_64' : 'aarch64') + '.so.1']};
        const child = invoke(cpu, '() => (' + JSON.stringify(report) + ')');
        assert.equal(child.status, 0, child.stderr);
        assert.equal(child.stdout.trim(), join(directory, 'bin/seshat'));
      }
    }
    for (const [report, message] of [
      ['() => ({header:{}, sharedObjects:[]})', /must identify glibc or a musl loader/],
      ['() => ({header:{}, sharedObjects:["/lib/libc.musl.so"]})', /must identify glibc or a musl loader/],
      ['() => { throw new Error("report unavailable"); }', /process.report failed: report unavailable/],
      ['undefined', /must identify glibc or a musl loader/],
      ['() => ({header:{glibcVersionRuntime:"2.35"}, sharedObjects:["/lib/ld-musl-x86_64.so.1"]})', /conflicting/],
    ]) {
      const child = invoke('x64', report);
      assert.equal(child.status, 2, child.stderr);
      assert.equal(child.stderr, '');
      const envelope = JSON.parse(child.stdout);
      assert.equal(envelope.schemaVersion, 1);
      assert.equal(envelope.complete, false);
      assert.match(envelope.result.error, message);
    }
    function invoke(cpu, report) {
      const code = [
        "import {EventEmitter} from 'node:events';",
        "import childProcess from 'node:child_process';",
        "import {syncBuiltinESMExports} from 'node:module';",
        "Object.defineProperty(process, 'platform', {value:'linux'});",
        'Object.defineProperty(process, "arch", {value:' + JSON.stringify(cpu) + '});',
        'process.report.getReport = ' + report + ';',
        "childProcess.spawn = executable => { console.log(executable); const child = new EventEmitter(); child.exitCode = null; child.signalCode = null; process.nextTick(() => child.emit('close', 0, null)); return child; };",
        'syncBuiltinESMExports();',
        "process.argv = [process.argv[0], 'seshat', 'check', '--json'];",
        'await import(' + JSON.stringify(pathToFileURL(launcher).href) + ');',
      ].join('\n');
      return spawnSync(process.execPath, ['--input-type=module', '-e', code], {encoding:'utf8'});
    }
  } finally { rmSync(root, {recursive:true, force:true}); }
});
