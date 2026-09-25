# Configuration

## Settings file

Project: `.pi/settings.json`  
Global: `~/.pi/agent/settings.json` (via Pi `getAgentDir()`)

```json
{
  "zai": {
    "statusTps": true,
    "statusTpsAvg": false,
    "sessionAffinity": "off",
    "adaptiveTools": {
      "mode": "off",
      "alwaysActive": ["read", "grep", "find", "ls", "zai_load_tools"],
      "groups": {}
    },
    "promptStability": { "mode": "observe" },
    "metrics": {
      "mode": "local",
      "retentionDays": 30,
      "rollupRetentionDays": 180,
      "maxDatabaseBytes": 33554432
    },
    "telemetry": {
      "mode": "off",
      "ingestUrl": "https://api.chefgroep.online/pi-zai/telemetry/v1/aggregate"
    }
  }
}
```

Project settings override global settings. pi-zai does not read `PI_ZAI_*` environment variables.

How metrics and telemetry fit together: [Architecture](architecture.md). Allowlists and wipe commands: [Security](security.md).

## Adaptive tools (experimental)

Default `mode` is `off`. When enabled, pi-zai can keep a smaller initial active toolset and activate configured groups through `zai_load_tools` using Pi's `setActiveTools()` API.

| Mode | Behavior |
|------|----------|
| `off` | Native Pi toolset (default) |
| `observe` | Estimate deferred-schema impact; do not change active tools |
| `manual` | Register `zai_load_tools` and activate explicit groups additively |
| `adaptive` / `strict` | Accepted in settings but unsupported in 0.5.0; falls back to `observe` with a doctor warning |

Notes:

- Always-active names are resolved against tools that actually exist in the session.
- Grouped tools are deactivated only while a managed Z.AI model is active in `manual` mode; switching away restores the controlled tool state.
- Tools owned by other extensions and ungrouped builtins are never capped or removed.
- Lazy activation is additive. Z.AI still receives the full active tool list on the next request (Pi full-list fallback), and pi-zai rotates the cache segment once.
- `observe` records the configured tool count and estimated schema bytes without registering a loader or changing active tools.
- No extra model calls are made for tool selection in 0.5.0.

## Thinking override

`preserveThinking` is optional. Omitting it leaves Pi's native Z.AI request unchanged.

| Value | Behavior |
|-------|----------|
| omitted | Native Pi behavior; current Pi sends `clear_thinking=false` while thinking is enabled |
| `true` | Force preserved thinking (`clear_thinking=false`) |
| `false` | Force clearing historical reasoning (`clear_thinking=true`) |

Use an explicit override only when you deliberately want to differ from Pi:

```json
{
  "zai": {
    "preserveThinking": false
  }
}
```

For coding and agent workflows, Z.AI recommends preserved thinking. Forcing `false` may reduce reasoning continuity and cache reuse.

## Telemetry

| Setting | Default | Notes |
|---------|---------|-------|
| `telemetry.mode` | `off` | `aggregate` allows uploads after `/zai-telemetry enable` |
| `telemetry.ingestUrl` | production URL | Override for staging or self-hosted worker |

Consent is stored separately at `~/.pi/agent/state/pi-zai/telemetry.consent.json`. `/zai-telemetry disable` removes it without changing settings.

## Credentials (Pi native)

| Variable | Provider | Base URL |
|----------|----------|----------|
| `ZAI_API_KEY` | `zai` | `https://api.z.ai/api/coding/paas/v4` |
| `ZAI_CODING_CN_API_KEY` | `zai-coding-cn` | `https://open.bigmodel.cn/api/coding/paas/v4` |

Credentials resolve through Pi's `ModelRegistry`: `auth.json`, `models.json`, runtime `--api-key`, then env vars. pi-zai **does not** register or override Pi's built-in `zai` / `zai-coding-cn` providers.

Both Coding Plan endpoints are first-class for diagnostics, cache segmentation, adaptive tools, and `/zai-capabilities`. Pi 0.84.2 exposes `glm-5.3` and `glm-5.2-highspeed` on both catalogs. Pi 0.87 keeps those models on the global catalog and ships the China catalog as the GLM-5.3 family. Selecting `zai-coding-cn/glm-5.3` routes probes and usage monitors to `https://open.bigmodel.cn`.

## Platform API (optional)

pi-zai does **not** auto-register `zai-platform`. Add it manually in `models.json` if you need metered Platform billing. Use `buildPlatformModelCatalog()` from the package or copy models from [model-catalog.ts](../src/model-catalog.ts).

| Model | Context | Notes |
|-------|---------|-------|
| `glm-5.3` | 1M | Thinking mandatory; `low`/`high`/`max`; local pricing stays zero until a verified public Platform rate is available |
| `glm-5.2` | 1M | Pi `low`/`medium`/`high` → Z.AI `high`; Pi `max` → Z.AI `max` |
| `glm-5.1` | 200K | Tool streaming |
| `glm-5` | 200K | |
| `glm-5-turbo` | 200K | |
| `glm-4.7` | 204.8K | |
| `glm-4.7-flashx` | 200K | |
| `glm-4.5-air` | 131K | |

Pricing metadata follows [Z.AI pricing docs](https://docs.z.ai/guides/overview/pricing.md) (USD per 1M tokens).

## Reload behavior

On `/reload`, the extension:

1. reloads `zai` settings from disk
2. keeps Pi's native provider registry unchanged
3. keeps cache metrics unless a new session starts

## Session lifecycle hooks

| Hook | Behavior |
|------|----------|
| `session_start` | Init state; load settings; reset cache on new session; sync pending telemetry when opted in |
| `model_select` | Update endpoint and credential source |
| `before_agent_start` | Update cache segment fingerprints |
| `message_start` / `message_update` / `message_end` | Track assistant throughput (TPS, TTFT) |
| `turn_end` | Record non-empty provider usage metrics to local storage |
| `session_before_compact` | Inject Z.AI compaction instructions |
| `session_before_tree` | Inject Z.AI branch summary instructions |
| `session_compact` | Mark compaction timestamp |
| `before_provider_request` | Leave Pi native payload unchanged unless `preserveThinking` is explicitly set |
| `before_provider_headers` | Optional `X-Session-Id` when `sessionAffinity=experimental` |
