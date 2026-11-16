// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Holds a design-matrix run to ui-budget.json: `node scripts/check-ui-budget.mjs <dir>`.
 * Exit 1 when a state's count rises (contrast fails, small targets, clipped text,
 * sideways scroll, console errors, other axe findings, visible controls), or when the
 * facts shown twice on one screen pass the ratchet's `measure/facts` row (#1101).
 */
import { readFileSync } from "node:fs";
import { factCeiling, factRules, factTotal } from "./fact-repeats.mjs";
import { measures } from "./ui-measure.mjs";

const dir = process.argv[2];
if (!dir) {
	console.error("usage: node scripts/check-ui-budget.mjs <matrix dir>");
	process.exit(2);
}
const budget = JSON.parse(readFileSync("ui-budget.json", "utf8"));
const now = measures(dir);
const fails = [];
for (const [state, m] of Object.entries(now)) {
	const ceiling = budget.states[state];
	if (!ceiling) continue;
	for (const [field, value] of Object.entries(m))
		if (value > (ceiling[field] ?? 0))
			fails.push(`${state} ${field}: ${ceiling[field] ?? 0} -> ${value}`);
}
const missing = Object.keys(budget.states).filter((s) => !(s in now));
if (missing.length) fails.push(`states not measured: ${missing.join(", ")}`);
// Raising the row is an edit to registry.ratchet.tsv, which only the operator's label lets through.
const twice = factTotal(
	JSON.parse(readFileSync(`${dir}/matrix.json`, "utf8")).report,
	factRules("."),
);
const ceiling = factCeiling(readFileSync("registry.ratchet.tsv", "utf8"));
if (twice > ceiling)
	fails.push(
		`facts shown twice: ${ceiling} -> ${twice} (pnpm sim judge-evidence lists them; declare a deliberate repeat in registry/closed/fact.ts)`,
	);
else if (twice < ceiling)
	console.log(
		`facts shown twice: ${twice}, under the ratchet's ${ceiling}: lower measure/facts in registry.ratchet.tsv`,
	);
console.log(fails.length ? fails.join("\n") : "ui budget: pass");
process.exit(fails.length ? 1 : 0);
