#!/usr/bin/env node

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Packs @prismalens/agent-adapters for npm: the single-file adapters from scripts/bundle.mjs,
// their licence texts, and the Claude Agent SDK copied flat without its native copies (#818, #906).

import { execFileSync } from "node:child_process";
import {
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG_DIR, "../../..");

export const NATIVE_COPIES =
	/node_modules\/(@anthropic-ai\/claude-agent-sdk-|@openai\/codex-)[a-z]/;

export const SDK = "@anthropic-ai/claude-agent-sdk";
export const STAGING = join(PKG_DIR, ".pack-staging");

// npm is a .cmd shim on Windows, which execFileSync cannot start directly.
function run(cmd, args, cwd) {
	const viaCmd = process.platform === "win32" && cmd === "npm";
	return execFileSync(
		viaCmd ? "cmd.exe" : cmd,
		viaCmd ? ["/d", "/c", cmd, ...args] : args,
		{ cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
	);
}

function fail(message) {
	throw new Error(`agent-adapters pack: ${message}`);
}

export function stage(manifest) {
	const {
		private: _private,
		devDependencies: _dev,
		scripts: _scripts,
		...rest
	} = manifest;
	return {
		...rest,
		bundleDependencies: Object.keys(manifest.dependencies ?? {}),
		files: ["dist", "THIRD_PARTY_LICENSES"],
		repository: {
			type: "git",
			url: "git+https://github.com/prismalens/prismalens.git",
			directory: "packages/@prismalens/agent-adapters",
		},
		publishConfig: { access: "public" },
	};
}

function readManifest() {
	return JSON.parse(readFileSync(join(PKG_DIR, "package.json"), "utf8"));
}

/** Writes the publishable package into `staging`; pack-cli.mjs stages its copy here too. */
export function stageAdapters(staging) {
	const manifest = readManifest();
	for (const [dep, spec] of Object.entries({
		...manifest.dependencies,
		...manifest.devDependencies,
	})) {
		if (dep.startsWith("@agentclientprotocol/") || dep === SDK)
			if (!/^\d+\.\d+\.\d+$/.test(spec))
				fail(`${dep} must be pinned exactly, not ${spec}`);
	}
	const licences = join(PKG_DIR, "dist", "adapters", "licenses");
	if (!existsSync(join(PKG_DIR, "dist", "index.js")))
		fail("dist/index.js is missing; build first");
	if (!existsSync(join(PKG_DIR, "dist", "adapters", "bundled.json")))
		fail("dist/adapters/bundled.json is missing; build first");

	mkdirSync(staging, { recursive: true });
	cpSync(join(PKG_DIR, "dist"), join(staging, "dist"), {
		recursive: true,
		filter: (src) =>
			!/\.(test\.js|tsbuildinfo|map)$/.test(src) &&
			relative(licences, src).startsWith(".."),
	});
	cpSync(licences, join(staging, "THIRD_PARTY_LICENSES"), { recursive: true });
	copyFileSync(join(PKG_DIR, "README.md"), join(staging, "README.md"));
	copyFileSync(join(ROOT, "LICENSE"), join(staging, "LICENSE"));
	writeFileSync(
		join(staging, "package.json"),
		`${JSON.stringify(stage(manifest), null, "	")}
`,
	);

	// Flat, as pack-cli.mjs stages its vendored packages: the platform copies stay out (#818).
	const from = realpathSync(join(PKG_DIR, "node_modules", ...SDK.split("/")));
	const to = join(staging, "node_modules", ...SDK.split("/"));
	cpSync(from, to, {
		recursive: true,
		filter: (src) =>
			!relative(from, src).split(sep).includes("node_modules") &&
			!/\.(map|tsbuildinfo)$/.test(src),
	});
	const sdk = JSON.parse(readFileSync(join(to, "package.json"), "utf8"));
	sdk["//"] =
		"dependencies and optionalDependencies dropped by @prismalens/agent-adapters scripts/pack.mjs (#818)";
	sdk.dependencies = undefined;
	sdk.optionalDependencies = undefined;
	writeFileSync(
		join(to, "package.json"),
		`${JSON.stringify(sdk, null, 2)}
`,
	);
}

export function packAdapters({ outDir = join(PKG_DIR, "dist-pack") } = {}) {
	const manifest = readManifest();
	const staging = STAGING;
	rmSync(staging, { recursive: true, force: true });
	stageAdapters(staging);
	mkdirSync(outDir, { recursive: true });
	const name = run(
		"npm",
		["pack", "--pack-destination", outDir, "--loglevel", "warn"],
		staging,
	)
		.trim()
		.split("\n")
		.pop();
	const tarball = join(outDir, name);
	// Relative, from its folder: GNU tar (Git Bash) reads `C:\...` as a remote host.
	const entries = run("tar", ["-tzf", name], outDir).split("\n");
	const native = entries.find((e) => NATIVE_COPIES.test(e));
	if (native) fail(`the tarball carries a native copy: ${native}`);
	const bundled = JSON.parse(
		readFileSync(join(PKG_DIR, "dist", "adapters", "bundled.json"), "utf8"),
	);
	for (const { script } of Object.values(bundled)) {
		if (!entries.includes(`package/dist/adapters/${script}`))
			fail(`dist/adapters/${script} did not survive npm pack`);
	}
	for (const dep of Object.keys(manifest.dependencies)) {
		if (!entries.includes(`package/node_modules/${dep}/package.json`))
			fail(`${dep} did not survive npm pack`);
	}
	return { tarball, entries };
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const { tarball } = packAdapters();
	console.log(tarball);
}
