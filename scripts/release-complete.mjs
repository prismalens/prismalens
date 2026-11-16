#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Fails unless a release carries every standalone archive and a SHA256SUMS that lists each one:
// what the npm launcher downloads, so nothing publishes to npm without it (#717).
//   node scripts/release-complete.mjs --dir <assets-dir> <version>   hashes checked too
//   node scripts/release-complete.mjs --release <tag> <version>      names, read with gh
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The targets scripts/build-standalone.mjs builds and scripts/launcher/prismalens.mjs runs. */
export const TARGETS = [
	"darwin-arm64",
	"darwin-x64",
	"linux-arm64",
	"linux-x64",
	"win32-x64",
];

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

/** Problems, empty when complete. `hashOf(name)` is null when the asset is absent. */
export function missing(version, assets, sumsText, hashOf) {
	if (sumsText === null) return ["SHA256SUMS is not attached"];
	const sums = parseSums(sumsText);
	const problems = [];
	for (const target of TARGETS) {
		const name = archiveName(version, target);
		if (!assets.has(name)) problems.push(`${name} is not attached`);
		if (!sums.has(name)) problems.push(`${name} is not in SHA256SUMS`);
		const actual = hashOf?.(name);
		if (actual && sums.has(name) && actual !== sums.get(name))
			problems.push(`${name} does not match SHA256SUMS`);
	}
	return problems;
}

function fromDir(dir, version) {
	const at = (name) => join(dir, name);
	const assets = new Set(
		TARGETS.map((t) => archiveName(version, t)).filter((n) =>
			existsSync(at(n)),
		),
	);
	const sums = existsSync(at("SHA256SUMS"))
		? readFileSync(at("SHA256SUMS"), "utf8")
		: null;
	return missing(version, assets, sums, (name) =>
		assets.has(name)
			? createHash("sha256")
					.update(readFileSync(at(name)))
					.digest("hex")
			: null,
	);
}

function fromRelease(tag, version) {
	const gh = (args) => execFileSync("gh", args, { encoding: "utf8" });
	const repo = process.env.GITHUB_REPOSITORY ?? "prismalens/prismalens";
	const assets = new Set(
		gh([
			"release",
			"view",
			tag,
			"-R",
			repo,
			"--json",
			"assets",
			"--jq",
			".assets[].name",
		])
			.split("\n")
			.filter(Boolean),
	);
	const sums = assets.has("SHA256SUMS")
		? gh([
				"release",
				"download",
				tag,
				"-R",
				repo,
				"-p",
				"SHA256SUMS",
				"-O",
				"-",
			])
		: null;
	return missing(version, assets, sums);
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const [mode, where, version] = process.argv.slice(2);
	if (!["--dir", "--release"].includes(mode) || !where || !version) {
		console.error(
			"usage: release-complete.mjs --dir <dir> | --release <tag>  <version>",
		);
		process.exit(2);
	}
	const problems =
		mode === "--dir" ? fromDir(where, version) : fromRelease(where, version);
	for (const p of problems) console.error(`::error::${p}`);
	if (problems.length) process.exit(1);
	console.log(`${where}: ${TARGETS.length} archives, each in SHA256SUMS`);
}
