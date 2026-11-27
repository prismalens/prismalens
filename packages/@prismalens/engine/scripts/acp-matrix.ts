// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Runs every behaviour-matrix row (#914) for one agent and prints one line per row:
 *   ROW <row>: pass|fail|n/a (<what the engine saw>)
 * scripts/admission-fake.mjs starts the scripted model and passes its env; on its own:
 *   PL_MATRIX_SIGNED_OUT='{"OPENAI_API_KEY":null}' tsx scripts/acp-matrix.ts codex [--only a,b] [--require]
 * `--require`: a row named in `--only` that is missing, misspelled or n/a for this agent fails the run.
 */
import {
	HARNESS_IDS,
	HARNESS_REGISTRY,
	type HarnessId,
} from "@prismalens/config/harness";
import { matrixRows } from "../../../../scripts/fakes/scripted-model.mjs";
import { runIsolationRow } from "./acp-isolation.js";
import {
	checkFailure,
	checkRow,
	expectationFor,
	runRow,
} from "./acp-scenarios.js";
import { runSharedSetRow } from "./acp-shared-set.js";
import { stubSearch } from "./stub-gateway.js";

const harness = process.argv[2] as HarnessId;
if (!HARNESS_IDS.includes(harness)) {
	console.error(`usage: acp-matrix.ts <${HARNESS_IDS.join("|")}> [--only a,b]`);
	process.exit(2);
}
const onlyAt = process.argv.indexOf("--only");
const only = onlyAt > -1 ? process.argv[onlyAt + 1]?.split(",") : undefined;
const required = process.argv.includes("--require");

const overrides = JSON.parse(
	process.env.PL_MATRIX_SIGNED_OUT ?? "{}",
) as Record<string, string | null>;
const signedOutEnv: NodeJS.ProcessEnv = { ...process.env };
for (const [key, value] of Object.entries(overrides)) {
	if (value === null) delete signedOutEnv[key];
	else signedOutEnv[key] = value;
}

console.log(`SEARCH ${stubSearch(harness) ? "on" : "off"}`);
let failed = 0;
const rows = matrixRows();
if (required)
	for (const name of only ?? [])
		if (!rows.some((r) => r.row === name)) {
			failed++;
			console.log(`ROW ${name}: fail (no such row, and --require names it)`);
		}
for (const row of rows) {
	if (only && !only.includes(row.row)) continue;
	const na = row.na?.[harness];
	if (na) {
		if (required) failed++;
		console.log(
			`ROW ${row.row}: ${required ? "fail" : "n/a"} (${na}${required ? "; --require names it" : ""})`,
		);
		continue;
	}
	if (row.run.isolation || row.run.sharedSet) {
		const started = Date.now();
		const { problem, saw } = await (row.run.sharedSet
			? runSharedSetRow(row, harness, process.env)
			: runIsolationRow(row, harness)
		).catch((e: unknown) => ({
			problem: `the runner threw: ${e instanceof Error ? e.message : String(e)}`,
			saw: "",
		}));
		if (problem) failed++;
		console.log(
			`ROW ${row.row}: ${problem ? `fail (${problem})` : "pass"} [${saw}; ${Math.round((Date.now() - started) / 1000)}s]`,
		);
		continue;
	}
	const { expect, why, failure } = expectationFor(row, harness);
	const seen = await runRow(row, {
		harness,
		env: process.env,
		signedOutEnv,
	}).catch((e: unknown) => ({
		events: [],
		elapsedMs: 0,
		agentSpoke: false,
		files: {},
		crash: e instanceof Error ? e.message : String(e),
	}));
	const problem =
		"crash" in seen
			? `the runner threw: ${seen.crash}`
			: (checkRow(harness, expect, seen, row.gateway) ??
				checkFailure(failure, seen));
	if (problem) failed++;
	const error = seen.events.find((e) => e.kind === "error");
	const ended =
		error?.kind === "error"
			? `error: ${error.message.slice(0, 100)}`
			: "no error";
	const label = `${expect}${why ? `, ${why}` : ""}; ${ended}; ${Math.round(seen.elapsedMs / 1000)}s`;
	console.log(
		`ROW ${row.row}: ${problem ? `fail (${problem})` : "pass"} [${label}]`,
	);
}
console.log(`matrix: ${HARNESS_REGISTRY[harness].label}, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
