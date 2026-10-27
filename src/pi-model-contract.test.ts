import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
const PI_SUPPORT_FLOOR = "0.84.2";

function installedPiAiVersion(): string {
	const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
	const pkg = JSON.parse(
		readFileSync(
			join(packageRoot, "node_modules/@earendil-works/pi-ai/package.json"),
			"utf8",
		),
	) as { version: string };
	return pkg.version;
}

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
	const thinkingLevelMap = model?.thinkingLevelMap as
		| Record<string, unknown>
		| undefined;
	expect([null, "high"]).toContain(thinkingLevelMap?.low);
	expect([null, "high"]).toContain(thinkingLevelMap?.medium);
	expect(thinkingLevelMap?.high).toBe("high");
	expect(thinkingLevelMap?.max).toBe("max");
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

	it("exposes glm-5.2-highspeed on the global Coding Plan endpoint", () => {
		const model = globalModels.find(
			(candidate) => candidate.id === "glm-5.2-highspeed",
		);
		expect(model).toBeTruthy();
		expect(model?.provider).toBe("zai");
		expect(model?.baseUrl).toBe(GLOBAL_CODING_BASE);
		expect(model?.contextWindow).toBe(1_000_000);
		expect(model?.maxTokens).toBe(131_072);
		if (installedPiAiVersion() === PI_SUPPORT_FLOOR) {
			const cnModel = cnModels.find(
				(candidate) => candidate.id === "glm-5.2-highspeed",
			);
			expect(cnModel?.provider).toBe("zai-coding-cn");
			expect(cnModel?.baseUrl).toBe(CN_CODING_BASE);
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

	it("exposes glm-5.2 on the China Coding Plan endpoint when Pi still ships it", () => {
		const model = cnModels.find((candidate) => candidate.id === "glm-5.2");
		if (installedPiAiVersion() === PI_SUPPORT_FLOOR || model) {
			expectGlm52Contract(model, "zai-coding-cn", CN_CODING_BASE);
		} else {
			expect(cnModels.some((candidate) => candidate.id === "glm-5.3")).toBe(
				true,
			);
		}
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

	it("keeps the required Coding Plan models for this Pi release", () => {
		const globalIds = new Set(globalModels.map((model) => model.id));
		const cnIds = new Set(cnModels.map((model) => model.id));
		expect(globalIds.has("glm-5.3")).toBe(true);
		expect(cnIds.has("glm-5.3")).toBe(true);
		expect(globalIds.has("glm-5.2")).toBe(true);
		expect(globalIds.has("glm-5.2-highspeed")).toBe(true);
		if (installedPiAiVersion() === PI_SUPPORT_FLOOR) {
			expect(cnIds.has("glm-5.2")).toBe(true);
			expect(cnIds.has("glm-5.2-highspeed")).toBe(true);
		}
		expect(globalIds.size).toBeGreaterThan(0);
		expect(cnIds.size).toBeGreaterThan(0);
	});
});
