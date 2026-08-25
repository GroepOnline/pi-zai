import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
	buildCompactionInstructions,
	ZAI_COMPACTION_SECTIONS,
} from "../cache/compaction.ts";
import { canonicalStableSystemPrefix } from "../cache/context-policy.ts";
import { fingerprintToolset } from "../cache/fingerprint.ts";
import { resolveZaiCapabilities } from "../capabilities.ts";
import { GLM53_THINKING_LEVEL_MAP } from "../model-catalog.ts";
import {
	formatProbeSummary,
	formatRecommendedRetrySettingsJson,
	formatRetrySettingsAdvice,
	probeChatEndpoint,
	readPiRetrySettings,
} from "../resilience.ts";
import { inferEndpoint, sessionState } from "../state.ts";
import type { ZaiModel } from "../zai-model.ts";
import type { ZaiCommandDeps } from "./deps.ts";
import {
	describeThinkingPayload,
	formatCredentialSource,
	getZaiCompat,
	requireZaiModel,
} from "./helpers.ts";

type CheckStatus = "pass" | "fail" | "skip" | "warn";

type DoctorCheck = {
	name: string;
	status: CheckStatus;
	detail: string;
};

const DOCTOR_THINKING_LEVELS: ThinkingLevel[] = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
];

function statusIcon(status: CheckStatus): string {
	switch (status) {
		case "pass":
			return "ok";
		case "fail":
			return "fail";
		case "skip":
			return "skip";
		case "warn":
			return "warn";
	}
}

/** Detect whether the installed Pi catalog exposes native reasoning_effort metadata. */
function isReasoningEffortModel(model: ZaiModel | undefined): boolean {
	return (
		(model?.compat as { supportsReasoningEffort?: boolean } | undefined)
			?.supportsReasoningEffort === true
	);
}

function glm52ThinkingMapOk(model: ZaiModel | undefined): boolean {
	if (!model?.thinkingLevelMap) return false;
	const map = model.thinkingLevelMap;
	return (
		map.minimal === null &&
		map.low === "high" &&
		map.medium === "high" &&
		map.high === "high" &&
		map.max === "max"
	);
}

function glm53NativeMetadataOk(model: ZaiModel | undefined): boolean {
	if (model?.id !== "glm-5.3" || !model.thinkingLevelMap) return false;
	const compat = model.compat as
		| { supportsReasoningEffort?: boolean }
		| undefined;
	const map = model.thinkingLevelMap;
	return (
		compat?.supportsReasoningEffort === true &&
		Object.entries(GLM53_THINKING_LEVEL_MAP).every(
			([level, expected]) => map[level as keyof typeof map] === expected,
		)
	);
}

function hasPlatformPricing(model: ZaiModel | undefined): boolean {
	if (!model) return false;
	const { input, output } = model.cost;
	return input > 0 || output > 0;
}

async function runNetworkProbe(
	ctx: ExtensionCommandContext,
	model: ZaiModel,
): Promise<DoctorCheck> {
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok || !auth.apiKey) {
		return {
			name: "Network probe",
			status: "skip",
			detail: "No credentials available; skipped live request.",
		};
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 10_000);
	try {
		const response = await fetch(`${model.baseUrl}/models`, {
			method: "GET",
			headers: {
				...auth.headers,
				Authorization: auth.headers?.Authorization ?? `Bearer ${auth.apiKey}`,
			},
			signal: controller.signal,
		});
		if (response.ok) {
			return {
				name: "Network probe",
				status: "pass",
				detail: `Reachable (${response.status}) at ${model.baseUrl}/models`,
			};
		}
		return {
			name: "Network probe",
			status: "warn",
			detail: `Responded with HTTP ${response.status}; credentials present but request not fully successful.`,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : "unknown error";
		return {
			name: "Network probe",
			status: "warn",
			detail: `Request failed: ${message}`,
		};
	} finally {
		clearTimeout(timeout);
	}
}

async function runConnectionStabilityProbe(
	ctx: ExtensionCommandContext,
	model: ZaiModel,
): Promise<DoctorCheck> {
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok || !auth.apiKey) {
		return {
			name: "Connection stability",
			status: "skip",
			detail: "No credentials available; skipped chat probe.",
		};
	}

	const probe = await probeChatEndpoint(model.baseUrl, auth.apiKey, 3);
	const summary = formatProbeSummary({
		endpoint: inferEndpoint(model.provider, model.baseUrl),
		...probe,
	});
	if (probe.fail === 0) {
		return {
			name: "Connection stability",
			status: "pass",
			detail: `${summary} at ${model.baseUrl}`,
		};
	}
	if (probe.ok > 0) {
		return {
			name: "Connection stability",
			status: "warn",
			detail: `${summary} at ${model.baseUrl}; intermittent drops likely (Connection error). Try /zai-endpoint or Pi retry.provider.maxRetries=2`,
		};
	}
	return {
		name: "Connection stability",
		status: "fail",
		detail: `${summary} at ${model.baseUrl}; endpoint unreachable from this host`,
	};
}

