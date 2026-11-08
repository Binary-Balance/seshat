# Plain Jest example

An independent TypeScript project using Jest 29.7.0, babel-jest 29.7.0 and
Babel coverage. It has no Expo dependency. `npm ci` installs the locked tools;
`npm test` and `npm run typecheck` verify the project alone.

Jest defaults to `jest-environment-node`. Set `testEnvironment: 'jsdom'` in
`jest.config.cjs` to use the included `jest-environment-jsdom` 29.7.0 instead.
Both environments are verified under source replacement and experimental
switching. The Babel TypeScript preset removes types; the separate TypeScript
check catches type errors.

Run a built Seshat executable from this directory:

```sh
/path/to/seshat check --config seshat.json --json --no-progress
# Optional parity check:
/path/to/seshat check --config seshat.json --experimental-switching --json --no-progress
```

The two functions have complete statement coverage. Four comparison mutants
produce three kills and one survivor (75%); the positive equality boundary is
deliberately untested. Both extreme mutants are killed.

Keep `--reporters={seshatReporter}` and `--env={seshatEnvironment}` in both
commands. Seshat resolves the original project environment before installing
its evidence wrapper. Custom environments, environment docblocks, custom
transforms, multiple Jest projects and V8 coverage are outside this verified
route. A docblock that bypasses the wrapper leaves execution incomplete.
Plain Jest currently runs the full configured command for each mutant;
enabled test-file selection falls back with `missing-test-files`.

See the [compatibility guide](../../docs/runner-compatibility.md) and
[local archive installation recipe](../README.md#install-and-run-a-local-archive).
