# npm publication runbook

This runbook covers the six public packages in the `binary-balance` npm
organisation:

* `@binary-balance/seshat`
* `@binary-balance/seshat-linux-x64`
* `@binary-balance/seshat-linux-arm64`
* `@binary-balance/seshat-darwin-x64`
* `@binary-balance/seshat-darwin-arm64`
* `@binary-balance/seshat-win32-x64`

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
hashes before writing either output.

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
It must contain the five target directories, each with `summary.json`,
`seshat-entry.tgz` and `seshat-<target>-release.tgz`, plus
`windows-runtime/windows-runtime-preflight/windows-runtime-preflight.json`
and `windows-runtime/windows-runtime-cli-evidence/windows-runtime-cli-evidence.json`.
The generator still reads GitHub run, job and artifact metadata to check the
coordinates. Without `--evidence`, its download directory must be empty.
An authenticated `gh` CLI and the repository's Git history are required.

Provide `--previous-archive <previous-linux-x64-release.tgz>` for a complete
dependency and runtime notice asset comparison. It can replace or accompany
`--previous-audit`; when both are supplied, the archive hash and version must
match the audit. Older audits may record only hashes, so comparisons report
unknown entry or asset details instead of assuming equality. Changed
dependencies or notices are reported for review, rather than rejected.
The JSON retains schema version 1 and the six coordinates used by the stager
and publisher. `--issue <release-issue>` adds the release issue number.

Review `work/release-audit/release-notice-audit.json` and
`work/release-audit/release-notice-audit.md`. Save the reviewed outputs as
`docs/research/release-notice-audit.json` and `.md`. Add any release-specific
notice explanation after inspecting the reported changes. Generated audit
status and remaining checks describe preparation only; they do not claim the
local install matrix or publication passed.

Before publication, manually run the [Release local install workflow](../.github/workflows/release-local-install.yml)
from the reviewed release branch or tag containing the candidate audit. Wait
for all five targets to pass and retain the run link with the release evidence.
The checkout's `crates`, `packages` and `packaging` source trees must match the
audit. Rebuild and update the audit if they differ; do not bypass that check.
This matrix validates the prepared archives and does not run on ordinary PRs.
Native package workflows continue to build and test changed source on PRs.

Retrieve the exact six archive files with the existing read-only stager. It
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

The helper requires exactly these files: `linux-x64.tgz`, `linux-arm64.tgz`,
`darwin-x64.tgz`, `darwin-arm64.tgz`, `win32-x64.tgz`, and `entry.tgz`. Its
reported command order is the five native packages followed by the entry
package. Inspect the report and the audit hashes before any write.

## Agent publication checkpoint

For agent-led publication, follow the [npm publication checkpoint](agents/delivery.md#npm-publication-checkpoint)
after preparation and the dry run. Present the prepared release and wait for
explicit maintainer approval before enabling publishing. If the release changes,
repeat the affected checks and obtain approval of the updated release.

## Trusted publishers already configured

All six package names already have a GitHub Actions trusted publisher. The
configuration for each package is:

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

On pull requests, the validate job runs the publisher and archive-stager tests.
Archive staging and release dry-run validation run only on manual dispatch,
after the candidate audit has been prepared for the reviewed source.

On manual runs, the validate job stages all six archives and checks their
hashes, source equivalence, package order, semver tag, and publish flags. It has read-only
GitHub permissions and no npm write credentials. Review its `dry-run.json`
artifact. For agent-led publication, obtain the approval described above before
dispatching the same revision and version again with **Publish after validation**
checked. Only that publish job receives the OIDC permission.

Before the first npm write, the helper checks every package version on the
public registry. It then checks again immediately before each package publish.
After publishing or skipping the five native packages, it waits up to five
minutes for their exact versions, matching tarball bytes and SLSA provenance
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
be publicly available too. Run the following checks for all six packages;
if a record or download is still missing, wait and retry the read-only checks.
Do not republish or dispatch registry verification until they pass.

Check each public version against the fixed registry:

```sh
for package in \
  @binary-balance/seshat-linux-x64 \
  @binary-balance/seshat-linux-arm64 \
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
count with the six audit coordinates. For example:

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
Retain its five-host results with the release evidence.

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
optional dependency matrix covers Linux x64/ARM64, macOS x64/ARM64, and
Windows x64; Windows remains the native Server 2022 x64 target described in
the release audit.

After npm checks pass, create or update the GitHub release for the same
reviewed revision. Use a `v<version>` tag, the release note for that version,
and the six exact staged archives as assets. For a new release, for example:

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
archives for the six current audit coordinates.

The workflow does not create GitHub tags or releases, rebuild fresh artifacts,
or change package contents.

[audit-signatures]: https://docs.npmjs.com/cli/v11/commands/npm-audit/
[provenance]: https://docs.npmjs.com/generating-provenance-statements/
[trusted-publishing]: https://docs.npmjs.com/trusted-publishers/
