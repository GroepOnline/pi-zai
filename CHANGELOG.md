# Changelog

All notable changes to `@groeponline/pi-zai` are documented in this file.

## [Unreleased]

### Breaking Changes

### Added

- Release workflows now also publish `@groeponline/pi-zai` to GitHub Packages
  (`https://github.com/GroepOnline/pi-zai/pkgs/npm/pi-zai`) via a separate
  job (`scripts/ci/github-packages.sh`) so a mirror failure never blocks npmjs
  or the GitHub Release/tag. Re-run `Release` via `workflow_dispatch` to
  backfill a version that is already on npmjs.
- `/zai-usage` now shows a GLM Platform-rate equivalent broken down by
  uncached input, cached input, cache write, and output. It explicitly separates
  per-token price from each category's share of total session cost.

### Changed

- The published Pi entrypoint now preserves native Pi request identity by
  suppressing only the legacy `pi-zai/<version>` User-Agent and extension-added
  `Accept-Language` values. Caller-provided headers remain untouched and
  experimental `X-Session-Id` affinity stays opt-in.
- `/zai-transport` labels stored records as logical turns and its tool latency as
  summed tool time per turn, matching the actual storage semantics.
- Benchmark A3 now isolates affinity from prompt normalization by comparing
  A1 observe/off against A3 observe/experimental.
- Affinity gates use relative miss-rate reduction instead of a fixed five-point
  hit-rate gap that becomes impossible near a 98–99% baseline.
- A0 instructions now state that a native-Pi run cannot invoke pi-zai commands
  while the extension is disabled and must be captured externally.

### Fixed

- Default observe mode no longer exposes a pi-zai-specific client fingerprint to
  providers that may route or throttle requests by client headers.
- Benchmark documentation no longer attributes A2 prompt-normalization effects
  to A3 affinity.
- Transport output no longer presents average tool time per logical turn as if
  it were latency per individual tool execution.

### Removed

## [0.5.3] - 2026-07-22

### Fixed

- Corrected the documented Pi peer floor to `>=0.80.10` in the `/zai-capabilities` and `/zai-doctor` command output, and in `docs/getting-started.md` / `docs/troubleshooting.md`. These still reported `0.80.7` after the optional peer floor was raised in 0.5.0.

### Changed

- `.github/workflows/release.yml` now also triggers via `workflow_dispatch`, publishes with npm `registry-url` configured for trusted publishing, and skips GitHub release creation idempotently when `v<x>` already exists.
- `.github/workflows/publish-npm.yml` (manual tag-push fallback) now publishes with `--provenance` and the `id-token: write` permission, matching the primary release path.

## [0.5.2] - 2026-07-22

### Removed

- Dropped stale planning documents that described the now-completed Pi 0.80.7 integration: `CURSOR_IMPLEMENTATION_PLAN.md` (root) and `docs/pi-0.80.7-upgrade-plan.md` / `docs/pi-0.80.7-experimental-acceleration.md`. The work shipped in 0.5.0; the current docs set and git history remain the references. This keeps the published tarball focused on operator-facing documentation.

## [0.5.1] - 2026-07-22

### Changed

- Rewrote `docs/development.md` around this repository as the standalone source of truth (root-level layout, current scripts, automated release flow) and corrected the documented Pi floor to `>=0.80.10` everywhere (README badge and Development page).
- Hardened `.github/workflows/publish-npm.yml` as the manual tag-push fallback: SHA-pinned actions, `persist-credentials: false`, npm caching, and an idempotent skip when the version is already on npm.

### Added

- `scripts/worker-audit.mjs`, a filtered npm-audit gate for the optional `worker/telemetry` subproject. It fails CI on any high/critical advisory that is not explicitly documented in `DEFERRED`, and tolerates only the upstream-deferred `sharp <0.35.0` advisory (dev-only, pulled via `wrangler -> miniflare`, not present in the published tarball). CI now runs this instead of a bare `npm audit --audit-level=high`.

### Fixed

- CI no longer fails on the upstream-deferred worker `sharp` advisory while still catching any new high/critical worker dependency issue.

## [0.5.0] - 2026-07-14

### Breaking Changes

- Raised the optional Pi peer floor to `@earendil-works/pi-coding-agent >=0.80.7`.
- `isNativeZaiModel()` now means Pi-native providers only (`zai`, `zai-coding-cn`). Use managed-provider helpers for shared Platform diagnostics.

