#!/usr/bin/env node
// Filtered npm-audit gate for the optional worker/telemetry subproject.
//
// Context: `worker/telemetry` is a private, optional Cloudflare Worker. It is
// excluded from the published `@groeponline/pi-zai` npm tarball (see the
// root `package.json` `files` allowlist), so its dev-only dependencies never
// reach consumers. `miniflare` pulls `sharp` for local image handling. The
// worker package pins `sharp` to a patched release via `overrides` when
// miniflare's own range is behind. Advisories that still cannot be fixed
// here belong in DEFERRED with an upstream owner and a reason.
//
// This script preserves the security value of `npm audit` for the worker: it
// still FAILS on any high/critical advisory that is not explicitly listed in
// DEFERRED below. To tolerate a new advisory, add it to DEFERRED with the
// upstream owner and the reason it cannot be fixed here.
import { spawnSync } from "node:child_process";
import { exit } from "node:process";

const WORKER_DIR = "worker/telemetry";
const GATE_LEVELS = new Set(["critical", "high"]);

// Explicitly deferred high/critical advisories. Keys are lowercase GHSA ids
// (npm audit sometimes emits uppercase). Each entry MUST state the upstream
// owner and why it is not fixable in this repo. Empty while sharp is pinned
// to a patched release.
const DEFERRED = new Map();

function ghsaId(url = "") {
	const m = String(url).match(/GHSA-[a-z0-9-]+/i);
	return m ? m[0].toLowerCase() : String(url).toLowerCase();
}

const res = spawnSync("npm", ["audit", "--json", "--prefix", WORKER_DIR], {
	encoding: "utf8",
});

let report;
try {
	report = JSON.parse(res.stdout);
} catch {
	console.error(
		res.stderr || res.stdout || "npm audit produced no JSON output",
	);
	exit(2);
}

const vulns = report.vulnerabilities ?? {};
const failed = [];
const tolerated = [];

for (const [pkg, info] of Object.entries(vulns)) {
	const advisories = (info.via ?? []).filter((v) => typeof v === "object");
	for (const adv of advisories) {
		const sev = adv.severity ?? "unknown";
		if (!GATE_LEVELS.has(sev)) continue;
		const id = ghsaId(adv.url);
		const title = adv.title ?? adv.name ?? pkg;
		if (DEFERRED.has(id)) {
			tolerated.push(
				`  ${pkg}: ${title} (${id}) — DEFERRED: ${DEFERRED.get(id)}`,
			);
		} else {
			const link = adv.url ? ` ${adv.url}` : "";
			failed.push(`  ${pkg}: ${title} (${id}) [${sev}]${link}`);
		}
	}
}

if (tolerated.length) {
	console.warn("worker audit: deferred (upstream-unfixed) advisories:");
	for (const t of tolerated) console.warn(t);
}

if (failed.length) {
	console.error(
		"\nworker audit: blocking high/critical advisories not on the defer list:",
	);
	for (const f of failed) console.error(f);
	console.error(
		"\nFix the above, or document them in DEFERRED (scripts/worker-audit.mjs) with an owner and reason.",
	);
	exit(1);
}

console.log(`worker audit: OK (${tolerated.length} deferred, 0 blocking).`);
