// Vitest browser mode ignores `test.runner` (#159), so this plugin adds the
// evidence setup file to the page instead. The page has no process.env, so the
// job identity travels through `provide`.
import {fileURLToPath} from 'node:url';

const setup = fileURLToPath(new URL('./vitest-browser-setup.mjs', import.meta.url));

export default {
  name: 'seshat-vitest-browser',
  config: () => ({
    // Seshat's evidence directory is outside the project, where Vite's
    // server.fs.strict refuses to serve files unless allowed.
    server: {fs: {allow: [setup]}},
    test: {setupFiles: [setup], provide: {seshatExecutionId: process.env.SESHAT_EXECUTION_ID}},
  }),
};
