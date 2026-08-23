import { describe, expect, it } from "vitest";
import { loadZaiConfig } from "./config.ts";
import { normalizeZaiThinkingPayload } from "./payload-normalizer.ts";

describe("normalizeZaiThinkingPayload", () => {
	const native = { ...loadZaiConfig(), preserveThinking: undefined };
	const forceClear = { ...loadZaiConfig(), preserveThinking: false };
	const forcePreserve = { ...loadZaiConfig(), preserveThinking: true };

	it("leaves Pi native preserved thinking unchanged by default", () => {
		const result = normalizeZaiThinkingPayload(
			{ thinking: { type: "enabled", clear_thinking: false } },
			native,
		);
		expect(result).toBeUndefined();
	});

	it("does not silently replace a future Pi native payload", () => {
		const result = normalizeZaiThinkingPayload(
			{ thinking: { type: "enabled", clear_thinking: true } },
			native,
		);
		expect(result).toBeUndefined();
	});

	it("forces clear_thinking=true only for an explicit false override", () => {
		const result = normalizeZaiThinkingPayload(
			{ thinking: { type: "enabled", clear_thinking: false } },
			forceClear,
		);
		expect(result?.thinking).toEqual({ type: "enabled", clear_thinking: true });
	});

	it("forces clear_thinking=false for an explicit true override", () => {
		const result = normalizeZaiThinkingPayload(
			{ thinking: { type: "enabled", clear_thinking: true } },
			forcePreserve,
		);
		expect(result?.thinking).toEqual({
			type: "enabled",
			clear_thinking: false,
		});
	});

	it("does not add clear_thinking when thinking is disabled", () => {
		const result = normalizeZaiThinkingPayload(
			{ thinking: { type: "disabled" } },
			forceClear,
		);
		expect(result).toBeUndefined();
	});

	it("preserves tools, tool_choice, tool_stream, and unknown fields", () => {
		const payload = {
			thinking: { type: "enabled", clear_thinking: false },
			tools: [{ type: "function", function: { name: "read" } }],
			tool_choice: "required",
			tool_stream: true,
			future_field: { nested: true },
		};
		const result = normalizeZaiThinkingPayload(payload, forceClear);
		expect(result).toMatchObject({
			tools: payload.tools,
			tool_choice: "required",
			tool_stream: true,
			future_field: { nested: true },
			thinking: { type: "enabled", clear_thinking: true },
		});
		expect(payload.thinking.clear_thinking).toBe(false);
	});

	it("fails open on non-object payloads", () => {
		expect(normalizeZaiThinkingPayload(null, forceClear)).toBeUndefined();
		expect(normalizeZaiThinkingPayload("x", forceClear)).toBeUndefined();
	});

	it("returns undefined when preserveThinking is undefined", () => {
		expect(
			normalizeZaiThinkingPayload(
				{
					thinking: { type: "enabled", clear_thinking: false },
					tool_choice: { type: "function", function: { name: "read" } },
				},
				native,
			),
		).toBeUndefined();
	});
	it("migrates GLM-5.3 thinking=disabled to enabled low effort", () => {
		const result = normalizeZaiThinkingPayload(
			{ thinking: { type: "disabled" } },
			native,
			"glm-5.3",
			"off",
		);
		expect(result).toMatchObject({
			thinking: { type: "enabled", clear_thinking: false },
			reasoning_effort: "low",
		});
	});

	it("fills missing GLM-5.3 reasoning_effort from the Pi level", () => {
		const result = normalizeZaiThinkingPayload(
			{ thinking: { type: "enabled", clear_thinking: false } },
			native,
			"glm-5.3",
			"high",
		);
		expect(result?.reasoning_effort).toBe("high");
		expect(result?.thinking).toEqual({
			type: "enabled",
			clear_thinking: false,
		});
	});

	it("maps GLM-5.3 xhigh/max family to max effort", () => {
		for (const level of ["xhigh", "max"] as const) {
			const result = normalizeZaiThinkingPayload(
				{ thinking: { type: "enabled", clear_thinking: false } },
				native,
				"glm-5.3",
				level,
			);
			expect(result?.reasoning_effort).toBe("max");
		}
	});

	it("does not rewrite an already-valid future Pi GLM-5.3 payload", () => {
		expect(
			normalizeZaiThinkingPayload(
				{
					thinking: { type: "enabled", clear_thinking: false },
					reasoning_effort: "max",
				},
				native,
				"glm-5.3",
				"max",
			),
		).toBeUndefined();
	});

	it("preserves explicit clear-thinking policy on GLM-5.3", () => {
		const result = normalizeZaiThinkingPayload(
			{ thinking: { type: "disabled" } },
			forceClear,
			"glm-5.3",
			"low",
		);
		expect(result).toMatchObject({
			thinking: { type: "enabled", clear_thinking: true },
			reasoning_effort: "low",
		});
	});
});
