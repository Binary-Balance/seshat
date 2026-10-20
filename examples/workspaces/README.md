# npm workspaces

See the [shared consumer guidance](../README.md) for native and Node launcher
commands, PowerShell equivalents, workers, thresholds, reports and exit codes.

This project has a root package and a private `@seshat/example-rules` workspace.
Running `npm ci` creates the npm workspace link at
`node_modules/@seshat/example-rules`. Seshat captures the root, workspace
package, link, source, tests, lockfile and installed dependencies, then rewrites
the link inside its private execution copy.

Install and run the consumer project:

```sh
npm ci
npm test
npm run typecheck
node -e "const fs=require('node:fs'); console.log(fs.realpathSync('node_modules/@seshat/example-rules'))"
```

The last command prints the resolved workspace destination on every platform.
The focused verifier also preserves the link's original target representation.

Run Seshat with an executable supplied by your installation or release proof:

```sh
SESHAT=/absolute/path/to/seshat
"$SESHAT" check --config ./seshat.json --json --no-progress > seshat-report.json
```

The workspace uses the same bounded Node Istanbul adapter as the
[single-package example](../node/README.md). It instruments original UTF-8
TypeScript ESM sources with Istanbul and lets Node `>=24.20.0 <25` strip types.
Multiline branch positions and unloaded files' zero coverage are preserved.
The same erasable-syntax and loader limits apply. TypeScript remains installed
for typechecking.
