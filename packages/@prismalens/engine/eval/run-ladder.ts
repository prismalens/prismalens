#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Single-rung ablation ladder runner (#220).
 * Runs one rung (L0, L1, L2, or L3) over a single firing incident and writes the
 * capture artifact to eval/captures-ablation/ (separate from campaign captures).
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { LLMProviderId } from "@prismalens/config/llm";
import { type FiringAlert, singleAlertContext } from "@prismalens/contracts";
import { fetchFiringAlerts } from "../src/supervisor/alert-source.js";
import {
	type ArmOptions,
	type ArmRun,
	type ArmScore,
	harnessFailure,
	runPrismalensArm,
	runRawArm,
} from "./ab-runner.js";
import { type Rung, rungArmOptions } from "./ladder.js";
import { rcaJudgeOracle } from "./rca-judge-oracle.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, "..");
const SKILL_PLUGIN_PATH = join(
	PKG_ROOT,
	"eval",
	"skills",
	"incident-response-plugin",
);
const ABLATION_CAPTURES_DIR = join(PKG_ROOT, "eval", "captures-ablation");

async function main(): Promise<void> {
	// 1. Environment contract checks
	const rungStr = process.env.RUNG?.trim();
	if (!rungStr || !["L0", "L1", "L2", "L3"].includes(rungStr)) {
		console.error(
			`[MISSING_RUNG] RUNG environment variable (L0|L1|L2|L3) is required, got "${rungStr ?? ""}"`,
		);
		process.exit(10);
	}
	const rung = rungStr as Rung;

	const incidentAlertname = process.env.INCIDENT_ALERTNAME?.trim();
	if (!incidentAlertname) {
		console.error(
			"[MISSING_INCIDENT_ALERTNAME] INCIDENT_ALERTNAME environment variable is required",
		);
		process.exit(11);
	}

	const ladderRun = process.env.LADDER_RUN?.trim();
	if (!ladderRun) {
		console.error(
			"[MISSING_LADDER_RUN] LADDER_RUN environment variable is required",
		);
		process.exit(12);
	}

	const scenario = process.env.INCIDENT_SCENARIO?.trim();
	if (!scenario) {
		console.error(
			"[MISSING_INCIDENT_SCENARIO] INCIDENT_SCENARIO environment variable is required",
		);
		process.exit(13);
	}

	const rcaJudgeModel = process.env.RCA_JUDGE_MODEL?.trim();
	const sreforgeRepo = process.env.SREFORGE_REPO?.trim();
	const sreforgeScenarioDir = process.env.SREFORGE_SCENARIO_DIR?.trim();

	if (!rcaJudgeModel || !sreforgeRepo || !sreforgeScenarioDir) {
		console.error(
			"[MISSING_RCA_JUDGE_MODEL] Judge configuration is required (RCA_JUDGE_MODEL, SREFORGE_REPO, SREFORGE_SCENARIO_DIR)",
		);
		process.exit(14);
	}

	const substrateCwd = process.env.SREFORGE_SUBSTRATE?.trim();
	if (!substrateCwd || !existsSync(substrateCwd)) {
		console.error(
			`[MISSING_SREFORGE_SUBSTRATE] SREFORGE_SUBSTRATE directory is required and must exist, got "${substrateCwd ?? ""}"`,
		);
		process.exit(15);
	}

	const telemetry = {
		prometheusUrl:
			process.env.SREFORGE_PROMETHEUS_URL ?? "http://localhost:9090",
		alertmanagerUrl:
			process.env.SREFORGE_ALERTMANAGER_URL ?? "http://localhost:9093",
		apiUrl: process.env.SREFORGE_API_URL ?? "http://localhost:5000",
	};

	// 2. Fetch firing alerts & require INCIDENT_ALERTNAME firing
	let firingAlerts: FiringAlert[];
	try {
		firingAlerts = await fetchFiringAlerts(telemetry.alertmanagerUrl);
	} catch (err) {
		console.error(
			`[ALERT_NOT_FIRING] Failed to fetch alerts from alertmanager at ${telemetry.alertmanagerUrl}: ${err instanceof Error ? err.message : String(err)}`,
		);
		process.exit(16);
	}

	const targetAlert = firingAlerts.find(
		(a) => a.alertname === incidentAlertname,
	);
	if (!targetAlert) {
		console.error(
			`[ALERT_NOT_FIRING] INCIDENT_ALERTNAME=${incidentAlertname} is not firing — got firing alerts: [${firingAlerts.map((a) => a.alertname).join(", ")}]`,
		);
		process.exit(17);
	}

	const context = singleAlertContext(targetAlert, telemetry, {
		service: { name: scenario, repo: substrateCwd },
	});

	// 3. Build options & execute arm
	// The pinned arm model is part of the qualification tuple (scenario, model,
	// harness, oracle) — a silent default here would bank runs against the wrong pin.
	const claudeModel = process.env.CLAUDE_MODEL?.trim();
	if (!claudeModel) {
		console.error(
			"[MISSING_CLAUDE_MODEL] CLAUDE_MODEL environment variable is required — the arm model must be pinned explicitly",
		);
		process.exit(19);
	}
	const rawSynthModel = process.env.OLLAMA_MODEL ?? "gpt-oss:120b";
	const synthModel = rawSynthModel.replace(/-cloud$/, "");
	const synthBaseUrl = process.env.OLLAMA_BASE_URL ?? "https://ollama.com/v1";
	const synthProvider =
		(process.env.PRISMALENS_EVAL_PROVIDER as LLMProviderId | undefined) ??
		(process.env.OLLAMA_API_KEY
			? "ollama"
			: process.env.OPENAI_API_KEY
				? "openai"
				: "ollama");

	const baseOpts: ArmOptions = {
		cwd: substrateCwd,
		model: claudeModel,
		skillPluginPath: SKILL_PLUGIN_PATH,
		synth: {
			providerId: synthProvider,
			model: synthModel,
			...(synthBaseUrl ? { baseURL: synthBaseUrl } : {}),
			apiKey: process.env.OLLAMA_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
			configured: true,
		},
		...(process.env.MAX_TURNS
			? { maxTurns: Number.parseInt(process.env.MAX_TURNS, 10) }
			: {}),
	};

	const armOpts = rungArmOptions(rung, baseOpts);

	let run: ArmRun;
	try {
		if (rung === "L3") {
			run = await runPrismalensArm(context, armOpts);
		} else {
			run = await runRawArm(context, armOpts);
		}
	} catch (err) {
		console.error(
			`[ARM_EXECUTION_FAILED] Arm execution threw error: ${err instanceof Error ? err.message : String(err)}`,
		);
		process.exit(18);
	}

	mkdirSync(ABLATION_CAPTURES_DIR, { recursive: true });
	const capturePath = join(
		ABLATION_CAPTURES_DIR,
		`ablation-${rung}-${scenario}-run${ladderRun}.json`,
	);

	// Guard 1: harness failure
	const harnessError = harnessFailure(run);
	if (harnessError !== null) {
		console.error(`[HARNESS_FAILURE] ${harnessError}`);
		const failureCapture = {
			ladder: true,
			rung,
			scenario,
			model: armOpts.model,
			incident: {
				alerts: context.alerts,
				telemetry: context.telemetry,
				...(context.service ? { service: context.service } : {}),
			},
			run: {
				ok: false,
				arm: run.arm,
				error: harnessError,
				alertSnapshot: null,
			},
			score: { score: null, note: harnessError },
			capturedAt: new Date().toISOString(),
		};
		writeFileSync(capturePath, JSON.stringify(failureCapture, null, 2));
		process.exit(20);
	}

	// Guard 2: L0 tool leak check.
	// A leak is a tool that RAN (result.ok true) — not a denied attempt. The model
	// can still name tools from the claude_code preset and try them; the SDK
	// rejects with "not enabled in this context" and no substrate information
	// flows. Denied attempts stay in the capture's events for analysis.
	if (rung === "L0") {
		const attempted = run.events.filter(
			(e) => e.kind === "agent_step" && e.toolCalls && e.toolCalls.length > 0,
		).length;
		if (attempted > 0) {
			console.error(
				`[L0_NOTE] model attempted ${attempted} denied tool call(s) — recorded, not a leak`,
			);
		}
		const leakedEvents = run.events.filter(
			(e) =>
				e.kind === "tool_result" &&
				(e.result as { ok?: boolean } | undefined)?.ok === true,
		);
		if (leakedEvents.length > 0) {
			// Name the leaked tools — the deny list is name-based, so the fix is
			// knowing exactly which name slipped through, and the events are the
			// only place that fact exists.
			const leakedNames = leakedEvents.map(
				(e) =>
					(e as { result?: { name?: string } }).result?.name ?? "<unnamed>",
			);
			console.error(
				`[L0_TOOLS_LEAKED] L0 run contained ${leakedEvents.length} tool-use events: [${leakedNames.join(", ")}]`,
			);
			const leakCapture = {
				ladder: true,
				rung,
				scenario,
				model: armOpts.model,
				incident: {
					alerts: context.alerts,
					telemetry: context.telemetry,
					...(context.service ? { service: context.service } : {}),
				},
				run: { ok: false, arm: run.arm, error: "L0_TOOLS_LEAKED", leakedNames },
				events: run.events,
				capturedAt: new Date().toISOString(),
			};
			writeFileSync(
				capturePath.replace(/\.json$/, ".LEAKED.json"),
				JSON.stringify(leakCapture, null, 2),
			);
			process.exit(21);
		}
	}

	// Guard 3: Judge scoring
	const oracle = rcaJudgeOracle({
		sreforgeRepo,
		scenarioDir: sreforgeScenarioDir,
		judgeEnv: { RCA_JUDGE_MODEL: rcaJudgeModel },
	});

	let scoreResult: ArmScore;
	try {
		scoreResult = await oracle({ ...run, alertSnapshot: null }, context);
	} catch (err) {
		console.error(
			`[JUDGE_UNREACHABLE] Judge oracle threw: ${err instanceof Error ? err.message : String(err)}`,
		);
		const unratedCapture = {
			ladder: true,
			rung,
			scenario,
			model: armOpts.model,
			incident: {
				alerts: context.alerts,
				telemetry: context.telemetry,
				...(context.service ? { service: context.service } : {}),
			},
			run,
			capturedAt: new Date().toISOString(),
		};
		writeFileSync(capturePath, JSON.stringify(unratedCapture, null, 2));
		process.exit(22);
	}

	if (scoreResult.score === null) {
		console.error(
			`[JUDGE_UNREACHABLE] Judge produced no score: ${scoreResult.note}`,
		);
		const unratedCapture = {
			ladder: true,
			rung,
			scenario,
			model: armOpts.model,
			incident: {
				alerts: context.alerts,
				telemetry: context.telemetry,
				...(context.service ? { service: context.service } : {}),
			},
			run,
			capturedAt: new Date().toISOString(),
		};
		writeFileSync(capturePath, JSON.stringify(unratedCapture, null, 2));
		process.exit(22);
	}

	// Exit 0 path: scored capture exists on disk
	const scoredCapture = {
		ladder: true,
		rung,
		scenario,
		model: armOpts.model,
		incident: {
			alerts: context.alerts,
			telemetry: context.telemetry,
			...(context.service ? { service: context.service } : {}),
		},
		run,
		score: scoreResult,
		capturedAt: new Date().toISOString(),
	};
	writeFileSync(capturePath, JSON.stringify(scoredCapture, null, 2));

	// Print capture path as the last stdout line
	console.log(capturePath);
}

main().catch((err) => {
	console.error(
		`[UNHANDLED_ERROR] ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
	);
	process.exit(99);
});
