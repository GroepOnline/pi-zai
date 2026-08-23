import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { clampThinkingLevel } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createAdaptiveToolsSessionPolicy } from "./adaptive-tools/index.ts";
import {
	applyZaiCompactionInstructions,
	applyZaiTreeSummaryInstructions,
	buildCacheSegmentKey,
	canonicalStableSystemPrefix,
	captureActiveToolset,
	classifyToolsetTransition,
	detectSegmentChange,
	fingerprintSystemPrompt,
	formatSegmentChangeReason,
	isZaiModel,
} from "./cache/index.ts";
import { applySafePromptNormalization } from "./cache/prompt-safe.ts";
import { resolveZaiCapabilities } from "./capabilities.ts";
import {
	createDefaultZaiCommandDeps,
	registerZaiCommands,
} from "./commands/index.ts";
import { loadZaiConfig, type ZaiConfig } from "./config.ts";
import { fingerprintPayload, hashSessionId } from "./correlation.ts";
import { formatPiCredentialSource } from "./credentials.ts";
import { isManagedZaiModel, isNativeZaiModel } from "./native-zai.ts";
import { normalizeZaiThinkingPayload } from "./payload-normalizer.ts";
import { snapshotPromptStability } from "./prompt-stability.ts";
import {
	formatConnectionErrorHint,
	isConnectionErrorMessage,
} from "./resilience.ts";
import {
	dispatchZaiHook,
	getAttemptTracker,
	getCacheMetricsStore,
	getMetricsStorage,
	getQueryCorrelation,
	getToolExecutionTracker,
	getTpsTracker,
	inferEndpoint,
	isZaiProvider,
	newSessionAffinityId,
	resetCacheMetrics,
	resetCorrelationState,
	resetToolMetrics,
	resetTpsMetrics,
	sessionState,
	setMetricsStorage,
	shouldRunDailyMetricsCleanup,
} from "./state.ts";
import { createMetricsStorage, projectIdForCwd } from "./storage/index.ts";
import { clearZaiStatus, updateZaiTpsStatus } from "./telemetry/status.ts";
import {
	isTelemetryUploadEnabled,
	syncPendingTelemetry,
} from "./telemetry/sync.ts";
import { EXTENSION_VERSION } from "./version.generated.ts";
import type { ZaiModel } from "./zai-model.ts";

export { loadZaiConfig, type ZaiConfig } from "./config.ts";
export { formatPiCredentialSource } from "./credentials.ts";
export {
	buildPlatformModelCatalog,
	GLM52_THINKING_LEVEL_MAP,
	GLM53_PRICING_BASIS,
	GLM53_THINKING_LEVEL_MAP,
	PLATFORM_BASE_URL,
} from "./model-catalog.ts";
export { isNativeZaiModel } from "./native-zai.ts";
export {
	glm53ReasoningEffort,
	normalizeZaiThinkingPayload,
} from "./payload-normalizer.ts";
export {
	createZaiSessionState,
	dispatchZaiHook,
	getCacheMetricsStore,
	getMetricsStorage,
	getZaiHookHandlers,
	inferEndpoint,
	isZaiProvider,
	resetCacheMetrics,
	sessionState,
	setZaiHookHandlers,
	type ZaiEndpointKind,
	type ZaiHookHandlers,
	type ZaiSessionState,
} from "./state.ts";
export { EXTENSION_VERSION } from "./version.generated.ts";

function clampThinkingForModel(
	pi: ExtensionAPI,
	model: ZaiModel | undefined,
): void {
	if (!model?.reasoning) return;
	const current = pi.getThinkingLevel();
	const clamped = clampThinkingLevel(model, current) as ThinkingLevel;
	if (clamped !== current) {
		pi.setThinkingLevel(clamped);
	}
}

