# Node built-in test runner

This project uses Node `>=24.20.0 <25`, TypeScript 6.0.3 and the built-in test runner.
`source.include` selects `src/**/*.ts`; `source.exclude` removes
`src/ignored.ts`. `capture` includes the test inputs, the small coverage adapter
and installed dependencies.

See the [shared consumer guidance](../README.md) for native and Node launcher
commands, PowerShell equivalents, workers, thresholds, reports and exit codes.

Install the example dependencies in this directory:

```sh
npm ci
npm test
npm run typecheck
```

Run Seshat with an executable supplied by your installation or release proof:

```sh
SESHAT=/absolute/path/to/seshat
"$SESHAT" check --config ./seshat.json --json --no-progress > seshat-report.json
```

`collect-node.mjs` instruments the selected UTF-8 TypeScript ESM sources directly
with Istanbul, then lets Node strip types while running the built-in tests.
This preserves original statement and branch positions, including multiline
operands. Instrumented files that tests never import retain zero coverage.
TypeScript remains a dependency for typechecking.

The adapter requires erasable TypeScript syntax supported by Node. It does not
support TSX, decorators, enums, parameter properties, runtime namespaces,
TypeScript import aliases, `tsconfig` path aliases or arbitrary CommonJS loaders.
Use explicit `import type` for type imports. See
[Node's TypeScript support](https://nodejs.org/docs/latest-v24.x/api/typescript.html).
