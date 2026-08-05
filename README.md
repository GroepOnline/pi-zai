<p align="center">
  <img src="docs/images/pi-zai-hero.svg" alt="pi-zai: native Z.AI controls, cache visibility, and local diagnostics for Pi" width="100%" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@groeponline/pi-zai"><img src="https://img.shields.io/npm/v/@groeponline/pi-zai?style=flat-square&label=npm" alt="npm version" /></a>
  <a href="https://github.com/GroepOnline/pi-zai/pkgs/npm/pi-zai"><img src="https://img.shields.io/badge/GitHub%20Packages-pi--zai-24292f?style=flat-square" alt="GitHub Packages" /></a>
  <img src="https://img.shields.io/badge/Pi-%E2%89%A50.80.10-24292f?style=flat-square" alt="Pi 0.80.10 or newer" />
  <img src="https://img.shields.io/badge/Node-%E2%89%A522.19-24292f?style=flat-square" alt="Node 22.19 or newer" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-24292f?style=flat-square" alt="MIT license" /></a>
</p>

# pi-zai

A Pi extension for running Z.AI with visible cache behavior, native thinking diagnostics, and local operator metrics.

Pi already owns the agent loop, tools, sessions, streaming, and Z.AI provider. **pi-zai hooks into that existing path.** It does not proxy chat traffic, replace Pi's runtime, or create a second model client.

## Install

```bash
pi install npm:@groeponline/pi-zai
```

