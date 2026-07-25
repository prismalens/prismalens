// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Live Phase-2 paired A/B eval (#68 Half A) — runs the SAME firing sreforge incident
 * through BOTH arms of {@link runPairedAB} and captures the per-incident DELTA (report +
 * tokens/cost + time-to-report). BOTH arms rent the same Claude Code harness with the
 * same incident-response skill and the same pinned model; the ONLY difference is the
 * PrismaLens supervisor overlay on arm (b), so the delta is pure supervisor/reduce value.
 *
 * Automated scoring is OUT OF SCOPE (Half B / sreforge #39) — the capture omits scores
 * (the default {@link unscored} oracle). This test writes the side-by-side capture that
 * the future public "PrismaLens vs raw agent" table draws from.
 *
 * Gated on OLLAMA_API_KEY (arm b's reduce) + the sreforge substrate + Claude Code auth
 * (~/.claude/.credentials.json or ANTHROPIC_API_KEY), so the default suite stays
 * hermetic (SKIPS with no env — never fails).
 *
 * Prereq: booklogr is up + armed (alert firing) — `pnpm forge arm booklogr`.
 *
 * Run:
 *   set -a && . packages/@prismalens/engine/.env && set +a \
 *     && pnpm --filter @prismalens/engine exec vitest run sreforge-phase2-ab
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { singleAlertContext } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { type ArmOutcome, runPairedAB } from "./ab-runner.js";
import { makeKeywordOracle } from "./interim-oracle.js";
import { fetchFiringAlerts } from "../src/supervisor/alert-source.js";

const KEY = process.env.OLLAMA_API_KEY;
const rawModel = process.env.OLLAMA_MODEL ?? "gpt-oss:120b";
const MODEL = rawModel.replace(/-cloud$/, "");
const BASE_URL = process.env.OLLAMA_BASE_URL ?? "https://ollama.com/v1";
// The pinned Claude model BOTH arms rent (clean-ablation invariant). Overridable.
const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-5";
// Points at a checkout of the sreforge live-eval harness (booklogr substrate);
// no default — the test only arms on machines that opt in via env.
const SUBSTRATE = process.env.SREFORGE_SUBSTRATE ?? "";
const CLAUDE_CREDS = join(homedir(), ".claude", ".credentials.json");

// sreforge's fixed compose host ports; overridable for remapped stacks.
const TELEMETRY = {
	prometheusUrl: process.env.SREFORGE_PROMETHEUS_URL ?? "http://localhost:9090",
	alertmanagerUrl:
		process.env.SREFORGE_ALERTMANAGER_URL ?? "http://localhost:9093",
	apiUrl: process.env.SREFORGE_API_URL ?? "http://localhost:5000",
};

const enabled =
	Boolean(KEY) &&
	existsSync(SUBSTRATE) &&
	(existsSync(CLAUDE_CREDS) || Boolean(process.env.ANTHROPIC_API_KEY));

// Repo-relative homes: the vendored skill plugin and the committed capture dir.
const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, "..");
const SKILL_PLUGIN_PATH = join(
	PKG_ROOT,
	"eval",
	"skills",
	"incident-response-plugin",
);
const CAPTURES_DIR = join(PKG_ROOT, "eval", "captures");

function slug(s: string): string {
	return (
		s
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "incident"
	);
}

function armLine(label: string, outcome: ArmOutcome): string {
	if (!outcome.ok) return `${label.padEnd(12)} FAILED: ${outcome.error}`;
	const t = outcome.tokens;
	const synth = outcome.providerCost.synthTokens;
	const synthStr = synth ? `  synth=${synth.input}/${synth.output}` : "";
	return `${label.padEnd(12)} $${outcome.costUsd.toFixed(4)}  claudeTok=${t.input}/${t.output}${synthStr}  ${(outcome.timeToReportMs / 1000).toFixed(1)}s  score=${outcome.score.score ?? "—"}`;
}

describe.skipIf(!enabled)(
	"sreforge booklogr — Phase-2 paired A/B eval (raw vs prismalens)",
	() => {
		it("runs the SAME incident through both arms and writes the side-by-side capture", async () => {
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

			const context = singleAlertContext(alerts[0], TELEMETRY);
			const scenario = slug(alerts[0].alertname);

			const capture = await runPairedAB(context, {
				cwd: SUBSTRATE,
				model: CLAUDE_MODEL,
				skillPluginPath: SKILL_PLUGIN_PATH,
				maxTurns: 40,
				scenario,
				synth: {
					providerId: "ollama",
					baseURL: BASE_URL,
					apiKey: KEY ?? "",
					model: MODEL,
					configured: true,
				},
				oracle: makeKeywordOracle(["pool_size", "connection pool", "sqlalchemy_engine_options"]),
			});

			console.log("\n================ PAIRED A/B CAPTURE ================");
			console.log(`scenario: ${scenario}   pinned model: ${CLAUDE_MODEL}`);
			console.log(armLine("raw", capture.raw));
			console.log(armLine("prismalens", capture.prismalens));
			if (capture.raw.ok && capture.prismalens.ok) {
				const dUsd = capture.prismalens.costUsd - capture.raw.costUsd;
				const dMs = capture.prismalens.timeToReportMs - capture.raw.timeToReportMs;
				console.log(
					`DELTA (prismalens − raw):  $${dUsd.toFixed(4)}   ${(dMs / 1000).toFixed(1)}s`,
				);
			}
			console.log("===================================================\n");

			mkdirSync(CAPTURES_DIR, { recursive: true });
			const outPath = join(
				CAPTURES_DIR,
				`sreforge-phase2-ab-${scenario}.json`,
			);
			writeFileSync(outPath, JSON.stringify(capture, null, 2));
			console.log(`capture written to ${outPath}\n`);

			// Loose assertions — Half A is eyeball-graded; just prove BOTH arms produced an
			// artifact and the capture was written (scoring is deferred to Half B).
			expect(capture.raw, "raw arm produced no outcome").toBeDefined();
			expect(
				capture.prismalens,
				"prismalens arm produced no outcome",
			).toBeDefined();
			expect(existsSync(outPath), "capture file not written").toBe(true);

			// When an arm ran, its terminal canonical event is a normal completion
			// (branch_done | report | error) or, for arm b, a trailing reduce llm_call.
			for (const outcome of [capture.raw, capture.prismalens]) {
				if (!outcome.ok) continue;
				const lastKind = outcome.events.at(-1)?.kind ?? "";
				expect(lastKind).toMatch(/branch_done|report|error|llm_call/);
			}
		}, 900_000);
	},
);