function updateSessionFromModel(
	model: ZaiModel | undefined,
	thinkingLevel: ReturnType<ExtensionAPI["getThinkingLevel"]>,
): void {
	if (!model) {
		sessionState.provider = undefined;
		sessionState.modelId = undefined;
		sessionState.endpoint = "unknown";
		sessionState.credentialSource = undefined;
		sessionState.thinkingLevel = thinkingLevel;
		return;
	}

	sessionState.provider = model.provider;
	sessionState.modelId = model.id;
	sessionState.endpoint = inferEndpoint(model.provider, model.baseUrl);
	sessionState.thinkingLevel = thinkingLevel;
}

function updateCacheSegment(
	model: ZaiModel,
	systemPrompt: string,
	toolsetFingerprint: string,
	extraReasons: string[] = [],
): void {
	const segment = buildCacheSegmentKey({
		provider: model.provider,
		baseUrl: model.baseUrl,
		model: model.id,
		systemFingerprint: fingerprintSystemPrompt(
			canonicalStableSystemPrefix(systemPrompt),
		),
		toolsetFingerprint,
	});
	const store = getCacheMetricsStore();
	const change = detectSegmentChange(store.get()?.segment, segment);
	if (change.changed || extraReasons.length > 0) {
		const reasons = [...change.reasons, ...extraReasons];
		store.reset(segment, formatSegmentChangeReason({ changed: true, reasons }));
	} else {
		store.updateSegment(segment, "unchanged");
	}
}

function syncToolsetAtProviderBoundary(
	pi: ExtensionAPI,
	model: ZaiModel,
	systemPrompt: string,
): void {
	const snapshot = captureActiveToolset(pi);
	if (!snapshot) return;
	const transition = classifyToolsetTransition(
		sessionState.lastToolsetSnapshot,
		snapshot,
	);
	const capabilities = resolveZaiCapabilities(model);

	if (transition.changed) {
		sessionState.toolsetGeneration += 1;
	}
	updateCacheSegment(
		model,
		systemPrompt,
		snapshot.fingerprint,
		transition.changed ? [`toolset:${transition.classification}`] : [],
	);

	sessionState.lastToolsetSnapshot = snapshot;
	sessionState.lastToolsetTransition = {
		...transition,
		apiFamily: capabilities.apiFamily,
		dynamicToolMode: capabilities.dynamicToolMode,
	};
}

function classifyTransportError(
	message: string | undefined,
	httpStatus?: number,
): string | undefined {
	if (httpStatus === 429) return "http_429";
	if (httpStatus !== undefined && httpStatus >= 500) return "http_5xx";
	if (httpStatus !== undefined && httpStatus >= 400) return "http_4xx";
	if (!message) return undefined;
	if (/timeout/i.test(message)) return "timeout_before_headers";
	if (/certificate|cert/i.test(message)) return "certificate";
	if (/tls|ssl/i.test(message)) return "tls";
	if (/proxy/i.test(message)) return "proxy";
	if (/dns|getaddrinfo|enotfound/i.test(message)) return "dns";
	if (/connect|refused|reset|hang up|recv failure/i.test(message))
		return "tcp_connect";
	if (/stream|interrupted|terminated/i.test(message))
		return "stream_interrupted";
	if (/context|length|overflow/i.test(message)) return "context_overflow";
	if (/auth|401|403|unauthorized|forbidden/i.test(message))
		return "authentication";
	if (isConnectionErrorMessage(message)) return "unknown_transport";
	return undefined;
}

function ensureAttemptTrackingForTurnEnd(): void {
	if (getAttemptTracker().hasInFlight()) return;
	const { queryId, requestId, attempt } = getQueryCorrelation().nextAttempt();
	getAttemptTracker().beginAttempt({
		queryId,
		requestId,
		attempt,
		payloadFingerprint: "no-before-provider-request",
	});
}

async function ensureMetricsStorage(
	config: ZaiConfig,
	warn: (message: string) => void,
): Promise<void> {
	setMetricsStorage(await createMetricsStorage(config.metrics, warn));
}