Also published to [GitHub Packages](https://github.com/GroepOnline/pi-zai/pkgs/npm/pi-zai) (see [Getting started](docs/getting-started.md) for the authenticated `@groeponline` registry setup).

Reload Pi, select a Z.AI model, and open the status view:

```text
/reload
/zai
```

Credentials stay in Pi's normal credential flow: `/login`, `auth.json`, `models.json`, or `ZAI_API_KEY`.

[Getting started →](docs/getting-started.md)

## What changes when the extension is loaded

<p align="center">
  <img src="docs/images/pi-zai-without-with.svg" alt="Comparison of native Pi with Z.AI and Pi with the pi-zai extension" width="100%" />
</p>

| Area | Native Pi + Z.AI | With pi-zai |
|---|---|---|
| Agent runtime | Pi | Still Pi |
| Provider and streaming | Pi's native Z.AI provider | Still Pi's native provider |
| Thinking | Pi selects and maps the level | Actual request fields are shown; optional explicit override only |
| Cache visibility | Usage fields are available internally | Full Z.AI session totals plus current-segment diagnostics |
| Diagnostics | General provider errors | `/zai-doctor`, transport summaries, retry guidance |
| Usage | Per-response usage and Pi Session Info | Z.AI-scoped totals, Coding Plan quota, Platform estimates |
| History | Session-scoped | Privacy-reduced local SQLite metrics |

## Operator commands

| Command | Purpose |
|---|---|
| `/zai` | Provider, endpoint, model, actual thinking payload, cache, throughput, tools, and Z.AI session usage |
| `/zai-cache` | Current cache segment, hit/miss ratios, fingerprints, and recommendations |
| `/zai-usage` | Z.AI session token totals, Coding Plan quota, or Platform cost estimates |
| `/zai-doctor` | Integration checks and optional connectivity/stability probes |
| `/zai-capabilities` | Capability resolution and opt-in live probes |
| `/zai-transport` | Local latency and controlled error-category summaries |
| `/zai-data` | Inspect, export, vacuum, or wipe local metrics |
| `/zai-privacy preview` | Show exactly what is stored locally and what could be aggregated |
| `/zai-benchmark` | Track A0–A3 cache-strategy experiments |

[Full command reference →](docs/commands.md)

## Native thinking, visible request behavior

pi-zai uses Pi's own thinking selector. There is no second `/zai-thinking` state to keep in sync.

For the current Pi GLM-5.2 catalog:

```text
Pi off                 → thinking disabled
Pi low / medium / high → reasoning_effort high
Pi max                 → reasoning_effort max
```

Current Pi releases send `clear_thinking=false` while Z.AI thinking is enabled. pi-zai now leaves that native payload unchanged by default. An explicit `preserveThinking: false` setting can force `clear_thinking=true`, but this may reduce reasoning continuity and cache reuse in long coding/tool sessions.

[Thinking details →](docs/thinking.md)

## Architecture

<p align="center">
  <img src="docs/images/pi-zai-architecture.svg" alt="Architecture showing pi-zai hooks around Pi's native Z.AI provider and local SQLite metrics" width="100%" />
</p>

The chat request still follows the normal Pi route:

```text
You → Pi agent runtime → Pi native Z.AI provider → Z.AI API
```

pi-zai adds lifecycle hooks for request inspection, optional explicit policy overrides, cache analysis, headers, diagnostics, and local metrics. It does not upload prompts or completions through a separate service.

[Architecture →](docs/architecture.md)

## Cache scopes

Pi's Session Info shows the complete session across all models and providers. `/zai` scans that session but includes Z.AI providers only. `/zai-cache` is intentionally narrower: it shows the current provider/model/system-prompt/toolset segment and resets when one of those boundaries changes.

This distinction prevents a model switch, extension reload, or new prompt/tool fingerprint from being presented as one continuous cache population. All-zero usage records from connection failures are ignored as cache samples.

[Cache optimization →](docs/cache-optimization.md)

## Local by default

Local metrics are enabled by default and stored under Pi's user directory:

```text
~/.pi/agent/state/pi-zai/metrics.sqlite3
~/.pi/agent/state/pi-zai/local.secret
```

Stored fields are limited to operational data such as token counts, latency, HTTP status, controlled error categories, local hashes, and short fingerprints. **Prompt text, source code, tool arguments, tool results, and raw error bodies are not stored.**

Retention is bounded and the data can be removed from Pi:

```text
/zai-data clear-project
/zai-data clear-details
/zai-data clear-all
```

Anonymous aggregate telemetry exists as an opt-in path and is off by default. It requires both configuration and explicit consent.

[Security and privacy →](docs/security.md)

## Essential configuration

```json
{
  "zai": {
    "sessionAffinity": "off",
    "promptStability": { "mode": "observe" },
    "metrics": { "mode": "local" },
    "telemetry": { "mode": "off" }
  }
}
```

| Setting | Default | Meaning |
|---|---:|---|
| `preserveThinking` | omitted | Leave Pi's native request unchanged; `true` or `false` are explicit overrides |
| `metrics.mode` | `local` | `off`, in-memory, or bounded SQLite storage |
| `promptStability.mode` | `observe` | Measure stable and volatile prompt sections without rewriting |
| `sessionAffinity` | `off` | Experimental `X-Session-Id` support when enabled |
| `adaptiveTools.mode` | `off` | Opt-in adaptive tool loading (`observe` / `manual`) |
| `telemetry.mode` | `off` | No remote aggregate uploads |

[Configuration reference →](docs/configuration.md)

## Endpoints

| Provider | Base URL | Billing |
|---|---|---|
| `zai` | `https://api.z.ai/api/coding/paas/v4` | Coding Plan (global) |
| `zai-coding-cn` | `https://open.bigmodel.cn/api/coding/paas/v4` | Coding Plan (China) |
| `zai-platform` | `https://api.z.ai/api/paas/v4` (manual `models.json`) | Metered Platform API |

pi-zai does not override Pi's built-in `zai` or `zai-coding-cn` providers. Register `zai-platform` in `models.json` only when you need the metered endpoint. Adaptive tools, cache segmentation, and `/zai-capabilities` follow whichever of these models is active.

## Documentation

- [Getting started](docs/getting-started.md)
- [Architecture](docs/architecture.md)
- [Cache optimization](docs/cache-optimization.md)
- [Thinking](docs/thinking.md)
- [Commands](docs/commands.md)
- [Configuration](docs/configuration.md)
- [Security and privacy](docs/security.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Development](docs/development.md)

## Development

```bash
npm install
npm run build
npm test
npm run lint
```

The extension targets Pi `>= 0.80.10` and Node.js `>= 22.19.0`.

## License

MIT — see [LICENSE](LICENSE).
