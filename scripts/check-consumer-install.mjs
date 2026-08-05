import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const tempRoot = mkdtempSync(join(tmpdir(), "pi-zai-consumer-install-"));
const packDirectory = join(tempRoot, "pack");
const consumerDirectory = join(tempRoot, "consumer");
const extensionPackage = "@groeponline/pi-zai";
const hostPackage = "@earendil-works/pi-coding-agent";
const leakedPackages = [
	hostPackage,
	"@google/genai",
	"@mimo-ai/cli",
	"freebuff",
	"protobufjs",
	"ws",
];

function packagePath(root, packageName) {
	return join(root, "node_modules", ...packageName.split("/"));
}

function runNpm(args, cwd) {
	return execFileSync(npmCommand, args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
}

function collectInstalledPackages(tree) {
	const installedPackages = new Set();
	const pendingDependencies = [tree.dependencies ?? {}];

	while (pendingDependencies.length > 0) {
		const dependencies = pendingDependencies.pop() ?? {};
		for (const [packageName, dependency] of Object.entries(dependencies)) {
			if (typeof dependency.version === "string") {
				installedPackages.add(packageName);
			}
			pendingDependencies.push(dependency.dependencies ?? {});
		}
	}

	return installedPackages;
}

try {
	mkdirSync(packDirectory, { recursive: true });
	mkdirSync(consumerDirectory, { recursive: true });

	const packOutput = runNpm(
		["pack", "--json", "--pack-destination", packDirectory],
		packageRoot,
	);
	const [packResult] = JSON.parse(packOutput);
	assert.ok(packResult?.filename, "npm pack did not return a tarball filename");

	const tarballPath = join(packDirectory, packResult.filename);
	const consumerManifest = {
		name: "pi-zai-consumer-check",
		private: true,
	};
	writeFileSync(
		join(consumerDirectory, "package.json"),
		`${JSON.stringify(consumerManifest, null, 2)}\n`,
	);

	runNpm(
		[
			"install",
			"--ignore-scripts",
			"--no-audit",
			"--no-fund",
			"--package-lock=false",
			tarballPath,
		],
		consumerDirectory,
	);

	const installedManifestPath = packagePath(
		consumerDirectory,
		`${extensionPackage}/package.json`,
	);
	assert.ok(
		existsSync(installedManifestPath),
		"packed extension was not installed",
	);

	const manifestJson = readFileSync(installedManifestPath, "utf8");
	const installedManifest = JSON.parse(manifestJson);
	assert.equal(
		installedManifest.peerDependenciesMeta?.[hostPackage]?.optional,
		true,
		`${hostPackage} must remain an optional peer dependency`,
	);

	const dependencyTree = JSON.parse(
		runNpm(["ls", "--all", "--json"], consumerDirectory),
	);
	const installedPackages = collectInstalledPackages(dependencyTree);
	for (const packageName of leakedPackages) {
		assert.equal(
			installedPackages.has(packageName),
			false,
			`standalone install unexpectedly provisioned ${packageName}`,
		);
	}
} finally {
	rmSync(tempRoot, { recursive: true, force: true });
}
