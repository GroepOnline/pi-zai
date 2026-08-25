import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ProviderHeaders } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { resolveZaiCapabilities } from "../capabilities.ts";
import { EXTENSION_VERSION } from "../version.generated.ts";
import type { ZaiModel } from "../zai-model.ts";
import type { ZaiCommandDeps } from "./deps.ts";
import { formatHeading, formatKeyValue, joinCommandLines } from "./format.ts";
import { requireZaiModel } from "./helpers.ts";

const PI_PEER_FLOOR = "0.84.2";
const PROBE_TIMEOUT_MS = 10_000;

type ProbeSupport = boolean | "unknown";

type ProbeResult = {
	name: string;
	supported: ProbeSupport;
	httpStatus?: number;
	detail: string;
};

type ProbeCache = {
	extensionVersion: string;
	piPeerFloor: string;
	provider: string;
	model: string;
	endpoint: string;
	results: ProbeResult[];
	updatedAt: string;
};

type ProbeIdentity = Pick<
	ProbeCache,
	"extensionVersion" | "piPeerFloor" | "provider" | "model" | "endpoint"
>;

function probeCachePath(): string {
	return join(getAgentDir(), "state", "pi-zai", "capabilities-probe.json");
}

function probeIdentity(model: ZaiModel): ProbeIdentity {
	return {
		extensionVersion: EXTENSION_VERSION,
		piPeerFloor: PI_PEER_FLOOR,
		provider: model.provider,
		model: model.id,
		endpoint: model.baseUrl,
	};
}

function readProbeCache(expected: ProbeIdentity): ProbeCache | undefined {
	try {
		const parsed = JSON.parse(
			readFileSync(probeCachePath(), "utf8"),
		) as ProbeCache;
		if (!parsed || typeof parsed !== "object") return undefined;
		for (const [key, value] of Object.entries(expected)) {
			if (parsed[key as keyof ProbeIdentity] !== value) return undefined;
		}
		return parsed;
	} catch {
		return undefined;
	}
}

function writeProbeCache(cache: ProbeCache): string | undefined {
	try {
		const path = probeCachePath();
		mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
		writeFileSync(
			path,
			`${JSON.stringify(cache, null, 2)}
`,
			{
				encoding: "utf8",
				mode: 0o600,
			},
		);
		chmodSync(path, 0o600);
		return undefined;
	} catch (error) {
		return error instanceof Error ? error.message : "unknown filesystem error";
	}
}

function normalizedHeaders(
	headers: ProviderHeaders | undefined,
	apiKey: string | undefined,
): Record<string, string> {
	const normalized: Record<string, string> = {};
	for (const [name, value] of Object.entries(headers ?? {})) {
		if (typeof value === "string") normalized[name] = value;
	}
	const hasAuthorization = Object.keys(normalized).some(
		(name) => name.toLowerCase() === "authorization",
	);
	if (!hasAuthorization && apiKey) {
		normalized.Authorization = `Bearer ${apiKey}`;
	}
	normalized["Content-Type"] = "application/json";
	normalized["User-Agent"] = `pi-zai/${EXTENSION_VERSION}`;
	return normalized;
}

export type ProbeTarget = {
	endpoint: string;
	host: string;
	requiresHostConfirmation: boolean;
};

const NATIVE_PROBE_HOSTS: Record<string, string> = {
	zai: "api.z.ai",
	"zai-coding-cn": "open.bigmodel.cn",
};

export function resolveProbeTarget(model: ZaiModel): ProbeTarget {
	let url: URL;
	try {
		url = new URL(model.baseUrl);
	} catch {
		throw new Error("Probe endpoint is not a valid URL.");
	}
	if (url.protocol !== "https:") {
		throw new Error("Live capability probes require an HTTPS endpoint.");
	}
	if (url.username || url.password) {
		throw new Error(
			"Probe endpoint URLs must not contain embedded credentials.",
		);
	}
	const expectedHost = NATIVE_PROBE_HOSTS[model.provider];
	if (expectedHost && url.hostname !== expectedHost) {
		throw new Error(
			`Refusing to send ${model.provider} credentials to unexpected host ${url.hostname}.`,
		);
	}
	url.search = "";
	url.hash = "";
	url.pathname = url.pathname.replace(/\/$/, "");
	if (!url.pathname.endsWith("/chat/completions")) {
		url.pathname = `${url.pathname}/chat/completions`;
	}
	return {
		endpoint: url.toString(),
		host: url.host,
		requiresHostConfirmation: model.provider === "zai-platform",
	};
}

async function runSyntheticProbe(
	name: string,
	runner: () => Promise<{
		supported: ProbeSupport;
		status?: number;
		detail: string;
	}>,
): Promise<ProbeResult> {
	try {
		const result = await runner();
		return {
			name,
			supported: result.supported,
			httpStatus: result.status,
			detail: result.detail,
		};
	} catch (error) {
		return {
			name,
			supported: false,
			detail: error instanceof Error ? error.message : "probe failed",
		};
	}
}

async function postProbe(
	endpoint: string,
	headers: Record<string, string>,
	body: Record<string, unknown>,
): Promise<Response> {
	return fetch(endpoint, {
		method: "POST",
		headers,
		body: JSON.stringify(body),
		redirect: "error",
		signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
	});
}

async function discardBody(response: Response): Promise<void> {
	try {
		await response.body?.cancel();
	} catch {
		// Response content is deliberately not retained by capability probes.
	}
}

function formatSupport(value: ProbeSupport): string {
	if (value === true) return "ok";
	if (value === "unknown") return "unknown";
	return "no";
}