export default function piZaiExtension(pi: ExtensionAPI): void {
	let config: ZaiConfig = loadZaiConfig();
	const adaptiveToolsPolicy = createAdaptiveToolsSessionPolicy(
		pi,
		() => config.adaptiveTools,
	);
	const syncAdaptiveToolsPolicy = (model: ZaiModel | undefined): void => {
		try {
			if (isManagedZaiModel(model)) adaptiveToolsPolicy.apply();
			else adaptiveToolsPolicy.restore();
		} catch {
			// Fail open: adaptive tooling must never block the Pi runtime.
		}
	};

	sessionState.preserveThinking = config.preserveThinking;
	registerZaiCommands(pi, createDefaultZaiCommandDeps(EXTENSION_VERSION));

	pi.on("session_start", async (event, ctx) => {
		config = loadZaiConfig(ctx.cwd);
		sessionState.preserveThinking = config.preserveThinking;
		if (event.reason !== "reload") {
			resetCacheMetrics();
			resetTpsMetrics();
			resetToolMetrics();
			resetCorrelationState();
			sessionState.sessionAffinityId = newSessionAffinityId();
			sessionState.activeBenchmarkRunId = undefined;
			sessionState.lastToolsetSnapshot = undefined;
			sessionState.lastToolsetTransition = undefined;
			sessionState.toolsetGeneration = 0;
			sessionState.adaptiveTools = undefined;
		}

		syncAdaptiveToolsPolicy(ctx.model);

		sessionState.projectId = projectIdForCwd(ctx.cwd);
		sessionState.sessionHash = hashSessionId(ctx.sessionManager.getSessionId());
		await ensureMetricsStorage(config, (message) =>
			ctx.ui.notify(message, "warning"),
		);

		const storage = getMetricsStorage();
		if (storage && shouldRunDailyMetricsCleanup()) {
			storage.runCleanup(Date.now());
		}

		if (storage && isTelemetryUploadEnabled(config)) {
			void syncPendingTelemetry({
				config,
				extensionVersion: EXTENSION_VERSION,
				storage,
			});
		}

		updateSessionFromModel(ctx.model, pi.getThinkingLevel());
		if (ctx.model) clampThinkingForModel(pi, ctx.model);
		if (ctx.model && isZaiProvider(ctx.model.provider)) {
			sessionState.credentialSource = formatPiCredentialSource(
				ctx.model.provider,
				ctx.modelRegistry,
			);
		} else {
			sessionState.credentialSource = undefined;
		}

		await dispatchZaiHook("onSessionStart", event, ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		adaptiveToolsPolicy.restore();
		resetCacheMetrics();
		resetTpsMetrics();
		resetToolMetrics();
		sessionState.activeBenchmarkRunId = undefined;
		setMetricsStorage(undefined);
		clearZaiStatus(ctx);
	});

	pi.on("model_select", async (event, ctx) => {
		syncAdaptiveToolsPolicy(event.model);
		clampThinkingForModel(pi, event.model);
		updateSessionFromModel(event.model, pi.getThinkingLevel());
		if (isZaiProvider(event.model.provider)) {
			sessionState.credentialSource = formatPiCredentialSource(
				event.model.provider,
				ctx.modelRegistry,
			);
		} else {
			clearZaiStatus(ctx);
		}
		await dispatchZaiHook("onModelSelect", event, ctx);
	});

	pi.on("message_start", async (event, ctx) => {
		if (
			event.message.role !== "assistant" ||
			!ctx.model ||
			!isZaiModel(ctx.model)
		) {
			return;
		}
		getTpsTracker().beginAssistantMessage();
	});

	pi.on("message_update", async (event, ctx) => {
		if (
			event.message.role !== "assistant" ||
			!ctx.model ||
			!isZaiModel(ctx.model)
		) {
			return;
		}
		getTpsTracker().markFirstToken();
		getAttemptTracker().markFirstDelta();
	});

	pi.on("message_end", async (event, ctx) => {
		if (
			event.message.role !== "assistant" ||
			!ctx.model ||
			!isZaiModel(ctx.model)
		) {
			return;
		}
		if (event.message.usage) {
			getAttemptTracker().accumulateTurnUsage(event.message.usage);
		}
		const sample = getTpsTracker().completeAssistantMessage(
			event.message.usage,
			Date.now(),
		);
		updateZaiTpsStatus(ctx, config, sample, getTpsTracker().get());
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (!ctx.model || !isZaiModel(ctx.model)) return;
		const turnStartedAt = Date.now();
		const queryId = getQueryCorrelation().beginQuery();
		getAttemptTracker().prepareQueryAttempt(queryId, turnStartedAt);
		getTpsTracker().beginTurn(turnStartedAt);
		getToolExecutionTracker().beginTurn();
		const snapshot = captureActiveToolset(pi);
		let systemPromptForMetrics = event.systemPrompt;
		if (config.promptStabilityMode === "safe") {
			const normalized = applySafePromptNormalization(event.systemPrompt);
			if (normalized !== undefined) {
				systemPromptForMetrics = normalized;
			}
		}
		// Baseline only; authoritative toolset check happens in before_provider_request.
		if (snapshot) {
			updateCacheSegment(
				ctx.model,
				systemPromptForMetrics,
				snapshot.fingerprint,
			);
			sessionState.lastToolsetSnapshot = snapshot;
		}
		sessionState.promptStability = snapshotPromptStability(
			systemPromptForMetrics,
		);

		if (
			config.promptStabilityMode === "safe" &&
			systemPromptForMetrics !== event.systemPrompt
		) {
			return { systemPrompt: systemPromptForMetrics };
		}
	});

	pi.on("turn_end", async (event, ctx) => {
		sessionState.thinkingLevel = pi.getThinkingLevel();
		if (
			ctx.model &&
			isZaiModel(ctx.model) &&
			event.message.role === "assistant" &&
			event.message.usage
		) {
			getCacheMetricsStore().record(ctx.model, event.message.usage);

			const assistant = event.message as AssistantMessage;
			const segment = getCacheMetricsStore().get()?.segment;
			ensureAttemptTrackingForTurnEnd();
			const turnTools = getToolExecutionTracker().getTurnStats();
			getTpsTracker().completeTurn({
				toolMs: turnTools.totalMs,
				toolCalls: turnTools.executions,
			});
			const record = getAttemptTracker().buildRecord({
				projectId: sessionState.projectId ?? projectIdForCwd(ctx.cwd),
				sessionHash:
					sessionState.sessionHash ??
					hashSessionId(ctx.sessionManager.getSessionId()),
				provider: ctx.model.provider,
				model: ctx.model.id,
				endpointKind: sessionState.endpoint,
				thinkingLevel: sessionState.thinkingLevel,
				extensionVersion: EXTENSION_VERSION,
				systemFingerprint: segment?.systemFingerprint,
				toolsetFingerprint: segment?.toolsetFingerprint,
				errorCategory:
					assistant.stopReason === "error"
						? classifyTransportError(assistant.errorMessage, undefined)
						: undefined,
				toolCallsInTurn: turnTools.executions,
				toolErrorsInTurn: turnTools.errors,
				toolDurationMsTotal: turnTools.totalMs,
			});
			if (record) {
				getMetricsStorage()?.recordAttempt(record);
			}
		}
		await dispatchZaiHook("onTurnEnd", event, ctx);
	});

	pi.on("session_compact", async () => {
		getCacheMetricsStore().markCompaction();
	});

	pi.on("session_before_compact", async (event, ctx) => {
		if (!ctx.model || !isZaiModel(ctx.model)) return;
		applyZaiCompactionInstructions(event);
	});

	pi.on("session_before_tree", async (_event, ctx) => {
		if (!ctx.model || !isZaiModel(ctx.model)) return;
		return applyZaiTreeSummaryInstructions();
	});

	pi.on("agent_settled", async (_event, ctx) => {
		if (!ctx.model || !isZaiModel(ctx.model)) return;
		for (let i = ctx.sessionManager.getBranch().length - 1; i >= 0; i -= 1) {
			const entry = ctx.sessionManager.getBranch()[i];
			if (entry.type !== "message" || entry.message.role !== "assistant")
				continue;
			const assistant = entry.message as AssistantMessage;
			if (
				assistant.stopReason !== "error" ||
				!isConnectionErrorMessage(assistant.errorMessage)
			) {
				return;
			}
			ctx.ui.notify(formatConnectionErrorHint(ctx.model), "warning");
			return;
		}
	});

	pi.on("tool_execution_start", async (event, ctx) => {
		if (!ctx.model || !isZaiModel(ctx.model)) return;
		getAttemptTracker().markFirstToolDelta();
		getToolExecutionTracker().begin(
			event.toolCallId,
			event.toolName,
			getQueryCorrelation().currentQueryIdOrUndefined(),
		);
	});

	pi.on("tool_execution_end", async (event, ctx) => {
		if (!ctx.model || !isZaiModel(ctx.model)) return;
		getToolExecutionTracker().complete(
			event.toolCallId,
			event.toolName,
			event.isError,
		);
	});

	pi.on("before_provider_request", async (event, ctx) => {
		if (!ctx.model || !isManagedZaiModel(ctx.model)) {
			return;
		}

		try {
			syncToolsetAtProviderBoundary(pi, ctx.model, ctx.getSystemPrompt());
		} catch {
			// Fail open: keep current segment and continue the request.
		}

		const { queryId, requestId, attempt } = getQueryCorrelation().nextAttempt();
		if (attempt > 1 || !getAttemptTracker().hasInFlight()) {
			getAttemptTracker().beginAttempt({
				queryId,
				requestId,
				attempt,
				payloadFingerprint: fingerprintPayload(event.payload),
			});
		} else {
			getAttemptTracker().armProviderAttempt({
				requestId,
				attempt,
				payloadFingerprint: fingerprintPayload(event.payload),
			});
		}

		const capabilities = resolveZaiCapabilities(
			ctx.model,
			config.sessionAffinity,
		);
		if (
			config.preserveThinking === undefined &&
			!capabilities.usesZaiThinkingFormat &&
			!isNativeZaiModel(ctx.model)
		) {
			return;
		}
		return normalizeZaiThinkingPayload(
			event.payload,
			config,
			ctx.model.id,
			pi.getThinkingLevel(),
		);
	});

	pi.on("after_provider_response", async (event, ctx) => {
		if (!ctx.model || !isManagedZaiModel(ctx.model)) return;
		getAttemptTracker().markHeadersReceived();
		getAttemptTracker().markResponse(
			event.status,
			event.status >= 400
				? classifyTransportError(undefined, event.status)
				: undefined,
		);
	});

	pi.on("before_provider_headers", async (event) => {
		if (!isZaiProvider(sessionState.provider)) return;

		const headerNames = Object.keys(event.headers);
		const hasHeader = (name: string): boolean =>
			headerNames.some((key) => key.toLowerCase() === name.toLowerCase());

		const hasAffinityHeader = [
			"x-session-id",
			"session-id",
			"session_id",
			"x-client-request-id",
			"x-session-affinity",
		].some(hasHeader);
		if (config.sessionAffinity === "experimental" && !hasAffinityHeader) {
			event.headers["X-Session-Id"] = sessionState.sessionAffinityId;
		}
		if (!hasHeader("User-Agent")) {
			event.headers["User-Agent"] = `pi-zai/${EXTENSION_VERSION}`;
		}
		if (!hasHeader("Accept-Language")) {
			event.headers["Accept-Language"] = "en-US,en";
		}
	});
}
