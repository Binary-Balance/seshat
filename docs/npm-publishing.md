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
with the `next` tag, and publishes the 0.1.0 stable version with `latest`. The
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
The workflow version input must match it and must be valid semver. This release
uses `0.1.0` and the `latest` tag. The checked-in audit records fresh 0.1.0
coordinates from PR50's synthetic merge source, including the native proof
results and exact archive hashes. The archived rc.1 record remains historical.

The fresh 0.1.0 native archives were built and audited from the exact reviewed
source revision. The new package manifests contain the repository metadata
required by npm trusted publishing. Do not reuse, edit or repack the archived
rc.1 bytes. The publication checkout must remain equivalent to the audited
source under `crates`, `packages` and `packaging`.

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
initial package records; 0.1.0 can use these trusted publishers directly.

npm also requires each package's `repository.url` to exactly identify this
GitHub repository before it will accept a GitHub trusted publish. The new 0.1.0
archives contain that metadata through `packaging/release.mjs`. The archived
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

1. the fresh audit version `0.1.0`; and
2. leave **Publish after validation** unchecked.

The validate job stages all six archives and checks their hashes, source
equivalence, package order, semver tag, and publish flags. It has read-only
GitHub permissions and no npm write credentials. Review its `dry-run.json`
artifact. For agent-led publication, obtain the approval described above before
dispatching the same revision and version again with **Publish after validation**
checked. Only that publish job receives the OIDC permission.

Before the first npm write, the helper checks every package version on the
public registry. It then checks again immediately before each package publish.
The native packages always precede the entry package.

If a run stops after publishing some packages, rerun the same reviewed
revision and version with publishing enabled. An existing version is skipped
only after its registry tarball is downloaded and its bytes and SHA-256 match
the staged archive. A different hash, a different size, a missing tarball URL,
or any registry error fails the run. The helper never replaces an existing
version, uses `--force`, or silently treats an unverifiable partial publish as
safe to continue.

## Post-publication validation

Check each public version and dist tag against the fixed registry:

```sh
for package in \
  @binary-balance/seshat-linux-x64 \
  @binary-balance/seshat-linux-arm64 \
  @binary-balance/seshat-darwin-x64 \
  @binary-balance/seshat-darwin-arm64 \
  @binary-balance/seshat-win32-x64 \
  @binary-balance/seshat; do
  npm view "${package}@<version>" version dist.tarball dist.integrity \
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

This command creates the stable `v0.1.0` release. Substitute the chosen version
in the tag, title and notes filename so the release uses that version's notes.

If the tag or release already exists, inspect it first and upload only missing
assets. Do not substitute historical `0.0.0` archives or ordinary/standalone
archives for the six current audit coordinates.

The workflow does not create GitHub tags or releases, rebuild fresh artifacts,
or change package contents.

[audit-signatures]: https://docs.npmjs.com/cli/v11/commands/npm-audit/
[provenance]: https://docs.npmjs.com/generating-provenance-statements/
[trusted-publishing]: https://docs.npmjs.com/trusted-publishers/
