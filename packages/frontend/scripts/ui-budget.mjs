// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Writes ui-budget.json from design-matrix runs: `node scripts/ui-budget.mjs <dir>...`.
 * Each ceiling is the highest of those runs, so a count that varies by a row between
 * runs does not fail the next one. Raising one is an edit to the file with a
 * reason in the PR; the check then holds every later run to it.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { measures } from "./ui-measure.mjs";

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
	console.error("usage: node scripts/ui-budget.mjs <matrix dir>...");
	process.exit(2);
}
const previous = existsSync("ui-budget.json")
	? JSON.parse(readFileSync("ui-budget.json", "utf8"))
	: {};
function highest(runs) {
	const out = {};
	for (const run of runs)
		for (const [state, m] of Object.entries(run)) {
			out[state] ??= {};
			for (const [field, value] of Object.entries(m))
				out[state][field] = Math.max(out[state][field] ?? 0, value);
		}
	return out;
}

const budget = {
	$comment:
		"Per-state ceilings from the design matrix (pnpm ui:shots). A run fails when any number rises; raise one only with a reason in the PR. GUIDELINES.md explains each field.",
	rules: previous.rules ?? {
		emptyCopyWords: 5,
		oneStatePerRow: true,
		minContrast: 4.5,
		minTarget: 24,
	},
	states: highest(dirs.map(measures)),
};
writeFileSync("ui-budget.json", `${JSON.stringify(budget, null, "\t")}\n`);
console.log(
	`${Object.keys(budget.states).length} states written to ui-budget.json`,
);
