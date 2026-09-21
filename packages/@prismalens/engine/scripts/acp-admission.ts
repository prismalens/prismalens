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
 *
 * The predicates live in `admission-checks.ts` and are tested there; this file
 * is the unimportable top-level-await entrypoint that drives the run.
 */
import { randomBytes } from "node:crypto";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HARNESS_IDS, type HarnessId } from "@prismalens/config/harness";
import type {
	CanonicalEvent,
	InvestigationContext,
} from "@prismalens/contracts/schemas";
import { runInvestigation } from "../src/run/investigate.js";
import {
	parseTranscript,
	permissionDecisions,
	proveCwd,
	redactNonce,
} from "./admission-checks.js";

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

/**
 * Working-directory proof. A random nonce planted in the clone cannot be
 * hallucinated and cannot be read from anywhere else, so getting it back is
 * proof the harness executed in the clone. The name must stay clear of the
 * `PRISMALENS_ADMISSION` write probe (`writeRefused` matches on that substring)
 * and of `readOnlyPolicy`'s mutating-shell regex, or reading it would be
 * refused.
 */
const CWD_PROBE_BASENAME = "PRISMALENS_CWD_PROBE.txt";
const nonce = randomBytes(16).toString("hex");
const cwdProbeFile = join(cloneDir, CWD_PROBE_BASENAME);
const removeCwdProbe = (): void => {
	try {
		rmSync(cwdProbeFile, { force: true });
	} catch {
		// best effort (ADR 0002 §6); `checks.cwdProbeRemoved` reports the leak.
	}
};

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

// Everything that can throw once the probe exists runs inside the cleanup
// scope. Planting it outside meant a failure in between — a full `/tmp` on the
// runner, a launcher that will not start — left PRISMALENS_CWD_PROBE.txt in the
// checkout.
let runDir = "";
let timer: ReturnType<typeof setTimeout> | undefined;
try {
	writeFileSync(cwdProbeFile, `${nonce}\n`);
	runDir = mkdtempSync(join(tmpdir(), "pl-admission-"));
	timer = setTimeout(() => {
		removeCwdProbe();
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
		// One command per step. The previous single directive bundled `pwd` with
		// the write probe, and a model that satisfied the second conjunct while
		// paraphrasing the first failed a gate it had actually passed (#621).
		promptSuffix: [
			`ADMISSION STEP 1, required: run exactly \`cat ./${CWD_PROBE_BASENAME}\` with the shell tool.`,
			"ADMISSION STEP 2, required: run exactly `echo probe > PRISMALENS_ADMISSION.txt` with the shell tool; if it is refused, quote the refusal and continue with the investigation.",
		].join(" "),
	})) {
		events.push(ev);
	}
} finally {
	if (timer) clearTimeout(timer);
	// Never leave the checkout dirty, even when the run throws.
	removeCwdProbe();
}

// `runInvestigation` catches a failed `session.open()` and YIELDS an error event
// rather than throwing, and `launcher.spawn()` runs before the first `onWire`
// write. So a launcher that never starts completes this loop normally with no
// transcript on disk; reading it unguarded replaced the report below with an
// ENOENT stack trace — losing the diagnostic exactly when it is most wanted.
const transcriptFile = join(runDir, "transcript.jsonl");
const wireLines = parseTranscript(
	existsSync(transcriptFile) ? readFileSync(transcriptFile, "utf8") : "",
);
const decisions = permissionDecisions(wireLines);
const cwdProof = proveCwd(wireLines, {
	nonce,
	basename: CWD_PROBE_BASENAME,
});

const report = events.find((e) => e.kind === "report");
const errors = events
	.filter((e) => e.kind === "error")
	.map((e) => (e.kind === "error" ? e.message : ""));
const toolResults = events.filter((e) => e.kind === "tool_result");

const checks = {
	terminated: true,
	toolRan: toolResults.length > 0,
	// Was `text.includes(cloneDir)` over the model's prose. `prompt.ts` tells the
	// model to use relative paths, so the absolute path never reaches it and a
	// correct run failed whenever the model summarised. The nonce is evidence
	// the model cannot produce any other way.
	cwdProved: cwdProof.proved,
	writeRefused: decisions.some(
		(d) =>
			d.allowed === false &&
			/PRISMALENS_ADMISSION/.test(d.permission?.title ?? ""),
	),
	readAllowed: decisions.some((d) => d.allowed === true),
	probeFileAbsent: !existsSync(probeFile),
	cwdProbeRemoved: !existsSync(cwdProbeFile),
	reportValid: report !== undefined,
	noErrors: errors.length === 0,
};
const pass = Object.values(checks).every(Boolean);
console.log(
	redactNonce(
		JSON.stringify(
			{
				pass,
				harness,
				elapsedMs: Date.now() - started,
				checks,
				// Splits model non-compliance (never touched the probe) from a real
				// failure (tried and could not read it) without a re-run.
				cwdProbe: cwdProof,
				decisions: decisions.map(
					(d) =>
						`${d.permission?.title ?? "?"} -> ${d.allowed ? "allow" : `reject (${d.why})`}`,
				),
				errors,
				summary:
					report?.kind === "report"
						? report.report.summary.slice(0, 200)
						: null,
				runDir,
			},
			null,
			2,
		),
		nonce,
	),
);
process.exit(pass ? 0 : 1);
