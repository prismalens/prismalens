#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Golden-incident scorecard runner (Phase B.3 pulled-forward eval slice — see the
 * hub plan's 004 §B.3: "B.3 can't be validated without evals").
 *
 * Drives the REAL reduce() (`supervisor/synthesize.ts`) with each fixture's
 * pre-recorded transcript. Two modes:
 *
 *   - OFFLINE (default, CI): NO live LLM call. A deterministic stub cannot honestly
 *     score a REAL model's reasoning, so offline mode does NOT pretend to — it only
 *     validates the harness PLUMBING (fixtures schema-parse, `buildTranscript`
 *     produces a sane transcript, `scoreReport` passes/fails as expected against a
 *     canned report). Exits 0 on success; this is a smoke test, not a model eval.
 *
 *   - LIVE (`PRISMALENS_EVAL_LIVE=1` + a provider key, e.g. `OLLAMA_API_KEY` /
 *     `OPENAI_API_KEY`): calls the real `reduce()` per fixture, scores the actual
 *     top-1 hypothesis against `expected.rootCauseKeywords`/`mustNotContain`, prints
 *     a scorecard table, and exits non-zero if fewer than `PRISMALENS_EVAL_THRESHOLD`
 *     (default 4) of 5 fixtures pass.
 *
 * Run: `pnpm --filter @prismalens/engine eval` (offline) or
 *      `PRISMALENS_EVAL_LIVE=1 OLLAMA_API_KEY=... pnpm --filter @prismalens/engine eval`.
 */
import { SYNTH_DEFAULTS } from "@prismalens/config/investigation";
import {
	getDefaultModel,
	LLM_PROVIDERS,
	type LLMProviderId,
} from "@prismalens/config/llm";
import {
	buildTranscript,
	reduce,
	type SynthesisModelConfig,
} from "../src/supervisor/synthesize.js";
import { type GoldenIncidentFixture, loadFixtures } from "./fixtures.js";
import { meetsThreshold, type ScoreResult, scoreReport } from "./score.js";

const LIVE = process.env.PRISMALENS_EVAL_LIVE === "1";
const THRESHOLD = Number.parseInt(
	process.env.PRISMALENS_EVAL_THRESHOLD ?? "4",
	10,
);

async function main(): Promise<void> {
	const fixtures = loadFixtures();

	if (!LIVE) {
		await runOffline(fixtures);
		return;
	}

	const synth = resolveLiveSynthConfig();
	if (!synth) {
		console.error(
			"PRISMALENS_EVAL_LIVE=1 but no provider credential was found in the " +
				"environment (e.g. OLLAMA_API_KEY / OPENAI_API_KEY). Set one, or unset " +
				"PRISMALENS_EVAL_LIVE to run the offline plumbing check instead.",
		);
		process.exitCode = 1;
		return;
	}

	console.log(
		`LIVE mode — scoring the REAL model (${synth.providerId}/${synth.model}) against ${fixtures.length} golden incidents.\n`,
	);

	const rows: Array<{ fixture: string } & ScoreResult> = [];
	for (const fx of fixtures) {
		const report = await reduce(fx.context, fx.transcriptEvents, synth);
		const score = scoreReport(report, fx.expected);
		rows.push({ fixture: fx.name, ...score });
	}

	printScorecard(rows);

	const passed = rows.filter((r) => r.pass).length;
	const ok = meetsThreshold(passed, fixtures.length, THRESHOLD);
	console.log(
		`\n${passed}/${fixtures.length} passed (threshold ${THRESHOLD}/${fixtures.length}) — ${ok ? "PASS" : "FAIL"}`,
	);
	process.exitCode = ok ? 0 : 1;
}

/**
 * Offline mode: honestly scores the PLUMBING, not the model. Verifies every
 * fixture schema-parsed (already true by the time `loadFixtures` returns),
 * `buildTranscript` produces a sane non-empty transcript naming the fixture's
 * firing alert, and `scoreReport` correctly passes a canned CORRECT report and
 * fails a canned WRONG one — i.e. the scoring function itself is exercised
 * end-to-end with no live LLM involved.
 */
