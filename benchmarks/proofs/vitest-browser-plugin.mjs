// Vitest browser mode ignores `test.runner` (#159), so this plugin adds the
// evidence setup file to the page instead. The page has no process.env, so the
// job identity travels through `provide`.
import {fileURLToPath} from 'node:url';
import childProcess from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const setup = fileURLToPath(new URL('./vitest-browser-setup.mjs', import.meta.url));
let tracking = false;

function trackDetachedProcesses() {
  if (tracking || process.platform === 'win32' || !process.env.SESHAT_RECEIPT) return;
  tracking = true;
  const pids = [], spawn = childProcess.spawn;
  const record = () => writeFileSync(process.env.SESHAT_RECEIPT + '.browser-processes', JSON.stringify(pids));
  record();
  // Playwright detaches Unix browsers; they can still write profiles after Vitest dies.
  childProcess.spawn = (...args) => {
    const child = spawn(...args), options = Array.isArray(args[1]) ? args[2] : args[1];
    if (options?.detached && child.pid) { pids.push(child.pid); record(); }
    return child;
  };
  syncBuiltinESMExports();
}

export default {
  name: 'seshat-vitest-browser',
  config: config => {
    if (config.test?.browser?.enabled) trackDetachedProcesses();
    return {
      // Seshat's evidence directory is outside the project, where Vite's
      // server.fs.strict refuses to serve files unless allowed.
      server: {fs: {allow: [setup]}},
      test: {setupFiles: [setup], provide: {seshatExecutionId: process.env.SESHAT_EXECUTION_ID}},
    };
  },
  // Seshat passes the plugin to every Vitest job, so a config shared with Node
  // mode loads it there too. Only browser projects get the version, which tells
  // the setup file to wrap the runner and lets it name the version on failure.
  configureVitest: ({vitest, project}) => {
    if (project.config.browser.enabled) project.provide('seshatBrowserVitest', vitest.version);
  },
};
