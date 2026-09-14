# Consumer examples

These directories are independent projects. Each has its own `package.json`
and lockfile and runs Seshat through an executable supplied by the caller.

The examples use Node 24.20.0. Install each project's dependencies with
`npm ci`, then run the installed Seshat command from that project:

```sh
SESHAT=/absolute/path/to/seshat
"$SESHAT" check --config ./seshat.json --json --no-progress
```

The focused verification driver installs every example in disposable copies,
runs the normal check, compares one and two Seshat workers, and checks
threshold and incomplete-run exits for the Node example:

```sh
node examples/verify.mjs --cli "$SESHAT"
```

The Node example includes a small Istanbul collector. It supports the listed
UTF-8 TypeScript ESM files on Node 24.20.0 and the built-in test runner. It is
an example adapter, not a general V8 coverage converter.
