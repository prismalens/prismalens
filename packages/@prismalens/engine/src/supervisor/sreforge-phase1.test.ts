// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Live Phase-1 diagnosis eval — drives the full minimal Tier-1 supervisor against
 * a RUNNING sreforge booklogr incident and prints the ordered-evidence report for
 * eyeballing (no automated scorer yet — that's the deferred sreforge v2 `diagnose`
 * phase). Gated on OLLAMA_API_KEY + the substrate checkout being present, so the
 * default suite stays hermetic.
 *
 * Prereq: booklogr is up + armed (alert firing). See
 * ~/ai-context/sreforge-prismalens-phase1-handoff.md.
 *
 * Run:
 *   set -a && . packages/@prismalens/engine/.env && set +a \
 *     && pnpm --filter @prismalens/engine exec vitest run sreforge-phase1
 */
import { existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { singleAlertContext } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { fetchFiringAlerts } from "./alert-source.js";
import { deepAgentsHarness, investigateIncident } from "./investigate.js";

const KEY = process.env.OLLAMA_API_KEY;
const rawModel = process.env.OLLAMA_MODEL ?? "gpt-oss:120b";
const MODEL = rawModel.replace(/-cloud$/, "");
const HARNESS_MODEL = `openai:${MODEL}`; // deepagents -M needs the provider prefix
const BASE_URL = process.env.OLLAMA_BASE_URL ?? "https://ollama.com/v1";
// Points at a checkout of the sreforge live-eval harness (booklogr substrate);
// no default — the test only arms on machines that opt in via env.
const SUBSTRATE = process.env.SREFORGE_SUBSTRATE ?? "";

// sreforge's fixed compose host ports; overridable for remapped stacks.
const TELEMETRY = {
	prometheusUrl: process.env.SREFORGE_PROMETHEUS_URL ?? "http://localhost:9090",
	alertmanagerUrl:
		process.env.SREFORGE_ALERTMANAGER_URL ?? "http://localhost:9093",
	apiUrl: process.env.SREFORGE_API_URL ?? "http://localhost:5000",
};

const enabled = Boolean(KEY) && existsSync(SUBSTRATE);

describe.skipIf(!enabled)("sreforge booklogr — Phase-1 diagnosis eval", () => {
	it("investigates the firing incident and synthesizes an ordered-evidence report", async () => {
		const alerts = await fetchFiringAlerts(
			TELEMETRY.alertmanagerUrl,
			AbortSignal.timeout(5000),
		);
		console.log(
			`\nfiring alerts: ${alerts.map((a) => a.alertname).join(", ") || "(none)"}`,
		);
		expect(
			alerts.length,
			"no firing alert — run `pnpm forge arm booklogr` first",
		).toBeGreaterThan(0);

		const { runId, report, events } = await investigateIncident({
			context: singleAlertContext(alerts[0], TELEMETRY),
			harness: deepAgentsHarness({
				cwd: SUBSTRATE,
				model: HARNESS_MODEL,
				env: { OPENAI_API_KEY: KEY, OPENAI_BASE_URL: BASE_URL },
				promptTimeoutMs: 300_000,
				initTimeoutMs: 120_000,
			}),
			synth: {
				providerId: "ollama",
				baseURL: BASE_URL,
				apiKey: KEY ?? "",
				model: MODEL,
				configured: true,
			},
		});

		const counts = events.reduce<Record<string, number>>((m, e) => {
			m[e.kind] = (m[e.kind] ?? 0) + 1;
			return m;
		}, {});
		console.log(`\nrunId=${runId}  stream: ${JSON.stringify(counts)}`);
		console.log("\n================ ORDERED-EVIDENCE REPORT ================");
		console.log(`summary:      ${report.summary}`);
		console.log(`rootCause:    ${report.rootCause ?? "(null)"}`);
		console.log(`category:     ${report.rootCauseCategory ?? "(null)"}`);
		console.log("\nhypotheses (most → least plausible):");
		report.hypotheses.forEach((h, i) => {
			console.log(`  ${i + 1}. [${h.status}] ${h.statement}`);
			for (const e of h.evidence) {
				console.log(
					`       - (${e.direction}/${e.status}) ${e.observation}  ⟵ ${e.source}`,
				);
			}
		});
		if (report.ruledOut.length) {
			console.log("\nruled out:");
			for (const r of report.ruledOut)
				console.log(`  - ${r.statement} — ${r.why}`);
		}
		console.log(`\ncoverage.queried:    ${report.coverage.queried.join(", ")}`);
		console.log(
			`coverage.notQueried: ${report.coverage.notQueried.join(", ")}`,
		);
		console.log("\nnextSteps:");
		for (const s of report.nextSteps)
			console.log(`  - [${s.priority ?? "—"}] ${s.title}: ${s.detail}`);
		console.log("========================================================\n");

		const out = join(homedir(), "ai-context", "sreforge-phase1-report.json");
		writeFileSync(
			out,
			JSON.stringify({ runId, alert: alerts[0], report, events }, null, 2),
		);
		console.log(`full report + stream written to ${out}\n`);

		// Loose assertions — Phase-1 is eyeball-graded; just prove the pipeline produced a real report.
		expect(report.summary.length).toBeGreaterThan(0);
		expect(report.hypotheses.length).toBeGreaterThan(0);
		expect(events.at(-1)?.kind).toMatch(/branch_done|error|report/);
	}, 420_000);
});
