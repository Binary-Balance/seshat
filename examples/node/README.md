# Node built-in test runner

This project uses Node 24.20.0, TypeScript 6.0.3 and the built-in test runner.
`source.include` selects `src/**/*.ts`; `source.exclude` removes
`src/ignored.ts`. `capture` includes the test inputs, the small coverage adapter
and installed dependencies.

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

`collect-node.mjs` is intentionally small. It transpiles the selected UTF-8
TypeScript ESM files with TypeScript, instruments them with Istanbul, and runs
Node's built-in tests. It does not convert V8 coverage or support arbitrary
CommonJS loaders.
