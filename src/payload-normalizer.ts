import type { ZaiConfig } from "./config.ts";

type ZaiThinkingPayload = {
	type?: string;
	clear_thinking?: boolean;
};

export type Glm53ReasoningEffort = "low" | "high" | "max";

/**
 * GLM-5.3 no longer supports disabling thinking. Map Pi's broader selector to
 * the nearest supported Z.AI effort, with `off` explicitly migrated to `low`
 * as required by Z.AI's GLM-5.3 migration guidance.
 */
export function glm53ReasoningEffort(
	thinkingLevel: string | undefined,
): Glm53ReasoningEffort {
	switch (thinkingLevel) {
		case "off":
		case "minimal":
		case "low":
			return "low";
		case "medium":
		case "high":
			return "high";
		default:
			return "max";
	}
}

function explicitClearThinking(config: ZaiConfig): boolean | undefined {
	return config.preserveThinking === undefined
		? undefined
		: !config.preserveThinking;
}

/**
 * Normalize only Z.AI request fields that pi-zai owns or must compatibility-fix.
 *
 * For normal Z.AI models, an omitted preserveThinking setting leaves Pi's
 * native payload unchanged. GLM-5.3 is the exception: Z.AI rejects
 * `thinking.type=disabled`, while released Pi catalogs can still emit it or
 * omit the new reasoning_effort metadata. The compatibility path is therefore
 * model-scoped, fail-closed to the documented low/high/max effort values, and
 * becomes a no-op once Pi emits a valid GLM-5.3 payload itself.
 */
export function normalizeZaiThinkingPayload(
	payload: unknown,
	config: ZaiConfig,
	modelId?: string,
	thinkingLevel?: string,
): Record<string, unknown> | undefined {
	if (payload === null || typeof payload !== "object") return undefined;

	const record = payload as Record<string, unknown>;
	const thinking = record.thinking as ZaiThinkingPayload | undefined;
	const explicitClear = explicitClearThinking(config);

	if (modelId === "glm-5.3") {
		const currentEffort = record.reasoning_effort;
		const validEffort =
			currentEffort === "low" ||
			currentEffort === "high" ||
			currentEffort === "max";
		const nextEffort = validEffort
			? currentEffort
			: glm53ReasoningEffort(thinkingLevel);
		const nextThinking: ZaiThinkingPayload = {
			...(thinking && typeof thinking === "object" ? thinking : {}),
			type: "enabled",
		};

		if (explicitClear !== undefined) {
			nextThinking.clear_thinking = explicitClear;
		} else if (
			thinking?.type !== "enabled" &&
			nextThinking.clear_thinking === undefined
		) {
			// Match Pi's preserved-thinking behavior when migrating an invalid
			// disabled payload to the mandatory enabled form.
			nextThinking.clear_thinking = false;
		}

		const unchanged =
			thinking?.type === "enabled" &&
			validEffort &&
			(explicitClear === undefined ||
				thinking.clear_thinking === explicitClear);
		if (unchanged) return undefined;

		return {
			...record,
			thinking: nextThinking,
			reasoning_effort: nextEffort,
		};
	}

	if (!thinking || typeof thinking !== "object") return undefined;
	if (thinking.type !== "enabled" || explicitClear === undefined)
		return undefined;
	if (thinking.clear_thinking === explicitClear) return undefined;

	return {
		...record,
		thinking: { ...thinking, clear_thinking: explicitClear },
	};
}
