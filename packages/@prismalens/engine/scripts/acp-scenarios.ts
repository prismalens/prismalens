// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The scenarios every supported agent is proven by (#914). The recorder drives
 * a real agent through one with `runScenario`; the replay test drives the same
 * run against its recording, so a recording is only ever replayed by the code
 * that made it.
 */
import type { AccessLevel } from "@prismalens/config/harness";
import type {
	CanonicalEvent,
	InvestigationContext,
} from "@prismalens/contracts/schemas";
import {
	isCancelledError,
	type RunInvestigationOptions,
	runInvestigation,
} from "../src/run/investigate.js";
import { denyAllPolicy } from "../src/run/permission.js";

export const SCENARIOS = [
	"report",
	"tool-call",
	"permission-declined",
	"cancel",
	"error",
	"not-signed-in",
] as const;
export type ScenarioName = (typeof SCENARIOS)[number];

export const SCENARIO_RUN_ID = "00000000-0000-4000-8000-0000000000a1";

const CONTEXT: InvestigationContext = {
	alerts: [
		{
			alertname: "ScenarioProbe",
			severity: "warning",
			labels: { service: "scenario" },
			annotations: {
				description:
					"Synthetic alert for the recorded-scenario run. Find the repository's main entry point and name the file.",
			},
			startsAt: "2026-01-01T00:00:00.000Z",
		},
	],
	service: { name: "scenario" },
};

interface Plan {
	accessLevel: AccessLevel;
	promptSuffix?: string;
	/** A model id no agent offers: the run must refuse it. */
	model?: string;
	/** Aborts the run when this event arrives. */
	abortOn?: (ev: CanonicalEvent) => boolean;
	/** The recorder starts the agent with no key and an empty home. */
	signedOut?: boolean;
}

const PLANS: Record<ScenarioName, Plan> = {
	report: { accessLevel: "auto" },
	"tool-call": {
		accessLevel: "auto",
		promptSuffix:
			"Run `ls` once in the repository before you answer, and cite its output.",
	},
	"permission-declined": {
		accessLevel: "supervised",
		promptSuffix:
			"Create a file named SCENARIO_NOTES.txt containing the word done, then report.",
	},
	cancel: {
		accessLevel: "auto",
		promptSuffix:
			"List every file in the repository recursively and read each one before you answer.",
		abortOn: (ev) => ev.kind === "agent_step" || ev.kind === "tool_result",
	},
	error: { accessLevel: "auto", model: "scenario-no-such-model" },
	"not-signed-in": { accessLevel: "auto", signedOut: true },
};

export const needsSignedOutAgent = (name: ScenarioName): boolean =>
	PLANS[name].signedOut === true;

export type ScenarioBase = Pick<
	RunInvestigationOptions,
	"harness" | "cwd" | "runDir" | "env" | "descriptor"
>;

export interface ScenarioRun {
	events: CanonicalEvent[];
	drift: string[];
}

/** Runs the real engine through one scenario against whatever agent `base` names. */
export async function runScenario(
	name: ScenarioName,
	base: ScenarioBase,
): Promise<ScenarioRun> {
	const plan = PLANS[name];
	const controller = new AbortController();
	const events: CanonicalEvent[] = [];
	const drift: string[] = [];
	for await (const ev of runInvestigation({
		...base,
		runId: SCENARIO_RUN_ID,
		context: CONTEXT,
		accessLevel: plan.accessLevel,
		...(plan.promptSuffix ? { promptSuffix: plan.promptSuffix } : {}),
		...(plan.model ? { model: plan.model } : {}),
		permission: denyAllPolicy,
		sandboxCheck: async () => ({}),
		initTimeoutMs: 60_000,
		promptTimeoutMs: 180_000,
		signal: controller.signal,
		onHarnessDrift: (message) => drift.push(message),
	})) {
		events.push(ev);
		if (plan.abortOn?.(ev)) controller.abort();
	}
	return { events, drift };
}

/** What the scenario must have produced, or the reason it did not. */
export function checkScenario(
	name: ScenarioName,
	run: ScenarioRun,
): string | null {
	const kinds = run.events.map((e) => e.kind);
	const errors = run.events.flatMap((e) =>
		e.kind === "error" ? [e.message] : [],
	);
	switch (name) {
		case "report":
			return kinds.includes("report") ? null : `no report (${kinds.join(",")})`;
		case "tool-call":
			return kinds.includes("tool_result") && kinds.includes("report")
				? null
				: `no tool result and report (${kinds.join(",")})`;
		case "permission-declined": {
			const answers = run.events.flatMap((e) =>
				e.kind === "permission_answer" ? [e.outcome] : [],
			);
			return answers.length > 0 &&
				!answers.some((o) => o === "approved" || o === "allowed")
				? null
				: `expected only refused asks, got ${JSON.stringify(answers)}`;
		}
		case "cancel":
			return errors.some(isCancelledError)
				? null
				: `not cancelled (${errors.join("; ")})`;
		case "error":
			return errors.length > 0 && !kinds.includes("report")
				? null
				: `expected a refusal and no report (${kinds.join(",")})`;
		case "not-signed-in":
			return errors.length > 0 && !kinds.includes("report")
				? null
				: `expected an error and no report (${kinds.join(",")})`;
	}
}
