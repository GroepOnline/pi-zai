import { describe, expect, it } from "vitest";
import type { ZaiConfig } from "../config.ts";
import { buildPlatformModelCatalog } from "../model-catalog.ts";
import type { ZaiModel } from "../zai-model.ts";
import { describeThinkingPayload } from "./helpers.ts";

const config = { preserveThinking: undefined } as ZaiConfig;
const catalog = buildPlatformModelCatalog();
const glm52 = catalog.find((model) => model.id === "glm-5.2") as ZaiModel;
const glm53 = catalog.find((model) => model.id === "glm-5.3") as ZaiModel;

describe("describeThinkingPayload", () => {
	it("does not invent unsupported GLM-5.2 reasoning efforts", () => {
		const minimal = describeThinkingPayload(config, "minimal", glm52);
		const xhigh = describeThinkingPayload(config, "xhigh", glm52);

		expect(minimal).toContain("not selectable");
		expect(minimal).not.toContain('reasoning_effort="minimal"');
		expect(xhigh).toContain("not selectable");
		expect(xhigh).not.toContain('reasoning_effort="xhigh"');
	});

	it("reports the mapped GLM-5.2 effort", () => {
		expect(describeThinkingPayload(config, "medium", glm52)).toContain(
			'reasoning_effort="high"',
		);
	});

	it("keeps GLM-5.3 compatibility mapping", () => {
		expect(describeThinkingPayload(config, "minimal", glm53)).toContain(
			'reasoning_effort="low"',
		);
	});
});
