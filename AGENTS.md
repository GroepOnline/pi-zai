# AGENTS.md

## Cursor Cloud specific instructions

### What this repo is

`@groeponline/pi-zai` is a **Pi extension** (a TypeScript ESM npm library), not a
standalone server. It hooks into Pi's agent loop to add Z.AI cache visibility,
request diagnostics, and local operator metrics (`/zai`, `/zai-cache`,
`/zai-data`, etc.). There is **no long-running service and no port to open** —
metrics persist to a local SQLite file via Node's built-in `node:sqlite`
(`~/.pi/agent/state/pi-zai/metrics.sqlite3`). A small optional Cloudflare Worker
lives in `worker/telemetry/` (its own `package.json`/lockfile); deploying it is
off by default and requires Cloudflare credentials.

### Node version (non-obvious)

The project requires **Node >= 22.19.0** (uses `node:sqlite`). The base VM's
default `node` (`/exec-daemon/node`) is older (22.14). Setup installs Node 22 via
nvm and symlinks `node`/`npm`/`npx` into `/usr/local/cargo/bin` (first on `PATH`)
so the correct version resolves for every command; the startup update script
re-asserts those symlinks. If `node --version` ever reports < 22.19, re-run:
`ln -sf "$(ls -d "$HOME"/.nvm/versions/node/v22.* | sort -V | tail -1)/bin"/{node,npm,npx} /usr/local/cargo/bin/`.

### Commands

Standard scripts (see `package.json` and `.github/workflows/ci.yml`):
`npm run lint` (Biome), `npm run build` (tsc → `dist/`), `npm test` (Vitest),
`npm run check:version`, `npm run check:package`, `npm run check:consumer-install`.
Worker: `npm run check --prefix worker/telemetry` (tsc `--noEmit`).
Tests are fully mock-based — no network, no LLM, no external services.

### Running / manually testing the extension

Full manual E2E inside a live Pi session needs a Z.AI model + credentials
(`ZAI_API_KEY` or `/login`) and an interactive TUI, so `pi -p` (print mode) will
hang waiting on a model provider when no key is configured. To exercise core
functionality without credentials, use `test/mock-extension-api.ts`:
`runExtensionLifecycle(pi, ctx, { skipShutdown: true })` then
`pi.executeCommand("zai-data", "status", ctx)` (see
`src/boundary.test.ts` — "records a local metric and reads it back via
/zai-data"). Query commands **before** `session_shutdown`, which tears down the
metrics store.

### Optional / gated

- Live cache-affinity benchmark (`npm run benchmark:cache-affinity`) needs a real
  `ZAI_API_KEY` and network.
- Telemetry worker deploy needs `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`.
- GitHub Packages mirror ([pkgs/npm/pi-zai](https://github.com/GroepOnline/pi-zai/pkgs/npm/pi-zai)):
  published by `release.yml` / `publish-npm.yml` with `packages: write`. Primary
  install path remains public npmjs; GH Packages needs `read:packages`. Cloud
  agent tokens often cannot read/write org packages — use Actions
  `workflow_dispatch` on **Release** to backfill, not a local `npm publish`.
