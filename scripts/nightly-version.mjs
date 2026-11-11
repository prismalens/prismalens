#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// The nightly's version (#1024): `<next patch>-nightly.<YYYYMMDD>.<run number>`.
// It sorts above the current stable and below the next one, and a re-run keeps it.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import semver from "semver";

/**
 * @param {{ stable: string, date: string, run: string | number, above?: string | null }} input
 *   `stable` is release-please's manifest version; `above` the version npm's `nightly` tag holds now.
 */
export function nightlyVersion({ stable, date, run, above = null }) {
	if (!semver.valid(stable) || semver.prerelease(stable))
		throw new Error(`the stable version "${stable}" isn't a plain x.y.z`);
	if (!/^\d{8}$/.test(date))
		throw new Error(`the date "${date}" isn't YYYYMMDD`);
	if (!/^[1-9]\d*$/.test(String(run)))
		throw new Error(`the run number "${run}" isn't a positive integer`);
	const version = `${semver.inc(stable, "patch")}-nightly.${date}.${run}`;
	// An older run finishing late must not move the dist-tag backwards; equal is a re-run.
	if (above && semver.valid(above) && semver.lt(version, above))
		throw new Error(`${version} is below the published nightly ${above}`);
	return version;
}

/** Set `version` in one package.json, keeping its tab indentation. */
export function writeVersion(file, version) {
	const pkg = JSON.parse(readFileSync(file, "utf8"));
	pkg.version = version;
	writeFileSync(file, `${JSON.stringify(pkg, null, "\t")}\n`);
}

function arg(name) {
	const i = process.argv.indexOf(name);
	return i === -1 ? null : process.argv[i + 1];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	try {
		const version = nightlyVersion({
			stable: arg("--stable") ?? "",
			date: arg("--date") ?? "",
			run: arg("--run") ?? "",
			above: arg("--above"),
		});
		const file = arg("--write");
		if (file) writeVersion(file, version);
		console.log(version);
	} catch (error) {
		console.error(`nightly-version: ${error.message}`);
		process.exit(1);
	}
}
