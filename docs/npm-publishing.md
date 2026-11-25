# npm publication runbook

This runbook covers the six existing public packages in the `binary-balance`
npm organisation:

* `@binary-balance/seshat`
* `@binary-balance/seshat-linux-x64`
* `@binary-balance/seshat-linux-arm64`
* `@binary-balance/seshat-darwin-x64`
* `@binary-balance/seshat-darwin-arm64`
* `@binary-balance/seshat-win32-x64`

Releases from `0.19.0`, including prereleases, require two more native packages:

* `@binary-balance/seshat-linux-x64-musl`
* `@binary-balance/seshat-linux-arm64-musl`

Both new names returned HTTP 404 on 2026-11-24. Their first publication and
trusted-publisher setup remain preparation work; this tooling change does not
publish them or establish Alpine support in a shipped release. The checked-in
`0.18.0` audit remains the historical six-package release input, preserved
unchanged as [JSON](releases/0.18.0-audit.json) and
[Markdown](releases/0.18.0-audit.md). Source version
[0.19.0](releases/0.19.0.md) is in preparation and remains unpublished; its
exact-archive audit is pending. Older releases keep their complete six-package
sets; `0.19.0` and newer require all eight.
Experimental `0.18.0` CI archives with eight manifests are source proof inputs,
not approved `0.18.0` publication inputs. The stager and publisher reject them
as release audits.

The [npm publication workflow](../.github/workflows/npm-publish.yml) is a
manual, native-first publisher. Its default is a read-only dry run. It uses
the fixed public registry `https://registry.npmjs.org/`, publishes prereleases
with the `next` tag, and publishes stable versions with `latest`. The
current free organisation needs public packages only; no paid npm service is
needed.

