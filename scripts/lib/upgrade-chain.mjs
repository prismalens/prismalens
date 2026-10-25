// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Which releases an upgrade chain walks, read from what npm lists rather than from a file (#920).
import semver from "semver";

/** The first release whose databases a later one can open (#335); earlier ones are refused by name. */
export const CHAIN_FLOOR = "0.5.0";

/**
 * The stable releases from the floor up, oldest first.
 * @param {string[]} published every version `npm view prismalens versions` lists
 * @param {string} [floor]
 */
export function releasesFrom(published, floor = CHAIN_FLOOR) {
	return published
		.filter((v) => semver.valid(v) && !semver.prerelease(v))
		.filter((v) => semver.gte(v, floor))
		.sort(semver.compare);
}

/**
 * The version the candidate tarball is published under in the local registry: its own when
 * npm does not have it yet and it is ahead of every release, else the next patch after the newest.
 * @param {string} own the tarball's package.json version
 * @param {string[]} published
 */
export function candidateVersion(own, published) {
	const stable = published.filter(
		(v) => semver.valid(v) && !semver.prerelease(v),
	);
	const newest = stable.sort(semver.rcompare)[0];
	if (!newest) return own;
	return !published.includes(own) && semver.gt(own, newest)
		? own
		: (semver.inc(newest, "patch") ?? own);
}

/**
 * The upgrades the chain runs: each release to the next, the newest to the candidate, and the
 * oldest straight to the candidate, which skips every migration between.
 * @param {string[]} releases oldest first
 * @param {string} candidate
 * @returns {{ from: string, to: string, kind: "step" | "skip" }[]}
 */
export function hops(releases, candidate) {
	const path = [...releases, candidate];
	const steps = path.slice(0, -1).map((from, i) => ({
		from,
		to: /** @type {string} */ (path[i + 1]),
		kind: /** @type {const} */ ("step"),
	}));
	const [oldest] = releases;
	return oldest && releases.length > 1
		? [
				...steps,
				{ from: oldest, to: candidate, kind: /** @type {const} */ ("skip") },
			]
		: steps;
}
