#!/usr/bin/env node

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Bundles each pinned ACP adapter into one ESM file under dist/adapters, with the licence
// texts of every package it inlines and a bundled.json that index.ts reads (#906).

import { createHash } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(PKG_DIR, "dist", "adapters");
const LICENCES = join(OUT, "licenses");

export const SDK = "@anthropic-ai/claude-agent-sdk";
export const ADAPTER = /^@agentclientprotocol\/.+-acp$/;
export const LICENCE_FILE = /^(licen[cs]e|copying|notice)(\..+)?$/i;

// codex-acp resolves @openai/codex only when CODEX_PATH is unset; the shipped adapter always
// gets CODEX_PATH (#818), so the package is neither inlined nor shipped.
const NOT_SHIPPED = new Set(["@openai/codex"]);

function fail(message) {
	throw new Error(`agent-adapters bundle: ${message}`);
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/** Node's lookup walk without `exports`, which hides package.json in some of these packages. */
export function packageDir(from, name) {
	for (let dir = from; ; dir = dirname(dir)) {
		const candidate = join(dir, "node_modules", ...name.split("/"));
		if (existsSync(join(candidate, "package.json")))
			return realpathSync(candidate);
		if (dirname(dir) === dir) fail(`${name} does not resolve from ${from}`);
	}
}

/** The package root of a metafile input under node_modules, or null for the adapter's own sources. */
export function packageRootOf(input) {
	const parts = input.split(/[\\/]/);
	const at = parts.lastIndexOf("node_modules");
	if (at === -1) return null;
	const width = parts[at + 1]?.startsWith("@") ? 3 : 2;
	if (parts.length < at + width) return null;
	return parts.slice(0, at + width).join("/");
}

function fingerprint(dir) {
	const hash = createHash("sha256");
	for (const file of ["package.json", "sdk.mjs"])
		hash.update(readFileSync(join(dir, file)));
	return hash.digest("hex");
}

function copyLicences(root, to) {
	mkdirSync(to, { recursive: true });
	const files = readdirSync(root).filter((f) => LICENCE_FILE.test(f));
	for (const file of files) copyFileSync(join(root, file), join(to, file));
	return files.length;
}

const licensed = new Map();

// A second inlined version of a package gets its own <name>/<version>/ (#913 review).
function licenceFor(root, name, version) {
	const first = licensed.get(name);
	if (first === version) return;
	if (first === undefined) licensed.set(name, version);
	const to = join(LICENCES, ...name.split("/"), ...(first ? [version] : []));
	if (existsSync(to)) return;
	if (copyLicences(root, to) === 0)
		fail(`${name}@${version} ships no licence text`);
}

export async function bundleAdapters() {
	const manifest = readJson(join(PKG_DIR, "package.json"));
	const adapters = Object.keys(manifest.devDependencies ?? {}).filter((d) =>
		ADAPTER.test(d),
	);
	if (adapters.length === 0)
		fail("no @agentclientprotocol/*-acp devDependency");
	const ownSdk = packageDir(PKG_DIR, SDK);

	rmSync(OUT, { recursive: true, force: true });
	licensed.clear();
	mkdirSync(LICENCES, { recursive: true });
	const bundled = {};
	for (const pkg of adapters) {
		const pkgDir = packageDir(PKG_DIR, pkg);
		const pkgJson = join(pkgDir, "package.json");
		const { version, bin } = readJson(pkgJson);
		const entry = join(
			pkgDir,
			typeof bin === "string" ? bin : Object.values(bin)[0],
		);
		const script = `${pkg.split("/")[1]}.mjs`;

		const result = await build({
			absWorkingDir: PKG_DIR,
			entryPoints: [entry],
			bundle: true,
			platform: "node",
			format: "esm",
			target: "node22",
			outfile: join(OUT, script),
			external: [SDK],
			// globalThis, not a binding: codex-acp's own bundle declares a top-level `require`.
			banner: {
				js: 'import { createRequire as __plCreateRequire } from "node:module"; globalThis.require ??= __plCreateRequire(import.meta.url);',
			},
			metafile: true,
			logLevel: "warning",
		});

		const inlined = new Set();
		for (const input of Object.keys(result.metafile.inputs)) {
			const rel = packageRootOf(input);
			if (!rel) continue;
			const root = resolve(PKG_DIR, rel);
			const { name, version: v } = readJson(join(root, "package.json"));
			inlined.add(`${name}@${v}`);
			licenceFor(root, name, v);
		}
		// A prebuilt upstream bundle (codex-acp) shows only its own file in the metafile:
		// its dependency closure is what it inlined.
		const walk = (from) => {
			for (const dep of Object.keys(
				readJson(join(from, "package.json")).dependencies ?? {},
			)) {
				if (dep === SDK || NOT_SHIPPED.has(dep)) continue;
				const root = packageDir(from, dep);
				const { name, version: v } = readJson(join(root, "package.json"));
				if (inlined.has(`${name}@${v}`)) continue;
				inlined.add(`${name}@${v}`);
				licenceFor(root, name, v);
				walk(root);
			}
		};
		walk(pkgDir);
		const own = `${pkg}@${version}`;
		inlined.add(own);
		licenceFor(pkgDir, pkg, version);

		const usesSdk = readJson(pkgJson).dependencies?.[SDK];
		if (usesSdk) {
			// pnpm keeps one copy per peer set (zod differs), so compare bytes, not realpaths.
			const theirs = packageDir(pkgDir, SDK);
			if (fingerprint(theirs) !== fingerprint(ownSdk))
				fail(`shipped SDK differs from the adapter's: ${ownSdk} vs ${theirs}`);
		}
		bundled[pkg] = { version, script, inlined: [...inlined].sort() };
		console.log(
			`bundled ${own} -> dist/adapters/${script} (${inlined.size} packages)`,
		);
	}

	const sdkTo = join(LICENCES, ...SDK.split("/"));
	mkdirSync(sdkTo, { recursive: true });
	for (const file of ["LICENSE.md", "README.md"])
		copyFileSync(join(ownSdk, file), join(sdkTo, file));

	writeFileSync(
		join(OUT, "bundled.json"),
		`${JSON.stringify(bundled, null, "\t")}\n`,
	);
	return bundled;
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	await bundleAdapters();
}
