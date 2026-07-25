// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const outIdx = process.argv.indexOf("--out");
const outDir = outIdx !== -1 ? process.argv[outIdx + 1] : undefined;
const rcaIdx = process.argv.indexOf("--rca-file");
const rcaFile = rcaIdx !== -1 ? process.argv[rcaIdx + 1] : undefined;
const mode = process.env.FAKE_JUDGE_MODE || "happy";

// The real judge fail()s with exit 2 when --rca-file is missing or unreadable.
// Echoing the RCA text back through the diagnosis is what lets the test prove the
// arm's rawText actually reached the judge (an empty rca.md would otherwise be invisible).
if (!rcaFile || !existsSync(rcaFile)) {
	console.error(`rca-judge: --rca-file not found: ${rcaFile}`);
	process.exit(2);
}
const rcaText = readFileSync(rcaFile, "utf8").trim();

if (mode === "timeout") {
	await new Promise((resolve) => setTimeout(resolve, 600000));
}

if (mode === "nonzero") {
	console.error("rca-judge error: missing RCA_JUDGE_MODEL env");
	process.exit(2);
}

if (mode === "absent") {
	console.error(
		"rca-judge: wrote no diagnosis (best-effort): model unreachable",
	);
	process.exit(0);
}

if (!outDir) {
	console.error("missing --out argument");
	process.exit(1);
}

const outPath = join(outDir, "diagnosis.json");

if (mode === "malformed") {
	writeFileSync(outPath, "{ malformed json...");
	process.exit(0);
}

if (mode === "schema_mismatch") {
	const diag = {
		schema_version: "diagnosis.v2",
		run_id: "test-run-123",
		scenario: "test-scenario",
		score: 0.8,
		axes: {
			root_cause_correct: true,
			evidence_grounded: true,
			false_leads: false,
		},
		rationale: "v2 schema test",
		rubric_version: "2",
		judge_model: "test-model",
		judged_at: new Date().toISOString(),
	};
	writeFileSync(outPath, JSON.stringify(diag, null, 2));
	process.exit(0);
}

// happy path — `rationale` echoes the RCA text the oracle wrote to rca.md.
const diag = {
	schema_version: "diagnosis.v1",
	run_id: "test-run-123",
	scenario: "test-scenario",
	score: mode === "out_of_range" ? 85 : 0.8,
	axes: {
		root_cause_correct: true,
		evidence_grounded: true,
		false_leads: false,
	},
	rationale: `Root cause correctly identified as pool size | rca: ${rcaText}`,
	rubric_version: "1",
	judge_model: "test-judge-model",
	judged_at: new Date().toISOString(),
};
writeFileSync(outPath, JSON.stringify(diag, null, 2));
console.error(`rca-judge: wrote ${outPath} (score ${diag.score})`);

// A valid diagnosis followed by a non-zero exit — the judge is separately versioned,
// so the oracle must still honour the file it paid an LLM call for.
if (mode === "nonzero_with_file") process.exit(2);
process.exit(0);