export function registerZaiCapabilitiesCommand(
	pi: ExtensionAPI,
	deps: ZaiCommandDeps,
): void {
	pi.registerCommand("zai-capabilities", {
		description:
			"Show Z.AI capability resolution and optional live probes (never automatic)",
		handler: async (args, ctx) => {
			const check = requireZaiModel(ctx);
			if ("error" in check) {
				ctx.ui.notify(check.error, "warning");
				return;
			}

			const model = check.model;
			const config = deps.getConfig(ctx.cwd);
			const capabilities = resolveZaiCapabilities(
				model,
				config.sessionAffinity,
			);
			const identity = probeIdentity(model);
			const sub = args.trim().split(/\s+/)[0]?.toLowerCase() || "status";

			if (sub === "probe") {
				let target: ProbeTarget;
				try {
					target = resolveProbeTarget(model);
				} catch (error) {
					ctx.ui.notify(
						error instanceof Error ? error.message : "Invalid probe endpoint.",
						"warning",
					);
					return;
				}
				const hostNotice = target.requiresHostConfirmation
					? ` Target host: ${target.host}.`
					: "";
				const confirmed = await ctx.ui.confirm(
					"Live capability probes",
					`Run four short synthetic Z.AI requests (may incur billing).${hostNotice} Continue?`,
				);
				if (!confirmed) {
					ctx.ui.notify("Capability probe cancelled.", "info");
					return;
				}

				const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
				if (!auth.ok) {
					ctx.ui.notify(
						"No credentials available for live probes on the active provider.",
						"warning",
					);
					return;
				}
				const headers = normalizedHeaders(auth.headers, auth.apiKey);
				if (
					!Object.keys(headers).some(
						(name) => name.toLowerCase() === "authorization",
					)
				) {
					ctx.ui.notify(
						"Resolved credentials do not contain an authorization header.",
						"warning",
					);
					return;
				}

				const endpoint = target.endpoint;
				const syntheticTool = {
					type: "function",
					function: {
						name: "ping",
						description: "Synthetic probe tool",
						parameters: { type: "object", properties: {} },
					},
				};
				const results: ProbeResult[] = [];

				results.push(
					await runSyntheticProbe("tool_choice=auto", async () => {
						const response = await postProbe(endpoint, headers, {
							model: model.id,
							messages: [{ role: "user", content: "Reply with OK" }],
							tools: [syntheticTool],
							tool_choice: "auto",
							max_tokens: 8,
						});
						await discardBody(response);
						return {
							supported: response.ok,
							status: response.status,
							detail: response.ok
								? "accepted"
								: `rejected with HTTP ${response.status}`,
						};
					}),
				);

				for (const choice of ["none", "required"] as const) {
					results.push(
						await runSyntheticProbe(`tool_choice=${choice}`, async () => {
							const response = await postProbe(endpoint, headers, {
								model: model.id,
								messages: [{ role: "user", content: "Reply with OK" }],
								tools: [syntheticTool],
								tool_choice: choice,
								max_tokens: 8,
							});
							await discardBody(response);
							return {
								supported: response.ok ? "unknown" : false,
								status: response.status,
								detail: response.ok
									? "accepted; semantic obedience not verified"
									: `rejected with HTTP ${response.status}`,
							};
						}),
					);
				}

				results.push(
					await runSyntheticProbe("tool_stream=true", async () => {
						const response = await postProbe(endpoint, headers, {
							model: model.id,
							messages: [{ role: "user", content: "Call ping" }],
							tools: [syntheticTool],
							tool_choice: "auto",
							stream: true,
							tool_stream: true,
							max_tokens: 8,
						});
						await discardBody(response);
						return {
							supported: response.ok,
							status: response.status,
							detail: response.ok
								? "accepted; streamed tool delta content not retained"
								: `rejected with HTTP ${response.status}`,
						};
					}),
				);

				const cache: ProbeCache = {
					...identity,
					results,
					updatedAt: new Date().toISOString(),
				};
				const persistenceError = writeProbeCache(cache);

				const lines = [
					...formatHeading("Z.AI capability probes"),
					...results.map(
						(result) =>
							`${result.name}: ${formatSupport(result.supported)} (${result.detail})`,
					),
					persistenceError
						? `Probe results could not be persisted: ${persistenceError}`
						: "Stored locally as status metadata only (no response bodies).",
				];
				ctx.ui.notify(joinCommandLines(lines), "info");
				return;
			}

			const cache = readProbeCache(identity);
			const lines = [
				...formatHeading("Z.AI capabilities"),
				formatKeyValue("Extension", deps.extensionVersion),
				formatKeyValue("Provider ownership", capabilities.providerOwnership),
				formatKeyValue("API family", capabilities.apiFamily),
				formatKeyValue(
					"Thinking format",
					capabilities.usesZaiThinkingFormat ? "zai" : "other/unknown",
				),
				formatKeyValue(
					"Tool stream metadata",
					capabilities.streamsToolCalls ? "yes" : "no",
				),
				formatKeyValue("Dynamic tools", capabilities.dynamicToolMode),
				formatKeyValue(
					"Tool choice API support",
					capabilities.toolChoiceSupportedByApi
						? "Responses-family yes"
						: "not claimed for this API",
				),
				formatKeyValue("Affinity source", capabilities.sessionAffinitySource),
				formatKeyValue(
					"Adaptive tools",
					config.adaptiveTools.unsupportedMode
						? `${config.adaptiveTools.requestedMode} → observe (unsupported in 0.5.0)`
						: config.adaptiveTools.mode,
				),
				formatKeyValue(
					"Last probe cache",
					cache
						? `${cache.updatedAt} (${cache.results.length} results)`
						: "none for this provider/model/endpoint",
				),
				"",
				"Use /zai-capabilities probe to run opt-in live checks.",
			];
			ctx.ui.notify(joinCommandLines(lines), "info");
		},
	});
}
