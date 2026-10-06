// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type InvestigationWithRelations,
	isRunStateLive,
	isWorkflowLive,
	RUN_STATE_LABEL,
} from "@prismalens/contracts";
import {
	agentModelLabel,
	modelName,
	useAgentChoice,
} from "@/components/agent/AgentPicker";
import { StateWord } from "@/components/shared/StateWord";
import { useNow } from "@/hooks/use-now";
import { reconnectAsOf, useStreamStatus } from "@/lib/api/live-refresh";
import { formatClock, formatElapsed } from "@/lib/format-time";
import { runStepText } from "@/lib/investigation-events";
import { runStateTone } from "@/lib/state-tone";
import { cn } from "@/lib/utils";
import { useIncidentRecord } from "./record-context";

/**
 * Which agent and model a run used. The report's fidelity says what actually
 * ran; before that, the harness and model the run started with; a record
 * older than those fields falls back to the current choice (#743).
 */
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

/** Seconds a run has taken: ticking while live, frozen once it ended. */
export function runElapsed(
	investigation: InvestigationWithRelations,
	now: number | null,
): number {
	const start = new Date(
		investigation.startedAt ?? investigation.createdAt,
	).getTime();
	// An ended run with no completedAt (older records) stops at its last write.
	const ended =
		investigation.completedAt ??
		(isWorkflowLive(investigation.status) ? null : investigation.updatedAt);
	const end = ended ? new Date(ended).getTime() : (now ?? start);
	return Math.max(0, Math.round((end - start) / 1000));
}

/** Whether a run kept any timing: a seeded run has neither start nor end, and "0s" would be a guess (L55). */
export function runTimed(investigation: InvestigationWithRelations): boolean {
	return (
		!!investigation.startedAt ||
		!!investigation.completedAt ||
		isWorkflowLive(investigation.status)
	);
}

/**
 * The run's status (#743 §2): its state, agent, model, what it is doing and
 * elapsed, in the run's own words. At the right end of the tab row; on a
 * phone, its own line under the tabs (look ruling L90). The bar breathes on
 * the shared clock while the run works; quiet holds it amber; with the stream
 * lost it goes grey and the clock stops at when it was last seen.
 */
export function RunStrip({ phone = false }: { phone?: boolean }) {
	const { run } = useIncidentRecord();
	const now = useNow(1000);
	const stream = useStreamStatus();
	const investigation = run.investigation;
	const who = useRunAgentModel(investigation);
	if (!investigation || !run.state) return null;

	const state = run.state;
	const live = isRunStateLive(state);
	const lostAt = live && now !== null ? reconnectAsOf(stream, now) : null;
	const step =
		live && now !== null && lostAt === null
			? runStepText(run.events, now, { streamLost: run.streamFailed })
			: null;
	const quiet = !!step?.stale;

	return (
		<div
			className={cn(
				"flex min-w-0 items-center gap-3 whitespace-nowrap text-meta text-text-3 [view-transition-name:run-strip]",
				phone
					? "h-8 overflow-x-auto bg-surface-1 px-4 [scrollbar-width:none]"
					: "h-9 overflow-hidden",
			)}
			data-testid="run-strip"
			data-disconnected={lostAt !== null ? "" : undefined}
		>
			<span className="inline-flex shrink-0 items-center gap-1.5">
				{live && (
					<span
						aria-hidden
						className={cn(
							"h-3 w-[3px] rounded-full",
							lostAt !== null
								? "bg-text-3"
								: quiet
									? "bg-warn"
									: "breathe bg-live",
						)}
						data-testid="run-strip-mark"
					/>
				)}
				<StateWord
					tone={lostAt !== null ? "neutral" : runStateTone(state)}
					data-testid="run-strip-state"
				>
					{RUN_STATE_LABEL[state]}
				</StateWord>
			</span>
			<span
				className={cn(
					"min-w-0 items-center gap-3",
					phone ? "flex shrink-0" : "hidden shrink truncate sm:flex",
				)}
			>
				<span>{who.agent}</span>
				<span className="truncate">{who.model}</span>
			</span>
			{step && (
				<span
					key={step.text}
					className={cn(
						"min-w-0 truncate motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150",
						!phone && "flex-1",
						quiet && "text-warn",
					)}
					data-testid="run-strip-step"
				>
					{step.text}
				</span>
			)}
			{(lostAt !== null || runTimed(investigation)) && (
				<span
					className={cn(
						"shrink-0 font-medium tabular-nums",
						live ? "text-text-1" : "text-text-2",
						!step && !phone && "flex-1 text-right",
						lostAt !== null && "font-normal text-text-3",
					)}
					data-testid="run-strip-elapsed"
				>
					{lostAt !== null
						? `Last seen ${formatClock(lostAt)}`
						: formatElapsed(runElapsed(investigation, now))}
				</span>
			)}
		</div>
	);
}
