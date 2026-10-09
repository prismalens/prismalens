// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type CanonicalEvent,
	type InvestigationWithRelations,
	isWorkflowLive,
	latestRun,
	type RunState,
	runState,
} from "@prismalens/contracts";
import {
	agentModelLabel,
	modelName,
	useAgentChoice,
} from "@/components/agent/AgentPicker";
import { formatElapsed } from "@/lib/format-time";
import type { RunRef } from "./record-context";

/** Which agent and model a run used: the report's fidelity, else what it started with, else the current choice. */
export function useRunAgentModel(
	investigation: InvestigationWithRelations | null,
): { agent: string; model: string; id: string | null } {
	const { harnesses, effective, model } = useAgentChoice();
	const fidelity = investigation?.report?.fidelity;
	if (fidelity) {
		const harness = harnesses.find((h) => h.id === fidelity.harness);
		const id = fidelity.servedModel ?? fidelity.model;
		return {
			agent: harness?.label ?? fidelity.harness,
			model: modelName(harness, id) ?? "agent default",
			id: fidelity.harness,
		};
	}
	if (investigation?.harness) {
		const harness = harnesses.find((h) => h.id === investigation.harness);
		return {
			agent: harness?.label ?? investigation.harness,
			model:
				modelName(harness, investigation.model) ??
				(harness?.modelVia === "unsupported"
					? "its own model"
					: "agent default"),
			id: investigation.harness,
		};
	}
	return { ...agentModelLabel(effective, model), id: effective?.id ?? null };
}

type Timed = {
	status: string;
	startedAt?: string | Date | null;
	completedAt?: string | Date | null;
	createdAt: string | Date;
	updatedAt?: string | Date;
};

/** Seconds a run has taken: ticking while live, frozen once it ended. */
export function runElapsed(run: Timed, now: number | null): number {
	const start = new Date(run.startedAt ?? run.createdAt).getTime();
	const ended =
		run.completedAt ??
		(isWorkflowLive(run.status) ? null : (run.updatedAt ?? null));
	const end = ended ? new Date(ended).getTime() : (now ?? start);
	return Math.max(0, Math.round((end - start) / 1000));
}

/**
 * Seconds the live turn has taken: a resumed run counts from its follow-up's
 * first message, not from the run's start hours ago (#673 walk 4, QA-02).
 */
export function turnElapsed(
	run: Timed,
	events: ReadonlyArray<CanonicalEvent>,
	now: number | null,
): number {
	if (!isWorkflowLive(run.status) || now === null) return runElapsed(run, now);
	for (let i = events.length - 1; i >= 0; i--) {
		const e = events[i];
		if (e?.kind === "operator_message" && e.resumed)
			return Math.max(0, Math.round((now - new Date(e.ts).getTime()) / 1000));
	}
	return runElapsed(run, now);
}

/** Whether a run kept any timing; a seeded run has neither start nor end. */
export function runTimed(run: Timed): boolean {
	return !!run.startedAt || !!run.completedAt || isWorkflowLive(run.status);
}

/** `Run #N`, counted from the incident's first run; `runs` is newest first. */
export function runNumber(runs: RunRef[], id: string): number {
	const at = runs.findIndex((r) => r.id === id);
	return at < 0 ? runs.length + 1 : runs.length - at;
}

/** A thread's name (#673 w59): an investigation is always `Run #N`, a chat its first message. */
export function runName(runs: RunRef[], run: RunRef): string {
	const title = run.kind === "chat" ? run.title?.trim() : null;
	return title || `Run #${runNumber(runs, run.id)}`;
}

export function refState(run: RunRef): RunState {
	return runState(run.status, { hasEvents: true });
}

/** A run's dot colour: live breathes, done ok, failed danger, stopped quiet. */
export function runDot(state: RunState): "live" | "ok" | "danger" | "quiet" {
	if (state === "done") return "ok";
	if (state === "failed") return "danger";
	if (state === "stopped") return "quiet";
	return "live";
}

export function elapsedWord(run: RunRef, now: number | null): string {
	const state = refState(run);
	if (state === "starting" || state === "working" || state === "stopping")
		return "Working";
	return runTimed(run) ? formatElapsed(runElapsed(run, now)) : "";
}

/** Where the run's model came from, in the status line and the report header. */
export function modelSource(
	investigation: InvestigationWithRelations,
	name: (id: string) => string,
): string {
	const f = investigation.report?.fidelity;
	if (f?.model && f.servedModel && f.servedModel !== f.model)
		return `substituted for ${name(f.model)}`;
	const source =
		f?.modelSource ?? (investigation.model ? "operator" : "harness-default");
	switch (source) {
		case "operator":
			return "model set in Settings";
		case "env":
			return "model set in the environment";
		case "product-default":
			return "PrismaLens's default model";
		default:
			return "the agent's own";
	}
}

/** The effort the agent accepted for this run, from its report or its first session_config event. */
export function runEffort(
	investigation: InvestigationWithRelations | null,
	events: {
		kind: string;
		option?: string;
		value?: string;
		accepted?: boolean;
	}[],
): string | null {
	const f = investigation?.report?.fidelity?.effort;
	if (f) return f;
	const set = events.find(
		(e) => e.kind === "session_config" && e.option === "effort" && e.accepted,
	);
	return set?.value ?? null;
}

/** The run a record opens on with no run in the URL: on Report the newest with a report, else the newest. */
export function openRun<
	R extends { createdAt: string | Date; hasReport?: boolean },
>(runs: readonly R[], onReport: boolean): R | null {
	return (
		(onReport
			? latestRun({ investigations: runs.filter((r) => r.hasReport) })
			: null) ?? latestRun({ investigations: runs })
	);
}