The trusted-publishing setup follows [npm's OIDC guidance][trusted-publishing].
The workflow uses Node `24.20.0` and npm `11.19.0`; trusted publishing requires
Node `22.14.0` or newer and npm `11.5.1` or newer.

## Release preparation

Choose the current reviewed commit on `main` and record its full SHA. The
workflow checks out that exact revision and refuses a short SHA, a different
workflow head, or a revision outside `origin/main` on a manual run.

```sh
git switch main
git pull --ff-only
git rev-parse HEAD
git merge-base --is-ancestor <reviewed-sha> origin/main
```

Read the version from `candidate.packageVersion` in
[`docs/research/release-notice-audit.json`](research/release-notice-audit.json).
The workflow version input must match it and must be valid semver. A stable
version uses the `latest` tag. The checked-in audit records that version's
archive coordinates, native proof results and exact archive hashes. Audits for
earlier versions are archived under [`docs/releases`](releases).

The native archives must be built and audited from the exact reviewed source
revision. Their package manifests contain the repository metadata required by
npm trusted publishing. Do not reuse, edit or repack archives from an earlier
version. The publication checkout must remain equivalent to the audited source
under `crates`, `packages` and `packaging`.

After the native package workflows and Windows runtime workflow pass for the
release PR head, generate the audit and its Markdown note. The read-only
[audit generator](../benchmarks/proofs/release-audit.mjs) finds the matching
successful runs and downloads their artifacts. It checks source trees,
provenance, package identities, member modes, and archive, binary and notice
hashes before writing either output. If a workflow job fails, use "Re-run all
jobs": the audit requires each package job's evidence to come from the run's
latest attempt.

For releases with Vitest browser support, also retain a passing
[Vitest browser proof](../.github/workflows/vitest-browser.yml) run for the
release source: Chromium and Firefox on all five hosts, including lifecycle
cases. Dispatch it manually from the release branch if path filters did not
start it. Manual dispatch also runs the latest Vitest 5 verdict checks on
Linux x64. Browser evidence supplements the native package audit; the audit
generator does not validate it.

First archive the previous version's audit JSON and Markdown under
`docs/releases/<previous-version>-audit.json` and `.md`.

```sh
node --test --test-isolation=none benchmarks/proofs/release-audit.test.mjs
node benchmarks/proofs/release-audit.mjs \
  --pr <release-pr> \
  --previous-audit docs/releases/<previous-version>-audit.json \
  --output work/release-audit
```

Use `--head <full-build-head-sha>` instead of `--pr` to audit a fixed revision.
`--pr` uses the current PR head and rejects artifacts built for an earlier
head. This matters after later audit or documentation commits. For example,
the retained PR #128 builds use head
`2dc97566ad29ed414798abb499e1f87c004d2279`.

To reuse downloaded evidence, add `--evidence <native-evidence-directory>`.
It must contain every native target directory for the release (seven from
`0.19.0`, five for older releases), each with `summary.json`,
`seshat-entry.tgz` and `seshat-<target>-release.tgz`, plus
`windows-runtime/windows-runtime-preflight/windows-runtime-preflight.json`
and `windows-runtime/windows-runtime-cli-evidence/windows-runtime-cli-evidence.json`.
The generator still reads GitHub run, job and artifact metadata to check the
coordinates. Without `--evidence`, its download directory must be empty.
Musl directories also retain `seshat.map`. Their summaries include the same
source/run/attempt provenance and archive identities as the existing targets.
The audit verifies static ELF bytes, additional notices against the committed
musl notice assets and provenance, audited Rust runtime input hashes, and the
retained link map hash. Common `BUILD.runtimeNotices.assets`, dependency and Rust
inventories must still match on every target. Musl notice bytes must equal the
common notice plus the audited musl additions.
An authenticated `gh` CLI and the repository's Git history are required.

Provide `--previous-archive <previous-linux-x64-release.tgz>` for a complete
dependency and runtime notice asset comparison. It can replace or accompany
`--previous-audit`; when both are supplied, the archive hash and version must
match the audit. Older audits may record only hashes, so comparisons report
unknown entry or asset details instead of assuming equality. Changed
dependencies or notices are reported for review, rather than rejected.
The JSON retains schema version 1 and records the complete version-specific
coordinate set used by the stager and publisher. `--issue <release-issue>` adds
the release issue number.

Review `work/release-audit/release-notice-audit.json` and
`work/release-audit/release-notice-audit.md`. Save the reviewed outputs as
`docs/research/release-notice-audit.json` and `.md`. Add any release-specific
notice explanation after inspecting the reported changes. Generated audit
status and remaining checks describe preparation only; they do not claim the
local install matrix or publication passed.

Before publication, manually run the [Release local install workflow](../.github/workflows/release-local-install.yml)
from the reviewed release branch or tag containing the candidate audit. Wait
for all seven targets to pass for `0.19.0` and newer (five for older releases),
and retain the run link with the release evidence.
The checkout's `crates`, `packages` and `packaging` source trees must match the
audit. Rebuild and update the audit if they differ; do not bypass that check.
This matrix validates the prepared archives and does not run on ordinary PRs.
Native package workflows continue to build and test changed source on PRs.

Retrieve the exact release archive files with the existing read-only stager. It
downloads the audit coordinates from public GitHub Actions artifacts, verifies
each size and SHA-256, checks source equivalence, and writes the staging
evidence used by the publisher.

```sh
export GH_TOKEN="$(gh auth token)"
mkdir -p work/npm-publishing
node benchmarks/proofs/release-local-archive-stager.mjs \
  --manifest docs/research/release-notice-audit.json \
  --output work/npm-publishing/archives \
  --evidence work/npm-publishing/archive-staging.json
node --test --test-isolation=none benchmarks/proofs/npm-publishing.test.mjs
node benchmarks/proofs/npm-publishing.mjs \
  --manifest docs/research/release-notice-audit.json \
  --archives work/npm-publishing/archives \
  --staging-evidence work/npm-publishing/archive-staging.json \
  --revision <reviewed-sha> \
  --version <version> \
  --report work/npm-publishing/dry-run.json
```

For `0.19.0` and newer the helper requires exactly these eight files:
`linux-x64.tgz`, `linux-arm64.tgz`, `darwin-x64.tgz`, `darwin-arm64.tgz`,
`win32-x64.tgz`, `linux-x64-musl.tgz`, `linux-arm64-musl.tgz`, and `entry.tgz`.
Older releases require the six files without musl. The reported order is the
five existing native packages, the two musl packages, then the entry package.
Inspect the report and the audit hashes before any write.

## Agent publication checkpoint

For agent-led publication, follow the [npm publication checkpoint](agents/delivery.md#npm-publication-checkpoint)
after preparation and the dry run. Present the prepared release and wait for
explicit maintainer approval before enabling publishing. If the release changes,
repeat the affected checks and obtain approval of the updated release.

## Trusted publishers already configured

The six existing package names already have a GitHub Actions trusted publisher.
The configuration for each existing package is:

| Field | Value |
| --- | --- |
| Organisation or user | `Binary-Balance` |
| Repository | `seshat` |
| Workflow filename | `npm-publish.yml` |
| Environment name | Leave blank unless a protected environment is added |

Direct `npm publish` is enabled and the environment is blank. The repository
has no GitHub environment, so the workflow does not rely on an approval gate.
The existing package names and their published rc.1 versions supplied the
initial package records; later versions use these trusted publishers directly.

The new musl names need a separate first-publication plan before this workflow
can publish all eight packages. [`npm trust` requires an existing package][npm-trust].
[Staged publishing][staged-publishing] also writes to the public registry: for a
new name it creates a public `0.0.0-stage` placeholder. It is not read-only name
reservation. No bootstrap route has been selected or authorised here. Resolve
package creation and publisher setup with the maintainer, including any public
placeholder writes, before enabling the first eight-package publication.
The existing final prepared-release approval checkpoint still applies.

npm also requires each package's `repository.url` to exactly identify this
GitHub repository before it will accept a GitHub trusted publish. Archives from
0.1.0 onwards contain that metadata through `packaging/release.mjs`. The archived
rc.1 packages predate it and remain unchanged.

The publish job alone has `id-token: write`; it has no `NPM_TOKEN` or other npm
write secret. With a public GitHub repository and public package, npm
automatically generates provenance for a trusted OIDC publish. See
[npm's provenance documentation][provenance] and [trusted-publishing
guidance][trusted-publishing].

## Subsequent workflow dispatch

From the current reviewed `main` head, open Actions → npm publication → Run
workflow. Enter the full current `main` commit SHA; it must equal the
workflow run's `GITHUB_SHA` and remain the workflow head:

1. the version from the current audit; and
2. leave **Publish after validation** unchecked.

On pull requests, the validate job runs the focused audit, target-set,
publisher, archive-stager and registry-install tests.
Archive staging and release dry-run validation run only on manual dispatch,
after the candidate audit has been prepared for the reviewed source.

On manual runs, the validate job stages the complete version-specific archive
set and checks hashes, source equivalence, package order, semver tag, and
publish flags. It has read-only
GitHub permissions and no npm write credentials. Review its `dry-run.json`
artifact. For agent-led publication, obtain the approval described above before
dispatching the same revision and version again with **Publish after validation**
checked. Only that publish job receives the OIDC permission.

Before the first npm write, the helper checks every package version on the
public registry. It then checks again immediately before each package publish.
After publishing or skipping every native package (seven from `0.19.0`), it
waits up to five minutes for their exact versions, matching tarball bytes and SLSA provenance
bundles to become publicly available. It retries pending records every ten
seconds, including missing versions, tarball HTTP 404s and missing provenance.
The deadline also aborts stalled requests and response bodies. Only then can
it publish the entry package. This gate checks availability; the consumer
checks below still verify signatures and provenance cryptographically.

If a run stops after publishing some packages, rerun the same reviewed
revision and version with publishing enabled. An existing version is skipped
only after its registry tarball is downloaded and its bytes and SHA-256 match
the staged archive. A different hash, a different size, a missing tarball URL,
or any other registry error fails the run. During the availability wait,
a byte mismatch fails immediately. A timeout leaves the entry package
unpublished and lists each pending native version and the missing record in
the publication error report. Native packages already published remain
available and can be skipped on the next run with the same approved inputs.
The helper never replaces an existing version, uses `--force`, or silently
treats an unverifiable partial publish as safe to continue.

## Post-publication validation

npm accepting a publication does not mean consumers can fetch it yet. Before
dispatching [Release registry install](../.github/workflows/release-registry-install.yml),
wait for the entry package's exact version, tarball and provenance records to
be publicly available too. Run the following checks for all eight packages
for `0.19.0` and newer (omit the two musl names for older releases);
if a record or download is still missing, wait and retry the read-only checks.
Do not republish or dispatch registry verification until they pass.

Check each public version against the fixed registry:

```sh
for package in \
  @binary-balance/seshat-linux-x64 \
  @binary-balance/seshat-linux-arm64 \
  @binary-balance/seshat-linux-x64-musl \
  @binary-balance/seshat-linux-arm64-musl \
  @binary-balance/seshat-darwin-x64 \
  @binary-balance/seshat-darwin-arm64 \
  @binary-balance/seshat-win32-x64 \
  @binary-balance/seshat; do
  npm view "${package}@<version>" version dist.tarball dist.integrity dist.attestations \
    --registry=https://registry.npmjs.org/ \
    --@binary-balance:registry=https://registry.npmjs.org/
done
```

Download each reported `dist.tarball` URL and compare its SHA-256 and byte
count with every audit coordinate. For example:

```sh
TARBALL_URL=<url-from-npm-view>
curl --fail --location "$TARBALL_URL" -o downloaded.tgz
sha256sum downloaded.tgz || shasum -a 256 downloaded.tgz
wc -c downloaded.tgz
```

Fetch each reported `dist.attestations.url` with `curl --fail`. Require its
`attestations` array to contain a `https://slsa.dev/provenance/v1` record with
a populated `bundle.dsseEnvelope` payload and signatures, including for the
entry package. Once version, archive-byte and provenance availability checks
pass, dispatch **Release registry install** from the reviewed release ref.
Retain its seven-host results with the release evidence for the new set.
The local and registry matrices add native Alpine x64 and ARM64 containers to
the existing five hosts. Alpine 3.24.2 images and Node `24.20.0` downloads are
pinned by SHA-256. The Alpine jobs skip historical six-package audits.
Consumers install no Rust toolchain, check musl selection,
and verify the installed native binary against the audit. Registry consumers
also compare every fetched archive's exact size/hash with the audit and run
`npm audit signatures` for the entry and selected native package.

On disposable consumers for each supported host, install the entry package at
the exact version and run the installed command:

```sh
mkdir npm-consumer-check && cd npm-consumer-check
npm init --yes
npm install --ignore-scripts --save-exact \
  @binary-balance/seshat@<version> \
  --registry=https://registry.npmjs.org/ \
  --@binary-balance:registry=https://registry.npmjs.org/
npm ci --ignore-scripts \
  --registry=https://registry.npmjs.org/ \
  --@binary-balance:registry=https://registry.npmjs.org/
npm exec --offline -- seshat --version
```

Confirm that the host-selected native package and the printed version match
the published version. In the same disposable consumer, run
`npm audit signatures --json --include-attestations` with the public default
and `@binary-balance` scope registry. npm verifies the registry signatures and
provenance bundles; require verified entries for the exact entry and selected
native package versions, each with a
`https://slsa.dev/provenance/v1` attestation bundle. See [npm audit
signatures][audit-signatures] and [npm provenance statements][provenance]. The
optional dependency matrix covers Linux x64/ARM64 with glibc or musl,
macOS x64/ARM64, and Windows x64; Windows remains the native Server 2022 x64
target described in the release audit.

After npm checks pass, create or update the GitHub release for the same
reviewed revision. Use a `v<version>` tag, the release note for that version,
and the complete exact staged archive set as assets. For a new release, for
example:

```sh
gh release create "v<version>" \
  --target <reviewed-sha> \
  --title "Seshat <version>" \
  --notes-file "docs/releases/<version>.md" \
  work/npm-publishing/archives/*.tgz
```

Substitute the chosen version in the tag, title and notes filename so the
release uses that version's notes.

If the tag or release already exists, inspect it first and upload only missing
assets. Do not substitute historical `0.0.0` archives or ordinary/standalone
archives for the current audit coordinates.

The workflow does not create GitHub tags or releases, rebuild fresh artifacts,
or change package contents.

[audit-signatures]: https://docs.npmjs.com/cli/v11/commands/npm-audit/
[provenance]: https://docs.npmjs.com/generating-provenance-statements/
[trusted-publishing]: https://docs.npmjs.com/trusted-publishers/

[npm-trust]: https://docs.npmjs.com/cli/v11/commands/npm-trust/#prerequisites
[staged-publishing]: https://docs.npmjs.com/staged-publishing/
