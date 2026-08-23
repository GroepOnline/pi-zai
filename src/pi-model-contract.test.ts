import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import { describe, expect, it } from "vitest";
import { isCodingPlanProvider } from "./cache/context-policy.ts";
import { resolveZaiCapabilities } from "./capabilities.ts";
import {
	isManagedZaiModel,
	isNativeZaiModel,
	isPiNativeZaiProvider,
	isZaiCodingPlanAliasProvider,
} from "./native-zai.ts";
import { inferEndpoint, isZaiProvider } from "./state.ts";
import type { ZaiModel } from "./zai-model.ts";

const GLOBAL_CODING_BASE = "https://api.z.ai/api/coding/paas/v4";
const CN_CODING_BASE = "https://open.bigmodel.cn/api/coding/paas/v4";

function asModelList(value: unknown): ZaiModel[] {
	if (Array.isArray(value)) return value as ZaiModel[];
	if (value && typeof value === "object") {
		return Object.values(value as Record<string, ZaiModel>);
	}
	return [];
}

function expectGlm52Contract(
	model: ZaiModel | undefined,
	provider: "zai" | "zai-coding-cn",
	baseUrl: string,
): void {
	expect(model).toBeTruthy();
	expect(model?.api).toBe("openai-completions");
	expect(model?.provider).toBe(provider);
	expect(model?.baseUrl).toBe(baseUrl);
	const compat = model?.compat as Record<string, unknown> | undefined;
	expect(compat?.thinkingFormat).toBe("zai");
	expect(compat?.zaiToolStream).toBe(true);
	expect(model?.thinkingLevelMap).toMatchObject({
		low: "high",
		medium: "high",
		high: "high",
		max: "max",
	});
	expect(isPiNativeZaiProvider(model?.provider)).toBe(true);
	expect(isNativeZaiModel(model)).toBe(true);
	expect(isManagedZaiModel(model)).toBe(true);
	expect(isZaiProvider(model?.provider)).toBe(true);
	const caps = resolveZaiCapabilities(model);
	expect(caps.providerOwnership).toBe("pi-native");
	expect(caps.apiFamily).toBe("openai-completions");
	expect(caps.dynamicToolMode).toBe("full-list-fallback");
	expect(caps.usesZaiThinkingFormat).toBe(true);
	expect(caps.streamsToolCalls).toBe(true);
	expect(caps.toolChoiceSupportedByApi).toBe(false);
}

function expectCurrentGlm53Contract(
	model: ZaiModel | undefined,
	provider: "zai" | "zai-coding-cn",
	baseUrl: string,
): void {
	expect(model).toBeTruthy();
	expect(model?.api).toBe("openai-completions");
	expect(model?.provider).toBe(provider);
	expect(model?.baseUrl).toBe(baseUrl);
	expect(model?.contextWindow).toBe(1_000_000);
	expect(model?.maxTokens).toBe(131_072);
	const compat = model?.compat as Record<string, unknown> | undefined;
	expect(compat?.thinkingFormat).toBe("zai");
	expect(compat?.zaiToolStream).toBe(true);
	expect(isPiNativeZaiProvider(model?.provider)).toBe(true);
	expect(isNativeZaiModel(model)).toBe(true);
	expect(isManagedZaiModel(model)).toBe(true);
}

describe("installed Pi Z.AI model contract", () => {
	const globalModels = asModelList(getBuiltinModels("zai"));
	const cnModels = asModelList(getBuiltinModels("zai-coding-cn"));

	it("exposes glm-5.3 as the current Coding Plan flagship on both endpoints", () => {
		for (const [models, provider, baseUrl] of [
			[globalModels, "zai", GLOBAL_CODING_BASE],
			[cnModels, "zai-coding-cn", CN_CODING_BASE],
		] as const) {
			expectCurrentGlm53Contract(
				models.find((model) => model.id === "glm-5.3"),
				provider,
				baseUrl,
			);
		}
	});

	it("exposes glm-5.2-highspeed on both Coding Plan endpoints", () => {
		for (const [models, provider, baseUrl] of [
			[globalModels, "zai", GLOBAL_CODING_BASE],
			[cnModels, "zai-coding-cn", CN_CODING_BASE],
		] as const) {
			const model = models.find(
				(candidate) => candidate.id === "glm-5.2-highspeed",
			);
			expect(model).toBeTruthy();
			expect(model?.provider).toBe(provider);
			expect(model?.baseUrl).toBe(baseUrl);
			expect(model?.contextWindow).toBe(1_000_000);
			expect(model?.maxTokens).toBe(131_072);
		}
	});

	it("exposes glm-5.2 on the global Coding Plan endpoint", () => {
		expectGlm52Contract(
			globalModels.find((model) => model.id === "glm-5.2"),
			"zai",
			GLOBAL_CODING_BASE,
		);
		expect(inferEndpoint("zai", GLOBAL_CODING_BASE)).toBe("coding");
	});

	it("exposes glm-5.2 on the China Coding Plan endpoint", () => {
		expectGlm52Contract(
			cnModels.find((model) => model.id === "glm-5.2"),
			"zai-coding-cn",
			CN_CODING_BASE,
		);
		expect(inferEndpoint("zai-coding-cn", CN_CODING_BASE)).toBe("coding-cn");
	});

	it("recognizes the runtime zai-coding-plan alias without claiming it is Pi-native", () => {
		const canonical = globalModels.find((model) => model.id === "glm-5.2");
		expect(canonical).toBeTruthy();
		const aliasModel = {
			...canonical,
			provider: "zai-coding-plan",
			baseUrl: GLOBAL_CODING_BASE,
		} as ZaiModel;

		expect(isZaiProvider(aliasModel.provider)).toBe(true);
		expect(isCodingPlanProvider(aliasModel.provider)).toBe(true);
		expect(isZaiCodingPlanAliasProvider(aliasModel.provider)).toBe(true);
		expect(isPiNativeZaiProvider(aliasModel.provider)).toBe(false);
		expect(isNativeZaiModel(aliasModel)).toBe(false);
		expect(isManagedZaiModel(aliasModel)).toBe(true);
		expect(inferEndpoint(aliasModel.provider, aliasModel.baseUrl)).toBe(
			"coding",
		);

		const capabilities = resolveZaiCapabilities(aliasModel, "experimental");
		expect(capabilities.providerOwnership).toBe("coding-plan-alias");
		expect(capabilities.usesZaiThinkingFormat).toBe(true);
		expect(capabilities.streamsToolCalls).toBe(true);
		expect(capabilities.sessionAffinitySource).toBe("pi-zai");
	});

	it("keeps China and global Coding Plan catalogs aligned by model id", () => {
		const globalIds = globalModels.map((model) => model.id).sort();
		const cnIds = cnModels.map((model) => model.id).sort();
		expect(cnIds).toEqual(globalIds);
		expect(globalIds.length).toBeGreaterThan(0);
	});
});
