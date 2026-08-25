# Thinking

Thinking is controlled by **Pi's native model selector and request builder**. pi-zai does not register a second thinking command or maintain a separate thinking level.

## GLM-5.3 levels

GLM-5.3 changes the wire contract: thinking is mandatory and `reasoning_effort` is limited to `low`, `high`, or `max`. Z.AI recommends `max` for coding. pi-zai maps Pi's broader selector without creating a second state:

| Pi level | GLM-5.3 request |
|----------|-----------------|
| `off` / `minimal` / `low` | `thinking: { type: "enabled" }`, `reasoning_effort: "low"` |
| `medium` / `high` | `thinking: { type: "enabled" }`, `reasoning_effort: "high"` |
| `xhigh` / `max` | `thinking: { type: "enabled" }`, `reasoning_effort: "max"` |

The `off → low` migration is intentional: sending `thinking: { type: "disabled" }` to GLM-5.3 is invalid. Released Pi versions may know the `glm-5.3` model before their compatibility metadata fully reflects this contract, so pi-zai fixes only an invalid or incomplete 5.3 request at `before_provider_request`. When Pi emits `thinking: enabled` plus a valid effort itself, the compatibility layer is a no-op.

The released Coding Plan catalog also includes `glm-5.2-highspeed`.

## GLM-5.2 levels

The current Pi GLM-5.2 catalog maps its selectable levels to the two Z.AI reasoning efforts:

| Pi level | Z.AI request |
|----------|--------------|
| `off` | `thinking: { type: "disabled" }` |
| `low` | `thinking: { type: "enabled", clear_thinking: false }`, `reasoning_effort: "high"` |
| `medium` | `thinking: { type: "enabled", clear_thinking: false }`, `reasoning_effort: "high"` |
| `high` | `thinking: { type: "enabled", clear_thinking: false }`, `reasoning_effort: "high"` |
| `max` | `thinking: { type: "enabled", clear_thinking: false }`, `reasoning_effort: "max"` |

`minimal` is hidden for GLM-5.2. The extension's optional Platform model catalog mirrors Pi's native mapping rather than inventing an `xhigh` level.

Control the level through Pi:

- footer/model-selector cycle
- `--thinking` CLI flag
- SDK `thinkingLevel`
- RPC or JSON equivalents

`/zai` shows both the active Pi level and the actual mapped request fields.

## Preserved thinking

Z.AI recommends preserved thinking for coding and agent workflows. Historical reasoning blocks must be returned complete and unmodified for reasoning continuity and cache reuse.

Current Pi releases already send:

```text
clear_thinking = false
```

when Z.AI thinking is enabled. **pi-zai now leaves that native payload unchanged by default.**

The `zai.preserveThinking` setting is an explicit override:

| Setting | Behavior |
|---------|----------|
| omitted | Leave Pi's native request unchanged |
| `true` | Force `clear_thinking: false` while thinking is enabled |
| `false` | Force `clear_thinking: true` while thinking is enabled |

Example only when an override is required:

```json
{
  "zai": {
    "preserveThinking": false
  }
}
```

Forcing `false` clears earlier reasoning on each request. This can reduce payload history, but it can also reduce reasoning continuity and cache reuse in long coding/tool sessions. It is no longer the extension default.

For models that still support disabled thinking, pi-zai leaves Pi's native `thinking: { type: "disabled" }` payload untouched. GLM-5.3 is the deliberate exception because Z.AI rejects disabled thinking for that model.

## Interleaved tool use

Z.AI can reason between tool calls and after tool results. Pi stores streamed thinking blocks in assistant messages and replays them through its native Z.AI message conversion. pi-zai does not rewrite those blocks.

## Compaction boundary

Preserved thinking applies to normal multi-turn history. At a Pi compaction boundary, pi-zai supplies deterministic summary instructions focused on durable project facts, visible decisions, tool outcomes, and current progress. The compacted summary is not a replay of hidden reasoning.

## Tool streaming

Models with `zaiToolStream: true` request streamed tool-call output. `/zai` reports whether that compatibility flag is enabled for the selected model.
