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
import { rcaJudgeOracle } from "./rca-judge-oracle.js";
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

const SREFORGE_REPO = process.env.SREFORGE_REPO;
const SREFORGE_SCENARIO_DIR = process.env.SREFORGE_SCENARIO_DIR;

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

type FiringAlert = { alertname: string };

/**
 * The alert both arms are briefed on.
 *
 * `INCIDENT_ALERTNAME` names it for a campaign, where investigating the wrong
 * alert corrupts the batch silently. Unset, this falls back to the first firing
 * alert, which is fine for an ad-hoc run and is what the suite did before.
 */
function pickIncidentAlert<T extends FiringAlert>(alerts: T[]): T {
	const wanted = process.env.INCIDENT_ALERTNAME?.trim();
	if (!wanted) return alerts[0];

	const match = alerts.find((a) => a.alertname === wanted);
	if (!match) {
		throw new Error(
			`INCIDENT_ALERTNAME=${wanted} is not firing — got [${alerts
				.map((a) => a.alertname)
				.join(", ")}]. Refusing to investigate a different alert.`,
		);
	}
	return match;
}

/**
 * Writes the capture to a path nothing else holds, and returns it.
 * `CAMPAIGN_RUN_ID` separates the repeated cold runs of one scenario — without
 * it every run of a scenario targets the same path. The `wx` flag makes the
 * reservation atomic (`existsSync` then `writeFileSync` is not), so neither a
 * forgotten id nor a second live runner can truncate a paid run's artifact.
 */
function writeCapture(scenario: string, body: string): string {
	const runId = process.env.CAMPAIGN_RUN_ID?.trim();
	const base = `sreforge-phase2-ab-${scenario}${runId ? `-${slug(runId)}` : ""}`;
	for (let n = 1; n <= 1000; n++) {
		const candidate = join(
			CAPTURES_DIR,
			n === 1 ? `${base}.json` : `${base}-${n}.json`,
		);
		try {
			writeFileSync(candidate, body, { flag: "wx" });
			return candidate;
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
		}
	}
	throw new Error(`no free capture path for ${base} after 1000 attempts`);
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

			// Alertmanager order is not incident order. An armed stack also fires
			// load-plane furniture (`EdgeClientRequestJitter`), and taking alerts[0]
			// briefed both arms on the jitter alert while the judge went on scoring
			// against the scenario's pool-exhaustion oracle — a guaranteed low score
			// for the wrong reason, on both arms, that reads as "the agents failed".
			// Name the incident alert explicitly for a campaign; fail loudly if the
			// named one is not firing rather than silently investigating furniture.
			const incident = pickIncidentAlert(alerts);
			const context = singleAlertContext(incident, TELEMETRY);
			const scenario = slug(incident.alertname);

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
				oracle:
					SREFORGE_REPO && SREFORGE_SCENARIO_DIR && process.env.RCA_JUDGE_MODEL
						? rcaJudgeOracle({
								sreforgeRepo: SREFORGE_REPO,
								scenarioDir: SREFORGE_SCENARIO_DIR,
							})
						: makeKeywordOracle([
								"pool_size",
								"connection pool",
								"sqlalchemy_engine_options",
							]),
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
			const outPath = writeCapture(
				scenario,
				JSON.stringify(capture, null, 2),
			);
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
