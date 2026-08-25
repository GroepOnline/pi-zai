import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { computeCacheRatios } from "../cache/metrics.ts";
import {
	buildPlatformModelCatalog,
	GLM52_PRICING_BASIS,
} from "../model-catalog.ts";
import { computeUsageCostBreakdown } from "../usage-cost.ts";
import {
	fetchQuotaLimit,
	formatQuotaLimit,
	monitorBaseFromModelUrl,
} from "../usage-monitor.ts";
import { getCacheMetricsStore } from "./cache-state.ts";
import type { ZaiCommandDeps } from "./deps.ts";
import {
	formatDollarCost,
	formatPercent,
	formatTokens,
	formatUsageLine,
	getLastAssistantUsage,
	getSessionUsageTotals,
	isEstimatedCost,
	isSubscriptionManaged,
	requireZaiModel,
} from "./helpers.ts";

function formatContribution(
	label: string,
	cost: number,
	share: number,
): string {
	return `  ${label}: ${formatDollarCost(cost)} (${formatPercent(share)} of equivalent total)`;
}

function equivalentHeading(
	modelId: string,
	subscriptionManaged: boolean,
): string {
	if (modelId === "glm-5.2" && GLM52_PRICING_BASIS === "glm-5.1-rate-proxy") {
		return subscriptionManaged
			? "GLM-5.1-rate proxy (comparison only; not your Coding Plan bill)"
			: "GLM-5.1-rate proxy (GLM-5.2 is not in the public pricing table)";
	}
	return subscriptionManaged
		? "Platform-rate equivalent (comparison only; not your Coding Plan bill)"
		: "Metered cost contribution";
}

export function registerZaiUsageCommand(
	pi: ExtensionAPI,
	deps: ZaiCommandDeps,
): void {
	pi.registerCommand("zai-usage", {
		description: "Show native Pi usage with Z.AI cache and cost interpretation",
		handler: async (_args, ctx) => {
			const check = requireZaiModel(ctx);
			if ("error" in check) {
				ctx.ui.notify(check.error, "warning");
				return;
			}

			const model = check.model;
			const lastUsage = getLastAssistantUsage(ctx);
			const sessionTotals = getSessionUsageTotals(ctx);
			const cacheStats = getCacheMetricsStore().get();
			const sessionPrompt =
				sessionTotals.input +
				sessionTotals.cacheRead +
				sessionTotals.cacheWrite;
			const sessionRatios = computeCacheRatios({
				input: sessionTotals.input,
				cacheRead: sessionTotals.cacheRead,
				cacheWrite: sessionTotals.cacheWrite,
			});
			const rollingHitRatio =
				cacheStats && cacheStats.rolling.requests > 0
					? cacheStats.rolling.hitRatio
					: sessionRatios.hitRatio;

			const subscriptionManaged = isSubscriptionManaged(model);
			const costInterpretation = subscriptionManaged
				? "Dollar cost: subscription-managed (Coding Plan)"
				: isEstimatedCost(model)
					? `Estimated dollar cost: ${formatDollarCost(sessionTotals.cost)} (Platform API pricing metadata)`
					: "Dollar cost: unavailable";

			const platformModel = buildPlatformModelCatalog().find(
				(candidate) => candidate.id === model.id,
			);
			const equivalent =
				platformModel &&
				(platformModel.cost.input > 0 || platformModel.cost.output > 0)
					? computeUsageCostBreakdown(
							{
								input: sessionTotals.input,
								cacheRead: sessionTotals.cacheRead,
								cacheWrite: sessionTotals.cacheWrite,
								output: sessionTotals.output,
							},
							{
								input: platformModel.cost.input,
								cacheRead: platformModel.cost.cacheRead,
								cacheWrite: platformModel.cost.cacheWrite,
								output: platformModel.cost.output,
							},
						)
					: undefined;

			const lines = [
				"Z.AI usage",
				`Extension: @groeponline/pi-zai ${deps.extensionVersion}`,
				"",
				"Pi native token accounting",
				`  Requests: ${sessionTotals.requests}`,
				`  Uncached input: ${formatTokens(sessionTotals.input)}`,
				`  Cached input (cacheRead): ${formatTokens(sessionTotals.cacheRead)}`,
				`  Cache write: ${formatTokens(sessionTotals.cacheWrite)}`,
				`  Output: ${formatTokens(sessionTotals.output)}`,
				`  Total prompt: ${formatTokens(sessionPrompt)}`,
				"",
				"Z.AI interpretation",
				"  input = uncached prompt tokens",
				"  cacheRead = cached prompt tokens",
				"  total prompt = input + cacheRead + cacheWrite",
				`  Session hit ratio: ${formatPercent(sessionRatios.hitRatio)}`,
				`  Extension rolling hit ratio: ${formatPercent(rollingHitRatio)}`,
				`  ${costInterpretation}`,
			];

			if (subscriptionManaged) {
				lines.push(
					"  Coding Plan accounting: points-based; input, cached input, and output are charged separately by Z.AI.",
					"  Off-peak model calls use 50% of standard points outside Z.AI peak hours; Pi token totals remain diagnostics, not a local points bill.",
				);
			}

			if (equivalent) {
				lines.push(
					"",
					equivalentHeading(model.id, subscriptionManaged),
					formatContribution(
						"Uncached input",
						equivalent.uncachedInput.cost,
						equivalent.uncachedInput.share,
					),
					formatContribution(
						"Cached input",
						equivalent.cachedInput.cost,
						equivalent.cachedInput.share,
					),
					formatContribution(
						"Cache write",
						equivalent.cacheWrite.cost,
						equivalent.cacheWrite.share,
					),
					formatContribution(
						"Output",
						equivalent.output.cost,
						equivalent.output.share,
					),
					`  Equivalent total: ${formatDollarCost(equivalent.total)}`,
					`  Without cache: ${formatDollarCost(equivalent.noCacheEquivalent)}`,
					`  Cache savings: ${formatDollarCost(equivalent.cacheSavingsEquivalent)}`,
					"  Per-token price and total-cost share are different quantities.",
				);
			}

			lines.push(
				"",
				"Last request",
				lastUsage ? `  ${formatUsageLine(lastUsage)}` : "  none",
			);

			const monitorBase = monitorBaseFromModelUrl(model.baseUrl);
			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
			if (monitorBase && auth.ok && auth.apiKey) {
				const quota = await fetchQuotaLimit(monitorBase, auth.apiKey, {
					headers: auth.headers,
				});
				lines.push("");
				if (quota.ok) {
					lines.push(...formatQuotaLimit(quota.data));
				} else {
					lines.push(`Coding Plan quota unavailable: ${quota.error}`);
				}
			}

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
