# Development

Contributor and maintainer workflow. End users can skip this page.

## Repository layout

```text
src/           Extension source (TypeScript, strip-only)
dist/          Build output (published to npm; git-ignored, never committed)
docs/          User and operator documentation (shipped in the npm tarball)
worker/        Optional Cloudflare Worker telemetry ingest (its own lockfile)
scripts/       Version generation, consumer-install guard, secret scan,
               worker audit gate, and the live cache-affinity A/B benchmark
test/          Shared Vitest helpers
*.test.ts      Colocated unit tests (mock-only — no network, no LLM)
```

This repository (`GroepOnline/pi-zai`) is the **standalone source of truth** for releases: the published `@groeponline/pi-zai` npm package, the GitHub releases, and the `v*` tags all originate from `main` here.

## Requirements

- Node **>= 22.19.0** (uses the built-in `node:sqlite`).
- Pi packages **>= 0.84.2** (`@earendil-works/pi-coding-agent` is an optional peer and a devDependency for tests).

## Build and test

From the repository root:

```bash
npm install
npm run build          # tsc -> dist/ (also regenerates src/version.generated.ts)
npm test               # Vitest, fully mocked
npm run lint           # Biome
npm run check:version  # EXTENSION_VERSION matches package.json
npm run check:package  # npm pack --dry-run sanity check
npm run check:consumer-install
node scripts/worker-audit.mjs   # filtered audit gate for worker/telemetry
bash scripts/check-secrets.sh   # local secret-pattern guard
```

The optional worker has its own type check:

```bash
npm run check --prefix worker/telemetry   # tsc --noEmit
```

## CI

`.github/workflows/ci.yml` runs on every push to `main` and every pull request:

- `secrets` — gitleaks over the working tree plus the `check-secrets.sh` pattern guard.
- `test` — lint, build, unit tests, `check:package`, `check:consumer-install`, the worker type check, and the filtered `worker-audit.mjs` gate.
- `pi-minimum` — pins Pi packages to the exact `0.84.2` floor and rebuilds/tests.
- `pi-latest` — upgrades Pi packages to latest and rebuilds/tests (non-blocking).

## Local install in Pi

```bash
npm run build
pi install file:/absolute/path/to/this/repo
/reload
```

Project settings example (`.pi/settings.json`):

```json
{
  "zai": {
    "metrics": { "mode": "local" },
    "telemetry": { "mode": "off" }
  }
}
```

Opt-in remote telemetry: set `"telemetry": { "mode": "aggregate" }`, `/reload`, then `/zai-telemetry enable`.

## Live cache-affinity benchmark

Requires a real `ZAI_API_KEY` and network:

```bash
export ZAI_API_KEY='...'
npm run benchmark:cache-affinity
```

Optional JSON output: `PI_ZAI_AB_OUTPUT=/tmp/ab.json`.

This is separate from `/zai-benchmark` (manifest A0–A3, local SQLite run tracking).

## Boundary tests

Runtime guards in `src/boundary.test.ts` (mock-only — no LLM tokens, no network):

- Uses a fake `ExtensionAPI` and a global `fetch` spy; never starts a real Pi session.
- `runExtensionLifecycle()` fires `pi.on()` handlers from `index.ts` in-process (including tool execution hooks) to cover a typical session path.
- Full lifecycle does not call `fetch` when telemetry is off.
- Aggregate upload calls `fetch` only via `telemetry/uploader.ts`.
- Provider registration and `PI_ZAI_*` env overrides are verified at runtime.

Commands that can fetch (`/zai-doctor`, `/zai-usage`) are not exercised here; they require explicit user invocation. Tool hooks record names/durations/errors only — never args or results.

## Telemetry worker deploy

The worker is optional and off by default.

```bash
cd worker/telemetry
npm install
npm run check
npx wrangler deploy
```

Bind the route to the deployed worker and provide `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

### Worker audit gate

`scripts/worker-audit.mjs` is the filtered audit gate for the worker. The worker is private and excluded from the published npm tarball, and its only high-severity exposure is `sharp <0.35.0` pulled transitively via `wrangler -> miniflare` (upstream-deferred until Cloudflare ships a miniflare that uses `sharp >=0.35.0`). The gate tolerates only that advisory — documented with its owner and reason in `DEFERRED` — and fails CI on any other high/critical advisory. To tolerate a new advisory, add it to `DEFERRED` with a justification.

## Releases (maintainers)

Releases are **automated**. The workflow is:

1. Update `CHANGELOG.md` (`[Unreleased]` → `[x.y.z]` with a date) and bump `version` in `package.json`.
2. Commit and push to `main`.
3. `.github/workflows/release.yml` detects the `package.json` change, confirms the new version is not yet on each registry, runs the full quality gate, publishes to **npmjs.org** (provenance via OIDC trusted publishing, with an `NPM_TOKEN` fallback) **and** mirrors to **GitHub Packages** ([pkgs/npm/pi-zai](https://github.com/GroepOnline/pi-zai/pkgs/npm/pi-zai)), then creates the `vx.y.z` GitHub release and tag.

The release workflow is idempotent **per registry** — it skips cleanly if the version is already on that registry — so it is safe to re-run. Use **Actions → Release → Run workflow** (`workflow_dispatch`) to backfill GitHub Packages when npmjs already has the version. `.github/workflows/publish-npm.yml` is the manual `git push origin v<x>` fallback for explicit tag-driven releases (same dual-publish behavior).

Pre-flight (matches what `release.yml` runs):

```bash
npm run clean && npm run build && npm test
npm run lint && npm run check:version && npm run check:consumer-install
npm pack --dry-run
```

Breaking changes → minor or major bump; additive changes → minor; fixes and docs → patch.

## Pi compatibility matrix

- Development dependencies target Pi **0.84.2**.
- Optional peer: `@earendil-works/pi-coding-agent >=0.84.2`.
- CI runs `check:version`, an exact `pi-minimum` lane pinned to `0.84.2`, and a non-blocking `pi-latest` lane.
- Generate/check the runtime version with `npm run check:version` (also runs from `prebuild`).
