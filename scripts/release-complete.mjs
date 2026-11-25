#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Fails unless a release carries every standalone archive, each matching its SHA256SUMS line:
// what the npm launcher downloads, so no launcher publishes without it (#717).
//   node scripts/release-complete.mjs --dir <assets-dir> <version>
//   node scripts/release-complete.mjs --public <tag> <version> [--base <url>]   anonymous download
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

/** The targets scripts/build-standalone.mjs builds and scripts/launcher/launcher.mjs runs. */
export const TARGETS = [
	"darwin-arm64",
	"darwin-x64",
	"linux-arm64",
	"linux-x64",
	"win32-x64",
];

// GitHub, not the mirror: this checks the GitHub release the mirror is copied from.
export const DEFAULT_BASE =
	"https://github.com/prismalens/prismalens/releases/download";

export const archiveName = (version, target) =>
	`prismalens-${version}-${target}.${target.startsWith("win32") ? "zip" : "tar.gz"}`;

export function parseSums(text) {
	const sums = new Map();
	for (const line of text.split(/\r?\n/)) {
		const m = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim());
		if (m) sums.set(m[2], m[1].toLowerCase());
	}
	return sums;
}

/** Problems, empty when complete. `hashes` maps each archive present to its sha256. */
export function missing(version, hashes, sumsText) {
	if (sumsText === null) return ["SHA256SUMS is not attached"];
	const sums = parseSums(sumsText);
	const problems = [];
	for (const target of TARGETS) {
		const name = archiveName(version, target);
		if (!hashes.has(name)) problems.push(`${name} is not attached`);
		else if (!sums.has(name)) problems.push(`${name} is not in SHA256SUMS`);
		else if (hashes.get(name) !== sums.get(name))
			problems.push(`${name} does not match SHA256SUMS`);
	}
	return problems;
}

async function sha256(stream) {
	const hash = createHash("sha256");
	for await (const chunk of stream) hash.update(chunk);
	return hash.digest("hex");
}

export async function verifyDir(dir, version) {
	const hashes = new Map();
	for (const t of TARGETS) {
		const name = archiveName(version, t);
		if (existsSync(join(dir, name)))
			hashes.set(name, await sha256(createReadStream(join(dir, name))));
	}
	const sums = existsSync(join(dir, "SHA256SUMS"))
		? readFileSync(join(dir, "SHA256SUMS"), "utf8")
		: null;
	return missing(version, hashes, sums);
}

/** Reads the release as a stranger would: no token, so a draft or private asset is absent. */
async function anonymous(url) {
	if (url.startsWith("file:")) {
		const file = fileURLToPath(url);
		return existsSync(file) ? Readable.toWeb(createReadStream(file)) : null;
	}
	const res = await fetch(url, { signal: AbortSignal.timeout(600_000) });
	if (res.status === 404) return null;
	if (!res.ok) throw new Error(`GET ${url} returned HTTP ${res.status}`);
	return res.body;
}

/** Problems, and each present archive's sha256 keyed by target. */
export async function readPublic({ base, tag, version }) {
	const root = `${(base || DEFAULT_BASE).replace(/\/+$/, "")}/${tag}`;
	const sumsBody = await anonymous(`${root}/SHA256SUMS`);
	const sums = sumsBody ? await new Response(sumsBody).text() : null;
	const hashes = new Map();
	if (sums !== null) {
		for (const t of TARGETS) {
			const name = archiveName(version, t);
			const body = await anonymous(`${root}/${name}`);
			if (body) hashes.set(name, await sha256(body));
		}
	}
	const digests = Object.fromEntries(
		TARGETS.filter((t) => hashes.has(archiveName(version, t))).map((t) => [
			t,
			hashes.get(archiveName(version, t)),
		]),
	);
	return { problems: missing(version, hashes, sums), digests };
}

export async function verifyPublic(release) {
	return (await readPublic(release)).problems;
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const args = process.argv.slice(2);
	const [mode, where, version] = args;
	const base = args.includes("--base")
		? args[args.indexOf("--base") + 1]
		: undefined;
	if (!["--dir", "--public"].includes(mode) || !where || !version) {
		console.error(
			"usage: release-complete.mjs --dir <dir> <version> | --public <tag> <version> [--base <url>]",
		);
		process.exit(2);
	}
	const problems =
		mode === "--dir"
			? await verifyDir(where, version)
			: await verifyPublic({ base, tag: where, version });
	for (const p of problems) console.error(`::error::${p}`);
	if (problems.length) process.exit(1);
	console.log(`${where}: ${TARGETS.length} archives, each matching SHA256SUMS`);
}
