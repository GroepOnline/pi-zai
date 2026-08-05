import { clampThinkingLevel } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { computeCacheRatios } from "../cache/metrics.ts";
import { resolveZaiCapabilities } from "../capabilities.ts";
import { resolvePromptStability } from "../prompt-stability.ts";
import {
	getToolExecutionTracker,
	getTpsTracker,
	sessionState,
} from "../state.ts";
import {
	formatTpsTelemetryLines,
	formatTurnThroughputLines,
} from "../telemetry/tps.ts";
import { formatToolSessionLines } from "../tool-tracker.ts";
import { getCacheMetricsStore } from "./cache-state.ts";
import type { ZaiCommandDeps } from "./deps.ts";
import {
	formatHeading,
	formatKeyValue,
	formatSection,
	joinCommandLines,
} from "./format.ts";
import {
	describeClearThinking,
	describePreservedThinking,
	describeThinkingPayload,
	formatCredentialSource,
	formatDollarCost,
	formatPercent,
	formatTokens,
	formatUsageLine,
	getEndpointLabel,
	getLastAssistantUsage,
	getSessionUsageTotals,
	getZaiCompat,
	requireZaiModel,
} from "./helpers.ts";

export function registerZaiStatusCommand(
	pi: ExtensionAPI,
	deps: ZaiCommandDeps,
): void {
	pi.registerCommand("zai", {
		description: "Show Z.AI provider status, thinking, cache, tools, and usage",
		handler: async (_args, ctx) => {
			const check = requireZaiModel(ctx);
			if ("error" in check) {
				ctx.ui.notify(check.error, "warning");
				return;
			}

			const model = check.model;
			const config = deps.getConfig(ctx.cwd);
			const rawThinkingLevel = pi.getThinkingLevel();
			const thinkingLevel = clampThinkingLevel(
				model,
				rawThinkingLevel,
			) as typeof rawThinkingLevel;
			if (thinkingLevel !== rawThinkingLevel) {
				pi.setThinkingLevel(thinkingLevel);
			}
			const credentialSource =
				(await deps.resolveCredentialSourceName(model.provider, ctx)) ??
				formatCredentialSource(model.provider, ctx);
			const lastUsage = getLastAssistantUsage(ctx);
			const sessionTotals = getSessionUsageTotals(ctx);
			const cacheStats = getCacheMetricsStore().get();
			const sessionPrompt =
				sessionTotals.input +
				sessionTotals.cacheRead +
				sessionTotals.cacheWrite;
			const sessionMissed = sessionTotals.input + sessionTotals.cacheWrite;
			const sessionHitRatio =
				sessionPrompt > 0
					? sessionTotals.cacheRead / sessionPrompt
					: (cacheStats?.rolling.hitRatio ?? 0);
			const lastHitRatio = lastUsage
				? computeCacheRatios(lastUsage).hitRatio
				: cacheStats?.last?.hitRatio;
			const toolStream =
				getZaiCompat(model)?.zaiToolStream === true ? "enabled" : "disabled";
			const capabilities = resolveZaiCapabilities(
				model,
				config.sessionAffinity,
			);
			const toolset = sessionState.lastToolsetTransition;
			const sessionCostLabel =
				sessionTotals.cost > 0
					? formatDollarCost(sessionTotals.cost)
					: model.provider === "zai-platform"
						? "$0.00"
						: "subscription-managed";
			const promptAnalysis = resolvePromptStability(
				ctx.getSystemPrompt(),
				sessionState.promptStability,
			);
			const tpsStats = getTpsTracker().get();
			const toolStats = getToolExecutionTracker().get();

			const lines = [
				...formatHeading("Z.AI status"),
				formatKeyValue(
					"Extension",
					`@groeponline/pi-zai ${deps.extensionVersion}`,
				),
				formatKeyValue("Provider", model.provider),
				formatKeyValue("Endpoint", getEndpointLabel(model)),
				formatKeyValue("Model", model.id),
				formatKeyValue(
					"Thinking",
					rawThinkingLevel === thinkingLevel
						? `${thinkingLevel} → ${describeThinkingPayload(config, thinkingLevel, model)}`
						: `${thinkingLevel} (clamped from ${rawThinkingLevel}) → ${describeThinkingPayload(config, thinkingLevel, model)}`,
				),
				formatKeyValue(
					"clear_thinking",
					describeClearThinking(config, thinkingLevel, model),
				),
				formatKeyValue("Preserved", describePreservedThinking(config)),
				formatKeyValue("Tool stream", toolStream),
				formatKeyValue("API family", capabilities.apiFamily),
				formatKeyValue("Dynamic tools", capabilities.dynamicToolMode),
				formatKeyValue(
					"Toolset",
					toolset
						? `gen ${sessionState.toolsetGeneration}; ${toolset.classification}; ${toolset.nextCount} tools`
						: `gen ${sessionState.toolsetGeneration}; pending`,
				),
				formatKeyValue(
					"Adaptive tools",
					config.adaptiveTools.unsupportedMode
						? `${config.adaptiveTools.requestedMode} → observe`
						: config.adaptiveTools.mode,
				),
				formatKeyValue(
					"Adaptive observation",
					sessionState.adaptiveTools?.observation
						? `${sessionState.adaptiveTools.observation.deferredCount} configured active tools; ~${sessionState.adaptiveTools.observation.estimatedDeferredSchemaBytes} schema bytes`
						: "none",
				),
				formatKeyValue("Credentials", credentialSource),
				formatKeyValue("Metrics", config.metrics.mode),
				formatKeyValue("Telemetry", config.telemetryMode),
				formatKeyValue("Affinity", config.sessionAffinity),
				formatKeyValue(
					"Request identity",
					"native Pi headers (pi-zai identity suppressed)",
				),
				formatKeyValue("Prompt mode", config.promptStabilityMode),
				...formatSection("Last successful Z.AI usage", [
					lastUsage ? formatUsageLine(lastUsage) : "none",
				]),
				...formatSection("Throughput", [
					...formatTpsTelemetryLines(tpsStats),
					...formatTurnThroughputLines(tpsStats.turn),
				]),
				...formatSection("Tools", formatToolSessionLines(toolStats)),
				...formatSection("Cache", [
					`Last successful request hit ratio: ${lastHitRatio !== undefined ? formatPercent(lastHitRatio) : "n/a"}`,
					`Z.AI session prompt: ${formatTokens(sessionPrompt)} (${formatTokens(sessionTotals.cacheRead)} cached, ${formatTokens(sessionMissed)} uncached/write)`,
					`Z.AI session hit ratio: ${formatPercent(sessionHitRatio)}`,
					`Z.AI session cost: ${sessionCostLabel}`,
				]),
				...formatSection(
					"Prompt stability",
					promptAnalysis
						? [
								`Stable lines: ${promptAnalysis.stableLineCount}`,
								`Volatile lines: ${promptAnalysis.volatileLineCount}`,
								`Dynamic marker: ${promptAnalysis.hasDynamicMarker ? "yes" : "no"}`,
								`Fingerprint: ${promptAnalysis.systemFingerprint ?? cacheStats?.segment.systemFingerprint ?? "pending"}`,
							]
						: ["pending (send a Z.AI request first)"],
				),
			];

			ctx.ui.notify(joinCommandLines(lines), "info");
		},
	});
}
