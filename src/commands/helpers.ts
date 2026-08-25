import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
	isCodingPlanProvider,
	isPlatformProvider,
	isZaiModel,
	isZaiProvider,
} from "../cache/context-policy.ts";
import { endpointLabel } from "../cache/metrics.ts";
import type { ZaiConfig } from "../config.ts";
import { formatPiCredentialSource } from "../credentials.ts";
import { glm53ReasoningEffort } from "../payload-normalizer.ts";
import type { ZaiModel } from "../zai-model.ts";

export type SessionUsageTotals = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	requests: number;
};

type ZaiOpenAICompat = {
	zaiToolStream?: boolean;
};

export function getZaiCompat(
	model: ZaiModel | undefined,
): ZaiOpenAICompat | undefined {
	return model?.compat as ZaiOpenAICompat | undefined;
}

export function formatPercent(ratio: number): string {
	return `${(ratio * 100).toFixed(1)}%`;
}

export function formatTokens(count: number): string {
	return count.toLocaleString("en-US");
}

export function formatDollarCost(amount: number): string {
	if (amount <= 0) return "$0.00";
	return `$${amount.toFixed(4)}`;
}

export function getEndpointLabel(model: ZaiModel): string {
	return endpointLabel(model.provider, model.baseUrl);
}

export function describeClearThinking(
	config: ZaiConfig,
	thinkingLevel: ThinkingLevel,
	model: ZaiModel | undefined,
): string {
	if (!model?.reasoning) {
		return "n/a (model has no reasoning)";
	}
	if (thinkingLevel === "off" && model.id !== "glm-5.3") {
		return "not sent (thinking disabled)";
	}
	if (config.preserveThinking === true) {
		return "false (forced preserved via settings)";
	}
	if (config.preserveThinking === false) {
		return "true (forced clear via settings)";
	}
	return "false (Pi native)";
}

export function describePreservedThinking(config: ZaiConfig): string {
	if (config.preserveThinking === true) {
		return "forced on via settings.json";
	}
	if (config.preserveThinking === false) {
		return "forced off via settings.json";
	}
	return "native Pi behavior";
}

export function describeThinkingPayload(
	config: ZaiConfig,
	thinkingLevel: ThinkingLevel,
	model: ZaiModel | undefined,
): string {
	if (!model?.reasoning) {
		return "thinking disabled (non-reasoning model)";
	}
	if (model.id === "glm-5.3") {
		const clearThinking = config.preserveThinking === false ? "true" : "false";
		const effort = glm53ReasoningEffort(thinkingLevel);
		return `type="enabled", reasoning_effort="${effort}", clear_thinking=${clearThinking} (GLM-5.3 compatibility)`;
	}
	if (thinkingLevel === "off") {
		return 'type="disabled"';
	}
	const clearThinking = config.preserveThinking === false ? "true" : "false";
	const levelMap = model.thinkingLevelMap;
	if (levelMap) {
		const mapped = levelMap[thinkingLevel];
		if (mapped === null) {
			return `not selectable (${thinkingLevel} disables thinking for ${model.id})`;
		}
		if (mapped === undefined) {
			return `not selectable (${model.id} has no mapping for ${thinkingLevel})`;
		}
		return `type="enabled", reasoning_effort="${mapped}", clear_thinking=${clearThinking}`;
	}
	return `type="enabled", reasoning_effort="${thinkingLevel}", clear_thinking=${clearThinking}`;
}

export function getLastAssistantUsage(
	ctx: ExtensionCommandContext,
): Usage | undefined {
	for (let i = ctx.sessionManager.getBranch().length - 1; i >= 0; i -= 1) {
		const entry = ctx.sessionManager.getBranch()[i];
		if (entry.type !== "message" || entry.message.role !== "assistant")
			continue;
		const assistant = entry.message as AssistantMessage;
		if (!isZaiProvider(assistant.provider)) continue;
		if (assistant.stopReason === "aborted" || assistant.stopReason === "error")
			continue;
		const promptTokens =
			assistant.usage.input +
			assistant.usage.cacheRead +
			assistant.usage.cacheWrite;
		if (promptTokens <= 0) continue;
		return assistant.usage;
	}
	return undefined;
}

export function getSessionUsageTotals(
	ctx: ExtensionCommandContext,
): SessionUsageTotals {
	const totals: SessionUsageTotals = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
		requests: 0,
	};

	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type !== "message" || entry.message.role !== "assistant")
			continue;
		const assistant = entry.message as AssistantMessage;
		if (!isZaiProvider(assistant.provider)) continue;
		const usage = assistant.usage;
		const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
		if (promptTokens <= 0 && usage.output <= 0) continue;
		totals.input += usage.input;
		totals.output += usage.output;
		totals.cacheRead += usage.cacheRead;
		totals.cacheWrite += usage.cacheWrite;
		totals.cost += usage.cost.total;
		totals.requests += 1;
	}

	return totals;
}

export function formatCredentialSource(
	provider: string,
	ctx: Pick<ExtensionCommandContext, "modelRegistry">,
): string {
	return formatPiCredentialSource(provider, ctx.modelRegistry);
}

export function isSubscriptionManaged(model: ZaiModel | undefined): boolean {
	return model !== undefined && isCodingPlanProvider(model.provider);
}

export function isEstimatedCost(model: ZaiModel | undefined): boolean {
	return (
		model !== undefined &&
		isPlatformProvider(model.provider) &&
		(model.cost.input > 0 || model.cost.output > 0)
	);
}

export function formatUsageLine(usage: Usage): string {
	const promptTotal = usage.input + usage.cacheRead + usage.cacheWrite;
	const hitRatio = promptTotal > 0 ? usage.cacheRead / promptTotal : 0;
	return [
		`uncached=${formatTokens(usage.input)}`,
		`cached=${formatTokens(usage.cacheRead)}`,
		`cacheWrite=${formatTokens(usage.cacheWrite)}`,
		`output=${formatTokens(usage.output)}`,
		`hit=${formatPercent(hitRatio)}`,
		`cost=${formatDollarCost(usage.cost.total)}`,
	].join(", ");
}

export function requireZaiModel(
	ctx: ExtensionCommandContext,
): { model: ZaiModel } | { error: string } {
	if (!ctx.model) {
		return { error: "No model selected. Choose a Z.AI model first." };
	}
	if (!isZaiModel(ctx.model)) {
		return {
			error: `Active model ${ctx.model.provider}/${ctx.model.id} is not a Z.AI provider.`,
		};
	}
	return { model: ctx.model };
}
