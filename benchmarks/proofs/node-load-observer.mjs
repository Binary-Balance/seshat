// Node 24.20.0 only. Observe fatal ESM entry imports without handling the exception.
import {tracingChannel} from 'node:diagnostics_channel';
import {readFileSync, writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

if (process.env.NODE_TEST_CONTEXT === 'child-v8' && process.versions.node === '24.20.0' && process.env.SESHAT_LOAD_CONTEXT) {
  const context = JSON.parse(readFileSync(process.env.SESHAT_LOAD_CONTEXT, 'utf8'));
  const sources = Array.isArray(context.sources) ? context.sources : [context];
  const entry = process.argv[1];
  const entryURL = pathToFileURL(entry).href;
  const formatter = Error.prepareStackTrace;
  let failedImport;
  tracingChannel('module.import').error.subscribe(event => {
    if (String(event.url) === entryURL) failedImport = event.error;
  });
  process.on('uncaughtExceptionMonitor', (error, origin) => {
    if (origin !== 'unhandledRejection' || error !== failedImport || !(error instanceof Error)
      || Error.prepareStackTrace !== formatter || typeof formatter !== 'function' || formatter.name !== 'ErrorPrepareStackTrace') return;
    let frames;
    try {
      // Preserve Node's formatting. Already-formatted/custom stacks supply no proof.
      Error.prepareStackTrace = (value, sites) => {
        if (value === error) frames = sites;
        return formatter(value, sites);
      };
      void error.stack;
    } catch {
      return;
    } finally { Error.prepareStackTrace = formatter; }
    if (!frames?.length) return;
    const first = frames[0];
    const line = first.getLineNumber(), column = first.getColumnNumber();
    for (const source of sources) {
      if (typeof source?.source !== 'string' || !Array.isArray(source.sites)
        || first.getFileName() !== pathToFileURL(source.source).href
        || !source.sites.some(([sl,sc,el,ec]) => (line > sl || line === sl && column >= sc)
          && (line < el || line === el && column < ec))) continue;
      try {
        writeFileSync(`${process.env.SESHAT_RECEIPT}.load-${process.pid}.json`, JSON.stringify({version:1,
          executionId:context.executionId, entry, source:source.source, line, column}), {flag:'wx'});
      } catch { /* Missing evidence leaves the crash unresolved. */ }
      break;
    }
  });
}
