#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Deletes nightly prereleases beyond the newest `--keep`, never a stable release, a draft, or a
// tag a published npm launcher downloads from (#717). A launcher pointed at a pruned nightly
// falls back to its recorded previous runtime.
//   node scripts/prune-nightlies.mjs [--keep 10] [--dry-run] [--releases <json>] [--registry <json>]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";

const NIGHTLY = /^v(\d+\.\d+\.\d+-nightly\.\d+\.\d+)$/;

/** The newest nightlies to keep: an explicit non-negative whole number, 10 when not given. */
export function keepCount(raw) {
	if (raw === undefined) return 10;
	if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)))
		throw new Error(
			`--keep takes a whole number of nightlies to keep, not "${raw}"`,
		);
	return Number(raw);
}

/** npm's metadata for prismalens, or an error: without it no tag can be known unprotected. */
export function packumentOf(status, body) {
	if (status < 200 || status >= 300)
		throw new Error(
			`npm's registry answered HTTP ${status}; nothing is pruned without it`,
		);
	if (
		!body ||
		typeof body.versions !== "object" ||
		body.versions === null ||
		Array.isArray(body.versions)
	)
		throw new Error(
			"npm's registry metadata has no versions; nothing is pruned without it",
		);
	return body;
}

/** The release tags any published launcher version names in `prismalens.release.tag`. */
export function protectedTags(packument) {
	return new Set(
		Object.values(packument?.versions ?? {})
			.map((v) => v?.prismalens?.release?.tag)
			.filter(Boolean),
	);
}

/** `{remove, keep}` tag lists; `releases` as `gh release list --json tagName,isPrerelease,isDraft`. */
export function plan(releases, protect, keep = 10) {
	const nightlies = releases
		.filter((r) => r.isPrerelease && !r.isDraft && NIGHTLY.test(r.tagName))
		.sort((a, b) =>
			semver.rcompare(NIGHTLY.exec(a.tagName)[1], NIGHTLY.exec(b.tagName)[1]),
		);
	const remove = nightlies
		.slice(keep)
		.map((r) => r.tagName)
		.filter((t) => !protect.has(t));
	return {
		remove,
		keep: releases.map((r) => r.tagName).filter((t) => !remove.includes(t)),
	};
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const args = process.argv.slice(2);
	const opt = (name) =>
		args.includes(name) ? (args[args.indexOf(name) + 1] ?? "") : undefined;
	let keep;
	try {
		keep = keepCount(opt("--keep"));
	} catch (error) {
		console.error(error.message);
		process.exit(2);
	}
	const repo = process.env.GITHUB_REPOSITORY ?? "prismalens/prismalens";
	const releases = JSON.parse(
		opt("--releases")
			? readFileSync(opt("--releases"), "utf8")
			: execFileSync(
					"gh",
					[
						"release",
						"list",
						"-R",
						repo,
						"--limit",
						"200",
						"--json",
						"tagName,isPrerelease,isDraft",
					],
					{ encoding: "utf8" },
				),
	);
	let packument;
	try {
		if (opt("--registry"))
			packument = packumentOf(
				200,
				JSON.parse(readFileSync(opt("--registry"), "utf8")),
			);
		else {
			const res = await fetch("https://registry.npmjs.org/prismalens");
			packument = packumentOf(res.status, res.ok ? await res.json() : null);
		}
	} catch (error) {
		console.error(error.message);
		process.exit(1);
	}
	const { remove } = plan(releases, protectedTags(packument), keep);
	for (const tag of remove) {
		console.log(
			`${args.includes("--dry-run") ? "would delete" : "delete"} ${tag}`,
		);
		if (!args.includes("--dry-run"))
			execFileSync(
				"gh",
				["release", "delete", tag, "-R", repo, "--cleanup-tag", "--yes"],
				{ stdio: "inherit" },
			);
	}
	if (!remove.length) console.log("nothing to prune");
}
