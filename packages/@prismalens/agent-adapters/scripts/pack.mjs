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

export const NATIVE_PACKAGE =
	/^(@anthropic-ai\/claude-agent-sdk-|@openai\/codex-)[a-z]/;
export const NATIVE_COPIES = new RegExp(
	`node_modules/${NATIVE_PACKAGE.source.slice(1)}`,
);

// Peers of @anthropic-ai/claude-agent-sdk that only its .d.ts files import.
export const UNUSED_PEERS = ["@anthropic-ai/sdk", "@modelcontextprotocol/sdk"];
const LOADS_UNUSED_PEER =
	/["'](@anthropic-ai\/sdk|@modelcontextprotocol\/sdk)["'/]/;

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
export function run(cmd, args, cwd) {
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

/** Drops the deps a consumer must never fetch; returns whether it dropped any. */
export function unfetchable(manifest) {
	const drop = [
		...Object.keys(manifest.optionalDependencies ?? {})
			.filter((name) => NATIVE_PACKAGE.test(name))
			.map((name) => ["optionalDependencies", name]),
		...UNUSED_PEERS.filter((name) => manifest.peerDependencies?.[name]).flatMap(
			(name) => [
				["peerDependencies", name],
				["peerDependenciesMeta", name],
			],
		),
	];
	for (const [field, name] of drop) {
		if (!manifest[field]) continue;
		delete manifest[field][name];
		if (!Object.keys(manifest[field]).length) delete manifest[field];
	}
	return drop.length > 0;
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
		withFileTypes: true,
	})) {
		if (!entry.isFile()) continue;
		const file = join(entry.parentPath, entry.name);
		if (/\.(map|tsbuildinfo)$/.test(entry.name)) rmSync(file);
		else if (/\.[cm]?js$/.test(entry.name)) {
			const inPeer = UNUSED_PEERS.some((peer) =>
				file.replaceAll("\\", "/").includes(`/node_modules/${peer}/`),
			);
			if (!inPeer && LOADS_UNUSED_PEER.test(readFileSync(file, "utf8")))
				fail(`${file} loads a peer the pack drops`);
		} else if (entry.name === "package.json") {
			// A bundled manifest's optional and peer deps are still fetched by the
			// consumer's next install from its lockfile (#916).
			const bundled = JSON.parse(readFileSync(file, "utf8"));
			if (unfetchable(bundled))
				writeFileSync(file, `${JSON.stringify(bundled, null, 2)}\n`);
		}
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
		const entries = run("tar", ["-tzf", name], outDir).split(/\r?\n/);
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
