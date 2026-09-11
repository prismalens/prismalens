// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Registry admission (ADR 0003 §10): a harness row is `verified` only when this
 * passes unattended against a real clone. Criteria, written before the first
 * run on prismalens#561: the agent works in the clone, a write is refused
 * through the permission policy, the stream terminates on its own, the report
 * validates within one retry, and the harness read only the config we wrote.
 *
 *   PRISMALENS_HARNESS_MODEL=opencode/muse-spark-1.3-contributor-free \
 *   tsx scripts/acp-admission.ts opencode /path/to/clone
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HARNESS_IDS, type HarnessId } from "@prismalens/config/harness";
import type {
	CanonicalEvent,
	InvestigationContext,
} from "@prismalens/contracts/schemas";
import { runInvestigation } from "../src/run/investigate.js";

const [harnessArg, cloneDir] = process.argv.slice(2);
if (!harnessArg || !cloneDir) {
	console.error("usage: acp-admission.ts <harnessId> <cloneDir>");
	process.exit(2);
}
if (!HARNESS_IDS.includes(harnessArg as HarnessId)) {
	console.error(
		`unknown harness ${harnessArg}; known: ${HARNESS_IDS.join(", ")}`,
	);
	process.exit(2);
}
const harness = harnessArg as HarnessId;
const probeFile = join(cloneDir, "PRISMALENS_ADMISSION.txt");
if (existsSync(probeFile)) rmSync(probeFile);
const runDir = mkdtempSync(join(tmpdir(), "pl-admission-"));
const timeoutMs = Number(
	process.env.PRISMALENS_ADMISSION_TIMEOUT_MS ?? 600_000,
);

const context: InvestigationContext = {
	alerts: [
		{
			alertname: "AdmissionProbe",
			severity: "warning",
			labels: { service: "admission" },
			annotations: {
				description:
					"Synthetic alert for the harness admission run. Find where this repository's main entry point is and name the file.",
			},
			startsAt: new Date().toISOString(),
		},
	],
	service: { name: "admission" },
};

const started = Date.now();
const events: CanonicalEvent[] = [];
const timer = setTimeout(() => {
	console.error(
		JSON.stringify({
			pass: false,
			reason: `timeout after ${timeoutMs}ms`,
			events: events.length,
		}),
	);
	process.exit(1);
}, timeoutMs);

for await (const ev of runInvestigation({
	runId: "00000000-0000-4000-8000-000000000001",
	context,
	harness,
	cwd: cloneDir,
	runDir,
	env: process.env,
	...(process.env.PRISMALENS_HARNESS_MODEL
		? { model: process.env.PRISMALENS_HARNESS_MODEL }
		: {}),
	initTimeoutMs: 120_000,
	promptTimeoutMs: timeoutMs,
	promptSuffix:
		"ADMISSION STEP, required: first run `pwd` with the shell tool and quote the output. Then run exactly `echo probe > PRISMALENS_ADMISSION.txt` with the shell tool; if it is refused, quote the refusal and continue with the investigation.",
})) {
	events.push(ev);
}
clearTimeout(timer);

const decisions = readFileSync(join(runDir, "transcript.jsonl"), "utf8")
	.split("\n")
	.filter(Boolean)
	.map((l) => JSON.parse(l) as { m: string })
	.map((e) => {
		try {
			return JSON.parse(e.m) as {
				permission?: { title?: string };
				allowed?: boolean;
				why?: string;
			};
		} catch {
			return {};
		}
	})
	.filter((e) => e.permission !== undefined);

const report = events.find((e) => e.kind === "report");
const errors = events
	.filter((e) => e.kind === "error")
	.map((e) => (e.kind === "error" ? e.message : ""));
const toolResults = events.filter((e) => e.kind === "tool_result");
const text = events
	.filter((e) => e.kind === "agent_step")
	.map((e) => (e.kind === "agent_step" ? e.text : ""))
	.join("\n");

const checks = {
	terminated: true,
	toolRan: toolResults.length > 0,
	cwdEchoed: text.includes(cloneDir),
	writeRefused: decisions.some(
		(d) =>
			d.allowed === false &&
			/PRISMALENS_ADMISSION/.test(d.permission?.title ?? ""),
	),
	readAllowed: decisions.some((d) => d.allowed === true),
	probeFileAbsent: !existsSync(probeFile),
	reportValid: report !== undefined,
	noErrors: errors.length === 0,
};
const pass = Object.values(checks).every(Boolean);
console.log(
	JSON.stringify(
		{
			pass,
			harness,
			elapsedMs: Date.now() - started,
			checks,
			decisions: decisions.map(
				(d) =>
					`${d.permission?.title ?? "?"} -> ${d.allowed ? "allow" : `reject (${d.why})`}`,
			),
			errors,
			summary:
				report?.kind === "report" ? report.report.summary.slice(0, 200) : null,
			runDir,
		},
		null,
		2,
	),
);
process.exit(pass ? 0 : 1);
