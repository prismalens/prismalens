#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Prints, one per line and oldest first, the stable releases from 0.5.0 on that npm lists below
// <candidate>: the builds the installer smoke upgrades from (#920). Never a list kept in a workflow.
import crossSpawn from "cross-spawn";
import semver from "semver";
import { releasesFrom } from "../lib/upgrade-chain.mjs";

const candidate = process.argv[2];
if (!semver.valid(candidate)) {
	console.error("usage: previous-releases.mjs <candidate-version>");
	process.exit(2);
}
const r = crossSpawn.sync("npm", ["view", "prismalens", "versions", "--json"], {
	encoding: "utf8",
});
if (r.status !== 0) {
	console.error(r.stderr);
	process.exit(1);
}
const below = releasesFrom(JSON.parse(r.stdout)).filter((v) =>
	semver.lt(v, candidate),
);
if (below.length === 0) {
	console.error(`npm lists no release from 0.5.0 below ${candidate}`);
	process.exit(1);
}
console.log(below.join("\n"));
