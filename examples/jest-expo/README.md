# Jest and Expo

See the [shared consumer guidance](../README.md) for native and Node launcher
commands, PowerShell equivalents, workers, thresholds, reports and exit codes.

This project follows the verified Jest/Expo setup with Node `>=24.20.0 <25`, Jest
29.7.0, jest-expo 57.0.5, Expo 57.0.20, React Native 0.86.3,
`@react-native/jest-preset` 0.86.3, `babel-preset-expo` 57.0.10, React 19.2.3
and TypeScript 6.0.3. The configuration captures the source, tests, Babel and
Jest settings, package lockfile and installed dependencies.

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

The coverage command uses Jest's Babel Istanbul provider and writes the full
`coverage/coverage-final.json` report consumed by Seshat. The setup is bounded
to one Jest project, Jest Circus and `--runInBand`.