### Added

- Pi 0.80.7 development baseline with generated `EXTENSION_VERSION` single source of truth and `npm run check:version`.
- Capability resolution (`resolveZaiCapabilities`) for ownership, API family, dynamic-tool mode, thinking format, and affinity source.
- Request-boundary active-toolset capture with privacy-safe transition classification and cache-segment rotation for dynamic tool loads.
- Opt-in Adaptive Tool Loader (`zai.adaptiveTools`) with `off` (default), `observe`, and `manual` modes plus `zai_load_tools`.
- `/zai-capabilities` status view and opt-in live `/zai-capabilities probe` (synthetic requests only; results stored as local metadata).
- CI lanes for exact Pi 0.80.7 minimum and latest compatible Pi packages.
- Explicit China Coding Plan coverage for `zai-coding-cn` at `https://open.bigmodel.cn/api/coding/paas/v4` (catalog contract, docs, fixtures).

### Changed

- Authoritative toolset fingerprints are recomputed in `before_provider_request`, not only in `before_agent_start`.
- Session-affinity header injection skips case-insensitive duplicates and never prints affinity identifiers in doctor output.
- `/zai` and `/zai-doctor` report API family, dynamic-tool mode, toolset generation, and adaptive-tools mode.

### Fixed

- Extension runtime version no longer drifts from `package.json`.

## [0.4.1] - 2026-07-14

### Fixed

- Declared the Pi coding-agent host as an optional peer, preventing standalone extension installs from automatically provisioning Pi's full transitive dependency and install-script chain.
- Added consumer-install validation to CI and release publishing so future package changes cannot silently reintroduce host dependencies such as `@google/genai`, `protobufjs`, `freebuff`, `ws`, or `@mimo-ai/cli`.

## [0.4.0] - 2026-07-14

### Added

- Reproducible npm release workflow with package validation, provenance, tag, and GitHub Release creation.
- `npm run check:package` validates the published file set before release.

### Changed

- The default `preserveThinking` policy now leaves Pi's native Z.AI request unchanged. Current Pi releases send `clear_thinking=false` while thinking is enabled; users can still force `true` or `false` explicitly in settings.
- GLM-5.2 thinking levels now mirror Pi's current native catalog: `low`, `medium`, and `high` map to Z.AI `high`; `max` maps to Z.AI `max`; `minimal` is hidden.
- `/zai` now scopes session totals to Z.AI providers and labels uncached, cached, and cache-write tokens explicitly.
- `/zai-cache` now describes the current cache segment rather than calling it the full session.
- Throughput diagnostics now identify assistant stream-wall measurements accurately instead of labelling them as request TTFT or pure generation time.
- Benchmark gates and A3/A1 comparisons are grouped by variant and scenario. Even-sized samples use the mathematical median.
- Benchmark reports use persisted attempts recorded after run start rather than an older in-memory cache segment.

### Fixed

- `Session miss ratio` incorrectly used the latest request's miss ratio instead of the rolling segment ratio.
- All-zero usage objects from connection failures could overwrite the last successful cache sample and inflate request counts.
- Cache writes were omitted from the non-hit ratio.
- SQLite cleanup could overwrite existing daily rollups or repeatedly count rows across size-limit batches.
- Benchmark completion could count runs from a different scenario toward the current scenario's gate.
- `/zai-doctor`, the README, configuration docs, thinking docs, and cache docs described an obsolete `xhigh` mapping and the wrong `clear_thinking` default.
- The cache-affinity benchmark documentation incorrectly called fixed `X-Session-Id` the default even though `sessionAffinity` defaults to `off`.

## [0.3.0] - 2026-07-12

### Added

- Opt-in anonymous daily aggregate telemetry (`zai.telemetry.mode: aggregate`)
- `/zai-telemetry` command: `status`, `preview`, `enable`, `disable`, `upload`, `sync`
- Telemetry consent file at `~/.pi/agent/state/pi-zai/telemetry.consent.json`
- Client uploader with forbidden-field validation before POST
- Anonymous daily rollup helpers and `telemetry_uploads` tracking in SQLite
- Cloudflare Worker ingest scaffold (`worker/telemetry/`) → Analytics Engine `pi_zai_telemetry`

### Changed

- `zai.telemetry.mode` and optional `telemetry.ingestUrl` now read from settings (default `off`)
- `/zai-privacy preview` shows upload readiness when mode + consent are active
- Completed UTC days upload on session start or `/zai-telemetry sync`