async function runOffline(fixtures: GoldenIncidentFixture[]): Promise<void> {
	console.log(
		"OFFLINE mode — validating the eval HARNESS only (fixtures parse, " +
			"transcripts build, scoring logic works). This does NOT score a model — " +
			"set PRISMALENS_EVAL_LIVE=1 with a provider key for a real scorecard.\n",
	);

	for (const fx of fixtures) {
		const transcript = buildTranscript(fx.context, fx.transcriptEvents);
		if (!transcript.includes("FIRING ALERT")) {
			throw new Error(
				`eval: ${fx.name} — buildTranscript produced no transcript`,
			);
		}

		const correct = cannedReport(fx.expected.rootCauseKeywords[0]);
		if (!scoreReport(correct, fx.expected).pass) {
			throw new Error(
				`eval: ${fx.name} — scoreReport rejected an on-target report`,
			);
		}

		const wrong = cannedReport("an unrelated red herring statement");
		if (scoreReport(wrong, fx.expected).pass) {
			throw new Error(
				`eval: ${fx.name} — scoreReport accepted an off-target report`,
			);
		}

		console.log(`  ok  ${fx.name}`);
	}

	console.log(
		`\n${fixtures.length}/${fixtures.length} fixtures' plumbing verified — PASS`,
	);
}

function cannedReport(topHypothesisStatement: string) {
	return {
		summary: "canned",
		rootCause: null,
		rootCauseCategory: null,
		hypotheses: [
			{
				statement: topHypothesisStatement,
				status: "supported" as const,
				evidence: [],
			},
		],
		ruledOut: [],
		coverage: { queried: [], notQueried: [] },
		nextSteps: [],
	};
}

/**
 * Resolve LIVE mode's model config from the environment (BYO-key, ADR-0006 — the
 * engine never reads env itself; this eval runner is a caller, same as the CLI's
 * `run-investigation.ts`). `OLLAMA_API_KEY`/`OPENAI_API_KEY` are checked first (the
 * task's named defaults); `PRISMALENS_EVAL_PROVIDER`/`_MODEL`/`_API_KEY`/`_BASE_URL`
 * are an escape hatch for any other configured provider.
 */
function resolveLiveSynthConfig(): SynthesisModelConfig | null {
	const providerId =
		(process.env.PRISMALENS_EVAL_PROVIDER as LLMProviderId | undefined) ??
		(process.env.OLLAMA_API_KEY
			? "ollama"
			: process.env.OPENAI_API_KEY
				? "openai"
				: undefined);
	if (!providerId) return null;

	const apiKey =
		process.env.PRISMALENS_EVAL_API_KEY ??
		process.env.OLLAMA_API_KEY ??
		process.env.OPENAI_API_KEY ??
		process.env[LLM_PROVIDERS[providerId].envVar];
	const baseURL =
		process.env.PRISMALENS_EVAL_BASE_URL ??
		process.env.OLLAMA_BASE_URL ??
		process.env.OPENAI_BASE_URL ??
		(providerId === "ollama" ? SYNTH_DEFAULTS.baseURL : undefined);
	const model =
		process.env.PRISMALENS_EVAL_MODEL ?? getDefaultModel(providerId);
	if (!model) return null;

	return { providerId, model, apiKey, baseURL };
}

function printScorecard(rows: Array<{ fixture: string } & ScoreResult>): void {
	const nameWidth = Math.max(7, ...rows.map((r) => r.fixture.length));
	console.log(`${"fixture".padEnd(nameWidth)}  result  top hypothesis`);
	for (const r of rows) {
		const result = r.pass ? "PASS" : "FAIL";
		const detail = r.pass
			? r.topHypothesis
			: `${r.topHypothesis || "(no hypothesis)"}${
					r.violatedMustNotContain
						? ` [hit forbidden: "${r.violatedMustNotContain}"]`
						: ""
				}`;
		console.log(
			`${r.fixture.padEnd(nameWidth)}  ${result.padEnd(6)}  ${detail}`,
		);
	}
}

main().catch((err) => {
	console.error(err instanceof Error ? err.stack : err);
	process.exitCode = 1;
});
