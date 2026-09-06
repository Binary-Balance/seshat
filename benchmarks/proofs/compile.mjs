import {readFileSync, writeFileSync} from 'node:fs';
import ts from '../node_modules/typescript/lib/typescript.js';
const [input, output] = process.argv.slice(2);
const result = ts.transpileModule(readFileSync(input, 'utf8'), {
  fileName: input,
  compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.React, inlineSourceMap: true, inlineSources: true},
  reportDiagnostics: true,
});
if (result.diagnostics.length) throw Error(ts.formatDiagnosticsWithColorAndContext(result.diagnostics, {
  getCanonicalFileName: p => p, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n',
}));
writeFileSync(output, result.outputText);
