# Getting started

## Requirements

- Pi (`@earendil-works/pi-coding-agent`) `>= 0.84.2`
- Pi's built-in Z.AI providers (`zai`, `zai-coding-cn`)
- Node.js `>= 22.19.0`

## Install

Primary (public npmjs):

```bash
pi install npm:@groeponline/pi-zai
```

Optional mirror — [GitHub Packages](https://github.com/GroepOnline/pi-zai/pkgs/npm/pi-zai)
(requires a GitHub PAT or `GITHUB_TOKEN` with `read:packages`).

This remaps the **entire** `@groeponline` scope to GitHub Packages, not only
`pi-zai`. Prefer a user-level `~/.npmrc` (not a committed project `.npmrc`) so
other `@groeponline/*` packages on npmjs keep resolving normally:

```bash
# ~/.npmrc
@groeponline:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}

pi install npm:@groeponline/pi-zai
```

Then reload Pi:

```text
/reload
```

Contributors should use [Development](development.md) for repository installation and validation commands.

## Credentials

| Use | Environment variable | Provider | Base URL |
|-----|----------------------|----------|----------|
| Z.AI global Coding Plan | `ZAI_API_KEY` | `zai` | `https://api.z.ai/api/coding/paas/v4` |
| Coding Plan China | `ZAI_CODING_CN_API_KEY` | `zai-coding-cn` | `https://open.bigmodel.cn/api/coding/paas/v4` |
| Metered Platform (optional) | same `ZAI_API_KEY` via Pi | manual `zai-platform` in `models.json` | `https://api.z.ai/api/paas/v4` |

Configure credentials through Pi itself: `/login`, `~/.pi/agent/auth.json`, `models.json`, runtime `--api-key`, or environment variables. The extension does not add a separate credential resolver.

Optional shell layout:

```bash
# ~/.config/zai/credentials.env — chmod 600
export ZAI_API_KEY='...'
```

Never commit key values. pi-zai reports source names only, not secret values.

## First session

1. Select a Pi-native Z.AI model, such as `zai/glm-5.2` or China Coding Plan `zai-coding-cn/glm-5.2`.
2. Run `/zai-doctor` to check the model mapping, credential source, preserved-thinking policy, retry settings, and optional network probes.
3. Send several normal coding/tool turns.
4. Run `/zai` for Z.AI-scoped session totals (works for both global and China Coding Plan).
5. Run `/zai-cache status` for the current provider/model/prompt/toolset segment.
6. Compare with Pi Session Info only after accounting for the different scopes.

## Native thinking behavior

Do not add `preserveThinking` for a normal installation. When omitted, pi-zai leaves Pi's native Z.AI request unchanged. Current Pi releases use `clear_thinking=false` while thinking is enabled.

An override is available only for deliberate testing or policy changes:

```json
{
  "zai": {
    "preserveThinking": false
  }
}
```

This forces `clear_thinking=true` and can reduce reasoning continuity and cache reuse in longer coding/tool sessions. Remove the setting to restore native behavior.

## Choosing an endpoint

| Endpoint | Use when |
|----------|----------|
| Coding Plan (`zai`) | You have a Z.AI DevPack or Coding Plan subscription |
| Platform (`zai-platform`) | You manually registered a metered model with pricing metadata |

Switch through Pi's selected model:

```text
/zai-endpoint coding
/zai-endpoint platform
```

The active endpoint always follows the provider of the selected model. `zai-platform` is optional and is not registered automatically by pi-zai.

## Understanding cache output

- Pi Session Info: all providers and models in the complete session.
- `/zai`: Z.AI providers in the complete Pi session.
- `/zai-cache`: current provider/model/stable-prompt/toolset segment.

A connection error can create an all-zero assistant usage object. Corrected pi-zai versions ignore such objects as cache samples, so they do not replace the last successful request.

## Privacy check

```text
/zai-privacy preview
/zai-data status
/zai-telemetry status
```

Local metrics contain operational allowlisted fields, not prompt, source-code, reasoning, tool-argument, or tool-result text. Normal inference content still travels to Z.AI through Pi's native provider.

Remote aggregate telemetry remains off until aggregate mode and explicit consent are both enabled.

## Next steps

- [Architecture](architecture.md) — ownership, request lifecycle, and data paths
- [Security](security.md) — exact local and remote allowlists
- [Cache optimization](cache-optimization.md) — scopes, ratios, and prompt stability
- [Thinking](thinking.md) — current Pi mapping and explicit override behavior
- [Commands](commands.md) — full slash-command reference
- [Troubleshooting](troubleshooting.md) — connection, cache, and configuration issues
