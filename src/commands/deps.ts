import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { ZaiConfig } from "../config.ts";
import type { ZaiModel } from "../zai-model.ts";

export type ZaiEndpoint = "coding" | "platform";

export type ZaiCommandDeps = {
	extensionVersion: string;
	getConfig: (cwd?: string) => ZaiConfig;
	resolveCredentialSourceName: (
		provider: string,
		ctx: Pick<ExtensionCommandContext, "modelRegistry">,
	) => Promise<string | undefined> | string | undefined;
	resolveModelForEndpoint: (
		ctx: ExtensionCommandContext,
		endpoint: ZaiEndpoint,
		modelId?: string,
	) => ZaiModel | undefined;
	isPlatformProviderRegistered: (ctx: ExtensionCommandContext) => boolean;
};

export function resolveModelForEndpoint(
	ctx: ExtensionCommandContext,
	endpoint: ZaiEndpoint,
	modelId = ctx.model?.id ?? "glm-5.3",
): ZaiModel | undefined {
	const provider = endpoint === "platform" ? "zai-platform" : "zai";
	return ctx.modelRegistry.find(provider, modelId);
}

export function isPlatformProviderRegistered(
	ctx: ExtensionCommandContext,
): boolean {
	return (
		ctx.modelRegistry.find("zai-platform", "glm-5.3") !== undefined ||
		ctx.modelRegistry.find("zai-platform", "glm-5.2") !== undefined
	);
}
