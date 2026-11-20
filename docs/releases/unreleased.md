# Unreleased changes

Changes after [Seshat 0.17.0](0.17.0.md).

## Vitest browser mode (planned for 0.18.0)

Assess browser-only TypeScript and TSX with Vitest 5, Playwright and headless
Chromium or Firefox on the five supported hosts. Add the conditional Seshat
plugin to the Vitest config and keep the Seshat reporter in test and coverage
commands. The plugin installs browser evidence hooks; setting `test.runner`
alone does not work in browser mode. See the
[configuration](../configuration.md#vitest-browser-mode) and
[support limits](../runner-compatibility.md#vitest-browser-mode).

One browser instance, default isolation and source replacement are required.
Every mutant runs the full test command. Experimental switching is unsupported.
Other providers, WebKit, headed browsers and custom Playwright launches run
with a visible warning. The adapter uses an undocumented Vitest internal;
changes that prevent evidence collection fail the baseline.

Each job attempt now has a private temporary directory, including compiler
helpers and retries. Cleanup follows process shutdown and removes leftover
browser profiles and artifacts. This also makes temporary caches private to
each attempt for all runners. Cleanup failures stay visible and cannot count
as timeout kills. Browser jobs stalled before a test file starts retry once;
such deadlines remain unresolved even with `countTimeoutsAsKilled`.

The [cost study](../research/vitest-browser-cost.md) supports keeping the
existing cache layout and one-worker default. Measure the consuming project
before adding workers or disabling screenshots.

Release preparation still needs exact 0.18.0 archives and their audit,
retained regression comparisons, five-host browser and archive-install checks,
and the publisher dry run. No 0.18.0 publication is claimed here.