## [0.2.0] - 2026-07-12

### Breaking Changes

- pi-zai no longer registers or unregisters Pi's native `zai` / `zai-coding-cn` providers
- `zai-platform` is not auto-registered; add via `models.json` manually
- Removed `PI_ZAI_*` environment overrides; use `settings.json` only

### Added

- Local SQLite metrics storage with memory fail-open fallback (`src/storage/`)
- HMAC project IDs keyed by local `local.secret` (never sent remotely)
- Request/query correlation and privacy-reduced attempt records
- `/zai-data` command for storage status, wipe, export, and vacuum
- Metrics config in `settings.json` (`zai.metrics.mode`, retention, size limits)
- PR #1 boundary tests: no remote telemetry endpoints or upload paths
- Native Pi provider boundary (PR #2): thinking normalization via `before_provider_request` only
- `isNativeZaiModel`, `normalizeZaiThinkingPayload` exports for tests and integrators
- Benchmark manifest A0-A3 with `/zai-benchmark` (PR #3)
- `/zai-privacy preview` local allowlist and future aggregate preview (not sent)
- `/zai-transport` local latency and error-category summary
- Safe prompt normalization when `zai.promptStability.mode: "safe"` and dynamic marker present
- Benchmark run tracking: `/zai-benchmark start|complete|status|report|gates` with SQLite `benchmark_runs`
- Benchmark turns measured from `attemptsBaseline` at run start; gates use per-scenario turn targets
- [Architecture](docs/architecture.md): stack role, request lifecycle, telemetry readiness table
- [Development](docs/development.md): build, test, benchmark, standalone sync
- Expanded [Security](docs/security.md) and marketing [README](README.md)

### Changed

- `X-Session-Id` cache affinity requires `zai.sessionAffinity: "experimental"` (default off)
- `/zai-data clear-all` also rotates the local project secret
- `/zai-doctor` treats Platform provider as optional; cache affinity reflects settings
- Attempt timing starts at `before_agent_start`; transport summary includes rolled-up attempts
- `/zai-data`, `/zai-transport`, `/zai-privacy` resolve project hash via cwd fallback

### Fixed

- Missing local attempt records when provider hooks skip `onPayload` (faux/tests)
- Transport summary ignored daily rollups after cleanup
- Privacy preview bucket upper-boundary off-by-one
- SQLite size enforcement now rolls up detail rows before deletion

### Removed

## [0.1.1] - 2026-07-12

### Added

- Z.AI compaction hooks on `session_before_compact` and `session_before_tree`
- Cache recommendations in `/zai-cache status` when hit ratio is low
- Prompt stability metrics in `/zai` (stable/volatile line counts, fingerprint)
- Footer throughput via native Pi `setStatus` (`statusTps`, last tok/s with optional session avg)
- Full throughput telemetry in `/zai` (last TPS, TTFT, session average)
- Full documentation set under `docs/`
- Coding Plan quota via monitor API in `/zai-usage` (5h / weekly / MCP windows)
- `X-Session-Id` cache-affinity and `User-Agent` headers on Z.AI provider requests
- Connection stability probe and Pi retry settings check in `/zai-doctor`
- Actionable connection-error hints on `agent_settled` after retries exhaust
- Live cache-affinity A/B benchmark (`npm run benchmark:cache-affinity`)
- Documented live cache-affinity benchmark snapshot
- Pi harness suite test for extension command registration, headers, and cache metrics

### Changed

- README restructured with quick start and documentation index
- `/zai` and `/zai-usage` show extension version; clamp invalid thinking levels for GLM-5.2

### Fixed

- TPS uses wall-clock duration (fixes bogus 757000 tok/s)
- Prompt stability resolves live from system prompt when hook snapshot missing

## [0.1.0] - 2026-07-12

### Added

- Pi extension package scaffold with Z.AI Platform API provider registration
- Implicit cache optimization layer (fingerprints, metrics, compaction policy, diagnostics)
- Slash commands: `/zai`, `/zai-endpoint`, `/zai-cache`, `/zai-usage`, `/zai-doctor`
- Cost-first defaults aligned with the then-assumed upstream behavior (`clear_thinking=true`, preserved thinking off)
- Initial GLM-5.2 thinking integration documentation
- README with install, security, cache, endpoint documentation

### Security

- Credential source names only in diagnostics output; API key values never printed
