#!/usr/bin/env node

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Packs @prismalens/agent-adapters for npm with its pinned adapters bundled and
// their optional native copies left out, so a consumer's install never pulls them (#818).

import { execFileSync } from "node:child_process";
import {
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG_DIR, "../../..");

export const NATIVE_COPIES =
	/node_modules\/(@anthropic-ai\/claude-agent-sdk-|@openai\/codex-)[a-z]/;

// Every licence text the bundled adapters and their agent libraries carry.
// @openai/codex ships no LICENSE or NOTICE: its declared licence is written out, and its
// NOTICE is kept verbatim in notices/ from github.com/openai/codex.
export const THIRD_PARTY = [
	{ pkg: "@agentclientprotocol/claude-agent-acp", files: ["LICENSE"] },
	{ pkg: "@anthropic-ai/claude-agent-sdk", files: ["LICENSE.md", "README.md"] },
	{ pkg: "@agentclientprotocol/codex-acp", files: ["LICENSE"] },
	{
		pkg: "@openai/codex",
		files: [],
		declared: "Apache-2.0",
		vendored: ["NOTICE"],
	},
];

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
	for (const [dep, spec] of Object.entries(manifest.dependencies ?? {})) {
		if (!/^\d+\.\d+\.\d+$/.test(spec))
			fail(`${dep} must be pinned exactly, not ${spec}`);
	}
	if (!existsSync(join(PKG_DIR, "dist", "index.js")))
		fail("dist/index.js is missing; build first");

	mkdirSync(staging, { recursive: true });
	cpSync(join(PKG_DIR, "dist"), join(staging, "dist"), {
		recursive: true,
		filter: (src) => !/\.(test\.js|tsbuildinfo|map)$/.test(src),
	});
	copyFileSync(join(PKG_DIR, "README.md"), join(staging, "README.md"));
	copyFileSync(join(ROOT, "LICENSE"), join(staging, "LICENSE"));
	writeFileSync(
		join(staging, "package.json"),
		`${JSON.stringify(stage(manifest), null, "\t")}\n`,
	);
	run(
		"npm",
		[
			"install",
			"--omit=optional",
			"--omit=dev",
			"--ignore-scripts",
			"--no-package-lock",
			"--no-audit",
			"--no-fund",
			"--loglevel",
			"warn",
		],
		staging,
	);

	for (const entry of readdirSync(join(staging, "node_modules"), {
		recursive: true,
	})) {
		if (/\.(map|tsbuildinfo)$/.test(entry))
			rmSync(join(staging, "node_modules", entry));
	}

	const licences = join(staging, "THIRD_PARTY_LICENSES");
	for (const { pkg, files, declared, vendored = [] } of THIRD_PARTY) {
		const from = join(staging, "node_modules", pkg);
		if (!existsSync(join(from, "package.json")))
			fail(`${pkg} is not in the bundled tree`);
		const to = join(licences, pkg);
		mkdirSync(to, { recursive: true });
		for (const file of files) {
			if (!existsSync(join(from, file))) fail(`${pkg} has no ${file}`);
			copyFileSync(join(from, file), join(to, file));
		}
		for (const file of vendored) {
			copyFileSync(join(PKG_DIR, "notices", pkg, file), join(to, file));
		}
		if (declared) {
			const { version, license } = JSON.parse(
				readFileSync(join(from, "package.json"), "utf8"),
			);
			if (license !== declared)
				fail(`${pkg} declares ${license}, not ${declared}`);
			writeFileSync(
				join(to, "LICENSE"),
				`${pkg}@${version} declares "license": "${license}" and ships no licence file.\nThe ${license} text follows.\n\n${readFileSync(join(ROOT, "LICENSE"), "utf8")}`,
			);
		}
	}
}

export function packAdapters({ outDir = join(PKG_DIR, "dist-pack") } = {}) {
	const manifest = readManifest();
	const staging = mkdtempSync(join(tmpdir(), "agent-adapters-"));
	try {
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
		const entries = run("tar", ["-tzf", tarball]).split("\n");
		const native = entries.find((e) => NATIVE_COPIES.test(e));
		if (native) fail(`the tarball carries a native copy: ${native}`);
		for (const dep of Object.keys(manifest.dependencies)) {
			if (!entries.includes(`package/node_modules/${dep}/package.json`))
				fail(`${dep} did not survive npm pack`);
		}
		return { tarball, entries };
	} finally {
		rmSync(staging, { recursive: true, force: true });
	}
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const { tarball } = packAdapters();
	console.log(tarball);
}
