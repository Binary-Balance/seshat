# Seshat

This package installs the Seshat command and selects the native payload for
the current Node platform. The native payload packages are optional so npm can
skip the four platforms that do not match the consumer.

Seshat needs Node 24.20.0. Run `seshat check`, `seshat crap`, or `seshat mutate`
with a project `seshat.json`. Add `--json` for the versioned report.
