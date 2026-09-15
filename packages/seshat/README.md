# Seshat

Seshat is a native CLI for TypeScript and TSX complexity analysis and mutation
testing. `check` runs both assessments, `crap` runs complexity and coverage
analysis, and `mutate` runs mutation testing from the original test baseline.

## Install

Install the entry package in the project you want to assess:

```sh
npm install --save-dev @binary-balance/seshat
```

The package declares and verifies Node.js 24.20.0 exactly. It selects one
native payload for the current platform from these five verified targets:

- Linux x64 (glibc; Debian 11 userspace, glibc 2.31)
- Linux ARM64 (glibc; Ubuntu 22.04, glibc 2.35)
- macOS x64 (macOS 15.0 minimum)
- macOS ARM64 (macOS 15.0 minimum)
- Windows x64 (Windows Server 2022 verification)

These are the known verification floors; see the [native platform support
matrix](https://github.com/Binary-Balance/seshat/blob/main/docs/platform-support.md)
for the detailed target evidence.

## Minimal mutation example

For a small Node test setup, install TypeScript in the project first:

```sh
npm install --save-dev typescript
```

Create `src/rules.mts`:

```ts
export function classify(value: number): 'positive' | 'negative' {
  return value >= 0 ? 'positive' : 'negative';
}
```

Create `tests/rules.test.mjs`:

```js
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {classify} from '../src/rules.mts';

test('classifies zero and positive values', () => {
  assert.equal(classify(0), 'positive');
  assert.equal(classify(1), 'positive');
});
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "allowImportingTsExtensions": true
  },
  "include": ["src/**/*.mts"]
}
```

Create `seshat.json`:

```json
{
  "source": {"include": ["src/**/*.mts"]},
  "capture": [
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "src",
    "tests",
    "node_modules"
  ],
  "setups": [{
    "name": "node",
    "runner": "node",
    "cwd": ".",
    "typecheck": [
      "node",
      "node_modules/typescript/bin/tsc",
      "--project",
      "tsconfig.json"
    ],
    "test": [
      "node",
      "--test",
      "--test-concurrency=1",
      "--test-reporter={seshatReporter}",
      "tests/rules.test.mjs"
    ],
    "coverage": {
      "command": ["node", "-e", "process.exit(0)"],
      "report": "coverage/unused.json"
    }
  }]
}
```

Run mutation testing and save its JSON report:

```sh
./node_modules/.bin/seshat mutate --config ./seshat.json \
  --json --no-progress > seshat-report.json
```

The `coverage` block is required by the configuration schema but is not run by
`mutate`; the no-op command above keeps this example dependency-light. `check`
and `crap` do run coverage and need a command that writes a fresh Istanbul JSON
report. Use the complete [Node example](https://github.com/Binary-Balance/seshat/tree/main/examples/node),
[Vitest example](https://github.com/Binary-Balance/seshat/tree/main/examples/vitest),
or [Jest/Expo example](https://github.com/Binary-Balance/seshat/tree/main/examples/jest-expo)
for those commands.

See the [full configuration guide](https://github.com/Binary-Balance/seshat/blob/main/docs/configuration.md)
for all fields and runner setup, and the [JSON report format](https://github.com/Binary-Balance/seshat/blob/main/docs/report-format.md)
for the `--json` output contract.
