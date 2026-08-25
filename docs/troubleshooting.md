# Troubleshooting

## `Connection error` / `Recv failure` / `fetch failed`

Pi retries retryable agent failures, while provider-SDK retry settings are configured separately. A dropped connection can therefore produce an assistant entry with all-zero usage before a later retry succeeds.

pi-zai ignores those all-zero entries as cache samples, but records controlled transport categories locally when metrics are enabled.

Recommended checks:

1. Run `/zai-doctor` for the three-request connection-stability probe and Pi retry-settings check.
2. Add provider retries in `~/.pi/agent/settings.json` when appropriate:

```json
{
  "retry": {
    "enabled": true,
    "maxRetries": 5,
    "baseDelayMs": 2000,
    "provider": {
      "maxRetries": 2,
      "maxRetryDelayMs": 60000
    }
  }
}
```

3. Compare `/zai-endpoint coding` and `/zai-endpoint platform` when both are configured; network paths can behave differently.
4. Temporarily remove VPN or proxy layers and verify firewall/DNS access to `api.z.ai`.
5. Inspect `/zai-transport` after several requests rather than treating one failed turn as a provider-wide conclusion.

After retries are exhausted, pi-zai shows an actionable connection hint through `agent_settled`.

## `/zai-doctor` network probe fails

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| `No credentials` | Key not available through Pi auth | Configure `/login`, `auth.json`, `models.json`, or `ZAI_API_KEY` |
| HTTP 401 | Invalid or rotated credential | Replace the key |
| HTTP 403 | Product, account, or regional restriction | Check the selected endpoint and account entitlement |
| Coding Plan connection drop | Network path to the `/coding/` endpoint | Compare Platform, VPN, proxy, DNS, and firewall behavior |
| Timeout | Slow or unstable route | Retry and test the base endpoint outside Pi |

## Cache totals do not match Pi Session Info

This can be correct because the tools use different scopes:

- Pi Session Info includes every provider and model used in the complete session.
- `/zai` includes Z.AI providers only, but can span multiple Z.AI models and segments.
- `/zai-cache` includes the current provider/model/system-prompt/toolset segment only.

A provider or model switch, extension restart, changed stable-prompt fingerprint, or changed active toolset starts a new `/zai-cache` segment. Use the labels and scopes instead of comparing raw totals as if they represented the same population.

## Last request shows `0.0%` after a connection failure

Versions before the current fix could replace the last successful cache snapshot with an all-zero usage record emitted by a failed connection. The corrected implementation ignores zero-prompt usage for cache sampling.

After updating and reloading, `/zai-cache` reports the last **successful** request with non-empty prompt usage.

## Low cache hit ratio

1. Run `/zai-cache status` and confirm that enough successful requests exist in the current segment.
2. Keep the model, endpoint, system prompt, and active toolset stable when possible.
3. Move recognized volatile system content below an explicit `--- dynamic context ---` marker.
4. Use `promptStability.mode: observe` first; enable `safe` only after inspecting the prompt layout.
5. Preserve historical reasoning exactly for normal Z.AI coding/tool workflows unless you intentionally accept the trade-off of clearing it.
6. Distinguish genuine cache misses from new context after compaction or model/provider changes.

## Unexpected `clear_thinking` value

Run `/zai`. The corrected status distinguishes three policies:

- `false (Pi native)` — no `preserveThinking` setting is present; current Pi behavior is unchanged.
- `false (forced preserved via settings)` — `zai.preserveThinking: true`.
- `true (forced clear via settings)` — `zai.preserveThinking: false`.

Remove `preserveThinking` from settings to return to native Pi behavior. Do not set it to `false` merely to obtain caching; preserved thinking is intended to support reasoning continuity and cache reuse in Z.AI coding workflows.

## Thinking level looks different from older documentation

Current Pi maps GLM-5.2 as follows:

```text
low / medium / high → reasoning_effort high
max                 → reasoning_effort max
```

Older pi-zai documentation referred to `xhigh`; that no longer reflects the current Pi model catalog.

## Extension not loading

- Pi version must be at least `0.84.2` for this release.
- Run `/reload` after installing or updating.
- Inspect Pi's extension startup errors.
- Confirm that the installed npm version contains the desired fix; a GitHub merge alone does not update an existing npm installation.

## Platform cost shows `$0.00`

Coding Plan models intentionally have zero per-token prices in Pi's model catalog and are reported as `subscription-managed`. Metered estimates require a correctly registered `zai-platform` model with pricing metadata.

## Coding Plan versus Platform confusion

`/zai` derives the active endpoint from the selected model's provider. There is no separate hidden endpoint toggle. Use `/zai-endpoint` or Pi's model picker.

| Provider | Base URL | Label |
|----------|----------|-------|
| `zai` | `https://api.z.ai/api/coding/paas/v4` | `coding` |
| `zai-coding-cn` | `https://open.bigmodel.cn/api/coding/paas/v4` | `coding-cn` |
| `zai-platform` | metered Platform URL in `models.json` | `platform` |

China Coding Plan (`zai-coding-cn`) is fully supported: credentials via `ZAI_CODING_CN_API_KEY`, quota monitor against `open.bigmodel.cn`, and the same cache/adaptive-tool behavior as global Coding Plan.

## Pi version too old

```bash
pi --version
```

Upgrade Pi before installing the extension when the version is below `0.84.2`.

## Adaptive tools leave required tools inactive

If `zai.adaptiveTools.mode` is `manual`, grouped tools start inactive until the model calls `zai_load_tools`.

Recovery options:

1. Ask the model to load the needed group, or call `/reload` after setting `adaptiveTools.mode` to `off`.
2. Confirm the group name exists under `zai.adaptiveTools.groups`.
3. Check `/zai` for adaptive mode and toolset generation; `/zai-doctor` reports unsupported `adaptive`/`strict` fallbacks.
4. Remember: pi-zai only activates already-registered Pi/extension tools. It cannot proxy arbitrary foreign tool implementations.

Switching away from a managed Z.AI model restores the controlled tool state. If Pi's tool registry is temporarily unavailable during restoration, pi-zai fails open so the model switch or session shutdown still completes.

## Cache segment churn after tool loading

On Z.AI, dynamically activated tools use Pi's full-list fallback. The next provider request includes the expanded tool list and pi-zai starts a new cache segment once.

This is expected. Look for `/zai-cache` reasons that mention `toolset:` or a changed toolset fingerprint. Stable toolsets should not reset the segment.

## Duplicate or missing `X-Session-Id`

- Default `sessionAffinity` is `off`.
- `observe` never injects a header.
- `experimental` adds `X-Session-Id` only when no case-insensitive upstream affinity header is already present.
- `/zai-doctor` confirms whether affinity is enabled without displaying the identifier.

## `/zai-capabilities probe` surprises

Probes are never automatic. They require an explicit `/zai-capabilities probe` confirmation and may bill for short synthetic requests. Unsupported `tool_choice` values can return HTTP 4xx; that disables assuming those values in production. Results expire when the model, endpoint, Pi peer floor, or extension version changes.
