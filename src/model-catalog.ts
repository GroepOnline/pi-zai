import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";

export const PLATFORM_BASE_URL = "https://api.z.ai/api/paas/v4";

/**
 * Z.AI's public pricing table did not list GLM-5.2 when this catalog was
 * released. The GLM-5.2 comparison uses the published GLM-5.1 rates as a
 * transparent proxy and must never be presented as a verified GLM-5.2 bill.
 */
export const GLM52_PRICING_BASIS = "glm-5.1-rate-proxy" as const;
/** GLM-5.3 has no verified public per-token price in this catalog yet. */
export const GLM53_PRICING_BASIS = "unverified" as const;

/** Keep this aligned with Pi's native GLM-5.2 catalog. */
export const GLM52_THINKING_LEVEL_MAP = {
	minimal: null,
	low: "high",
	medium: "high",
	high: "high",
	max: "max",
} as const;

/** GLM-5.3 only accepts low/high/max and cannot disable thinking. */
export const GLM53_THINKING_LEVEL_MAP = {
	off: "low",
	minimal: "low",
	low: "low",
	medium: "high",
	high: "high",
	xhigh: "max",
	max: "max",
} as const;

const BASE_ZAI_COMPAT = {
	supportsStore: false,
	supportsDeveloperRole: false,
	thinkingFormat: "zai",
} as const;

/**
 * Kept for source compatibility. Preserved thinking is controlled by Pi's
 * native payload and the before_provider_request override, not model metadata.
 */
export type PlatformModelCatalogOptions = {
	preserveThinking?: boolean;
};

export function buildPlatformModelCatalog(
	_options: PlatformModelCatalogOptions = {},
): ProviderModelConfig[] {
	return [
		{
			id: "glm-5.3",
			name: "GLM-5.3",
			reasoning: true,
			thinkingLevelMap: GLM53_THINKING_LEVEL_MAP,
			input: ["text"],
			// Keep cost at zero until Z.AI publishes a verified Platform rate.
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 1_000_000,
			maxTokens: 131_072,
			compat: {
				...BASE_ZAI_COMPAT,
				supportsReasoningEffort: true,
				zaiToolStream: true,
			},
		},
		{
			id: "glm-5.2",
			name: "GLM-5.2",
			reasoning: true,
			thinkingLevelMap: GLM52_THINKING_LEVEL_MAP,
			input: ["text"],
			cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
			contextWindow: 1_000_000,
			maxTokens: 131_072,
			compat: {
				...BASE_ZAI_COMPAT,
				supportsReasoningEffort: true,
				zaiToolStream: true,
			},
		},
		{
			id: "glm-5.1",
			name: "GLM-5.1",
			reasoning: true,
			input: ["text"],
			cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
			contextWindow: 200_000,
			maxTokens: 131_072,
			compat: {
				...BASE_ZAI_COMPAT,
				supportsReasoningEffort: false,
				zaiToolStream: true,
			},
		},
		{
			id: "glm-5",
			name: "GLM-5",
			reasoning: true,
			input: ["text"],
			cost: { input: 1, output: 3.2, cacheRead: 0.2, cacheWrite: 0 },
			contextWindow: 200_000,
			maxTokens: 131_072,
			compat: {
				...BASE_ZAI_COMPAT,
				supportsReasoningEffort: false,
				zaiToolStream: true,
			},
		},
		{
			id: "glm-5-turbo",
			name: "GLM-5-Turbo",
			reasoning: true,
			input: ["text"],
			cost: { input: 1.2, output: 4, cacheRead: 0.24, cacheWrite: 0 },
			contextWindow: 200_000,
			maxTokens: 131_072,
			compat: {
				...BASE_ZAI_COMPAT,
				supportsReasoningEffort: false,
				zaiToolStream: true,
			},
		},
		{
			id: "glm-4.7",
			name: "GLM-4.7",
			reasoning: true,
			input: ["text"],
			cost: { input: 0.6, output: 2.2, cacheRead: 0.11, cacheWrite: 0 },
			contextWindow: 204_800,
			maxTokens: 131_072,
			compat: {
				...BASE_ZAI_COMPAT,
				supportsReasoningEffort: false,
				zaiToolStream: true,
			},
		},
		{
			id: "glm-4.7-flashx",
			name: "GLM-4.7-FlashX",
			reasoning: true,
			input: ["text"],
			cost: { input: 0.07, output: 0.4, cacheRead: 0.01, cacheWrite: 0 },
			contextWindow: 200_000,
			maxTokens: 128_000,
			compat: {
				...BASE_ZAI_COMPAT,
				supportsReasoningEffort: false,
				zaiToolStream: true,
			},
		},
		{
			id: "glm-4.5-air",
			name: "GLM-4.5-Air",
			reasoning: true,
			input: ["text"],
			cost: { input: 0.2, output: 1.1, cacheRead: 0.03, cacheWrite: 0 },
			contextWindow: 131_072,
			maxTokens: 98_304,
			compat: {
				...BASE_ZAI_COMPAT,
				supportsReasoningEffort: false,
			},
		},
	];
}