export function registerZaiDoctorCommand(
	pi: ExtensionAPI,
	deps: ZaiCommandDeps,
): void {
	pi.registerCommand("zai-doctor", {
		description: "Z.AI integration checks with optional live network probes",
		handler: async (_args, ctx) => {
			const checks: DoctorCheck[] = [];
			const config = deps.getConfig(ctx.cwd);
			const nativeGlm53 = ctx.modelRegistry.find("zai", "glm-5.3");
			const nativeGlm52Highspeed = ctx.modelRegistry.find(
				"zai",
				"glm-5.2-highspeed",
			);
			const codingModel =
				nativeGlm53 ?? ctx.modelRegistry.find("zai", "glm-5.2");
			const platformModel =
				ctx.modelRegistry.find("zai-platform", "glm-5.3") ??
				ctx.modelRegistry.find("zai-platform", "glm-5.2");
			const platformRegistered =
				deps.isPlatformProviderRegistered(ctx) && platformModel !== undefined;
			const active = ctx.model;

			checks.push({
				name: "Extension loaded",
				status: "pass",
				detail: `@groeponline/pi-zai ${deps.extensionVersion}`,
			});

			checks.push({
				name: "Pi compatibility",
				status: "pass",
				detail:
					"Requires @earendil-works/pi-coding-agent >= 0.84.2 with native Z.AI transport.",
			});

			checks.push({
				name: "Built-in Z.AI flagship",
				status: nativeGlm53 ? "pass" : "fail",
				detail: nativeGlm53
					? "zai/glm-5.3 present"
					: "zai/glm-5.3 missing; upgrade Pi before relying on current Coding Plan defaults",
			});

			checks.push({
				name: "GLM-5.2 Highspeed catalog",
				status: nativeGlm52Highspeed ? "pass" : "warn",
				detail: nativeGlm52Highspeed
					? "zai/glm-5.2-highspeed present"
					: "glm-5.2-highspeed missing from installed Pi catalog",
			});

			checks.push({
				name: "GLM-5.3 native effort metadata",
				status: glm53NativeMetadataOk(nativeGlm53) ? "pass" : "warn",
				detail: glm53NativeMetadataOk(nativeGlm53)
					? "Pi natively exposes GLM-5.3 low/high/max effort metadata; pi-zai compatibility normalization is a no-op"
					: "Installed Pi catalog is missing current GLM-5.3 effort metadata; pi-zai request-boundary compatibility normalization is active",
			});

			checks.push({
				name: "Platform provider (optional)",
				status: platformRegistered ? "pass" : "skip",
				detail: platformRegistered
					? `zai-platform/${platformModel?.id ?? "model"} present in models.json`
					: "Not registered by pi-zai; add zai-platform manually via models.json if needed",
			});

			const credentialProvider = active?.provider ?? "zai";
			const credentialName =
				(await deps.resolveCredentialSourceName(credentialProvider, ctx)) ??
				formatCredentialSource(credentialProvider, ctx);
			const credentialConfigured =
				ctx.modelRegistry.getProviderAuthStatus(credentialProvider).configured;
			checks.push({
				name: "Credential availability",
				status: credentialConfigured ? "pass" : "warn",
				detail: credentialConfigured
					? `Source name: ${credentialName} (value never printed)`
					: "No credential configured for active provider",
			});

			const thinkingModel = active ?? codingModel;
			if (thinkingModel?.id === "glm-5.3") {
				checks.push({
					name: "GLM-5.3 thinking contract",
					status: "pass",
					detail:
						"thinking is mandatory; pi-zai maps off/minimal/low → low, medium/high → high, xhigh/max → max and never emits thinking.type=disabled",
				});
			} else if (isReasoningEffortModel(thinkingModel)) {
				checks.push({
					name: "GLM-5.2 thinkingLevelMap",
					status: glm52ThinkingMapOk(thinkingModel) ? "pass" : "warn",
					detail: glm52ThinkingMapOk(thinkingModel)
						? "minimal hidden; low/medium/high map to Z.AI `high`; max maps to `max`"
						: "Unexpected thinkingLevelMap on active or default model",
				});
			} else {
				checks.push({
					name: "Reasoning effort metadata",
					status: "skip",
					detail: `${thinkingModel?.id ?? "model"} has no native reasoning_effort metadata`,
				});
			}

			for (const level of DOCTOR_THINKING_LEVELS) {
				checks.push({
					name: `Payload (${level})`,
					status: "pass",
					detail: describeThinkingPayload(config, level, thinkingModel),
				});
			}

			checks.push({
				name: "Preserved thinking policy",
				status: config.preserveThinking === false ? "warn" : "pass",
				detail:
					config.preserveThinking === undefined
						? "No override: Pi native payload is preserved (currently clear_thinking=false while thinking is enabled)"
						: config.preserveThinking
							? "Explicit override keeps clear_thinking=false"
							: "Explicit override forces clear_thinking=true; this can reduce reasoning continuity and cache reuse in coding sessions",
			});

			checks.push({
				name: "Tool streaming",
				status: getZaiCompat(thinkingModel)?.zaiToolStream ? "pass" : "warn",
				detail: getZaiCompat(thinkingModel)?.zaiToolStream
					? "zaiToolStream enabled on active/default model"
					: "zaiToolStream not enabled on inspected model",
			});

			checks.push({
				name: "Cache affinity header",
				status: config.sessionAffinity === "experimental" ? "pass" : "skip",
				detail:
					config.sessionAffinity === "experimental"
						? "X-Session-Id enabled (identifier not displayed)"
						: "X-Session-Id off (set zai.sessionAffinity=experimental to enable)",
			});

			const capabilities = resolveZaiCapabilities(
				thinkingModel ?? ctx.model,
				config.sessionAffinity,
			);
			checks.push({
				name: "Provider capabilities",
				status: "pass",
				detail: `API ${capabilities.apiFamily}; dynamic tools ${capabilities.dynamicToolMode}; ownership ${capabilities.providerOwnership}`,
			});
			checks.push({
				name: "Adaptive tools",
				status:
					config.adaptiveTools.mode === "off"
						? "skip"
						: config.adaptiveTools.unsupportedMode
							? "warn"
							: "pass",
				detail: config.adaptiveTools.unsupportedMode
					? `mode ${config.adaptiveTools.requestedMode} requested but unsupported in 0.5.0; using observe`
					: `mode ${config.adaptiveTools.mode}`,
			});
			checks.push({
				name: "Toolset tracking",
				status: "pass",
				detail: sessionState.lastToolsetTransition
					? `generation ${sessionState.toolsetGeneration}; last ${sessionState.lastToolsetTransition.classification}; tools ${sessionState.lastToolsetTransition.previousCount} -> ${sessionState.lastToolsetTransition.nextCount}`
					: "provider-request boundary armed; no transitions yet",
			});

			checks.push({
				name: "Streamed usage + cached tokens",
				status: "pass",
				detail:
					"Handled by upstream pi-ai openai-completions Z.AI parser (cacheRead from cached_tokens).",
			});

			checks.push({
				name: "Platform pricing metadata",
				status: !platformRegistered
					? "skip"
					: hasPlatformPricing(platformModel)
						? "pass"
						: "warn",
				detail: !platformRegistered
					? "Platform provider is not registered; pricing metadata check is not applicable"
					: hasPlatformPricing(platformModel)
						? `Platform ${platformModel?.id ?? "model"} has non-zero local pricing metadata; verify it against current public rates before billing use`
						: `Platform ${platformModel?.id ?? "model"} pricing metadata is unverified or zero; dollar estimates stay disabled`,
			});

			const stableSample = canonicalStableSystemPrefix(
				"Project rules\nCurrent git status: dirty",
			);
			checks.push({
				name: "Stable system prefix",
				status:
					stableSample.length > 0 && !stableSample.includes("git status")
						? "pass"
						: "fail",
				detail: "Volatile git/timestamp lines excluded from canonical prefix",
			});

			const toolFingerprint = fingerprintToolset([
				{
					name: "read",
					description: "Read files",
					parameters: {
						type: "object",
						properties: { path: { type: "string" } },
					},
				},
			]);
			checks.push({
				name: "Stable tool definitions",
				status: toolFingerprint.length === 16 ? "pass" : "fail",
				detail: `Deterministic toolset fingerprint length ${toolFingerprint.length}`,
			});

			const compaction = buildCompactionInstructions();
			const compactionOk = ZAI_COMPACTION_SECTIONS.every((section) =>
				compaction.includes(section),
			);
			checks.push({
				name: "Compaction policy",
				status: compactionOk ? "pass" : "fail",
				detail:
					"Deterministic sections; compaction instructed not to replay hidden reasoning",
			});

			if (active) {
				checks.push(await runNetworkProbe(ctx, active));
				checks.push(await runConnectionStabilityProbe(ctx, active));
			}

			const retrySettings = readPiRetrySettings();
			const retryAdvice = formatRetrySettingsAdvice(retrySettings);
			checks.push({
				name: "Pi retry settings",
				status: retryAdvice ? "warn" : "pass",
				detail: retryAdvice
					? `${retryAdvice} Recommended settings: ${formatRecommendedRetrySettingsJson()}`
					: `enabled=${retrySettings.enabled}, agentMaxRetries=${retrySettings.agentMaxRetries}, providerMaxRetries=${retrySettings.providerMaxRetries}`,
			});

			const activeCheck = requireZaiModel(ctx);
			checks.push({
				name: "Active Z.AI session",
				status: "error" in activeCheck ? "warn" : "pass",
				detail:
					"error" in activeCheck
						? activeCheck.error
						: `${activeCheck.model.provider}/${activeCheck.model.id}`,
			});

			ctx.ui.notify(
				[
					"Z.AI doctor",
					"",
					...checks.map(
						(check) =>
							`[${statusIcon(check.status)}] ${check.name}: ${check.detail}`,
					),
				].join("\n"),
				checks.some((check) => check.status === "fail") ? "error" : "info",
			);
		},
	});
}
