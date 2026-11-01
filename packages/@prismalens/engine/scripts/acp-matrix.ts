// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Runs every behaviour-matrix row (#914) for one agent and prints one line per row:
 *   ROW <row>: pass|fail|n/a (<what the engine saw>)
 * scripts/admission-fake.mjs starts the scripted model and passes its env; on its own:
 *   PL_MATRIX_SIGNED_OUT='{"OPENAI_API_KEY":null}' tsx scripts/acp-matrix.ts codex [--only a,b]
 */
import {
	HARNESS_IDS,
	HARNESS_REGISTRY,
	type HarnessId,
} from "@prismalens/config/harness";
import { matrixRows } from "../../../../scripts/fakes/scripted-model.mjs";
import { checkRow, expectationFor, runRow } from "./acp-scenarios.js";
import { stubSearch } from "./stub-gateway.js";

const harness = process.argv[2] as HarnessId;
if (!HARNESS_IDS.includes(harness)) {
	console.error(`usage: acp-matrix.ts <${HARNESS_IDS.join("|")}> [--only a,b]`);
	process.exit(2);
}
const onlyAt = process.argv.indexOf("--only");
const only = onlyAt > -1 ? process.argv[onlyAt + 1]?.split(",") : undefined;

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
for (const row of matrixRows()) {
	if (only && !only.includes(row.row)) continue;
	const na = row.na?.[harness];
	if (na) {
		console.log(`ROW ${row.row}: n/a (${na})`);
		continue;
	}
	const { expect, why } = expectationFor(row, harness);
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
			: checkRow(harness, expect, seen, row.gateway);
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
