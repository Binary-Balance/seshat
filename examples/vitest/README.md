# Vitest

See the [shared consumer guidance](../README.md) for native and Node launcher
commands, PowerShell equivalents, workers, thresholds, reports and exit codes.

This project uses Vitest 5.0.0 with `@vitest/coverage-istanbul` 5.0.0 and
TypeScript 6.0.3 on Node 24.20.0 or 24.21.0. The source scope includes the TypeScript and
TSX files under `src`, excluding `src/ignored.ts`. The capture list includes
the source, tests, runner configuration, lockfile and installed dependencies.

Install and run the consumer project:

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

The tests cover a pure TypeScript rule, React TSX and a Fastify route. Coverage
uses Vitest's Istanbul provider and writes the full
`coverage/coverage-final.json` report. Seshat's runner hook is selected by
`SESHAT_VITEST_RUNNER` during an assessment; ordinary `npm test` uses Vitest's
default runner.
