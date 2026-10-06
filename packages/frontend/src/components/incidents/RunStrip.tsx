// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type InvestigationWithRelations,
	isRunStateLive,
	isWorkflowLive,
	RUN_STATE_LABEL,
} from "@prismalens/contracts";
import { useState } from "react";
import {
	agentModelLabel,
	modelName,
	useAgentChoice,
} from "@/components/agent/AgentPicker";
import { StateWord } from "@/components/shared/StateWord";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { useNow } from "@/hooks/use-now";
import { useToast } from "@/hooks/use-toast";
import { reconnectAsOf, useStreamStatus } from "@/lib/api/live-refresh";
import { formatClock, formatElapsed } from "@/lib/format-time";
import { getErrorMessage } from "@/lib/get-error-message";
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
): { agent: string; model: string } {
	const { harnesses, effective, model } = useAgentChoice();
	const fidelity = investigation?.report?.fidelity;
	if (fidelity) {
		const harness = harnesses.find((h) => h.id === fidelity.harness);
		const id = fidelity.servedModel ?? fidelity.model;
		return {
			agent: harness?.label ?? fidelity.harness,
			model: modelName(harness, id) ?? "agent default",
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
		};
	}
	return agentModelLabel(effective, model);
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

/**
 * The run's status (#743 §2), at the right end of the tab row: the
 * investigation's own words, never the incident's: state, agent and model,
 * what it is doing, elapsed, and Stop while it is live. With the stream lost,
 * the live mark goes grey and the clock stops at when it was last seen.
 */
export function RunStrip() {
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

	return (
		<div
			className="flex h-9 min-w-0 items-center gap-3 overflow-hidden whitespace-nowrap text-meta text-text-3 [view-transition-name:run-strip]"
			data-testid="run-strip"
			data-disconnected={lostAt !== null ? "" : undefined}
		>
			<span className="inline-flex shrink-0 items-center gap-1.5">
				{live && (
					<span
						aria-hidden
						className={cn(
							"h-3 w-[3px] rounded-full transition-colors duration-200 motion-reduce:transition-none",
							lostAt !== null ? "bg-text-3" : "bg-live",
						)}
						data-testid="run-strip-mark"
					/>
				)}
				<StateWord
					tone={lostAt !== null ? "neutral" : runStateTone(state)}
					quiet={state === "stopped"}
					className={cn(state === "stopped" && "text-text-2")}
					data-testid="run-strip-state"
				>
					{RUN_STATE_LABEL[state]}
				</StateWord>
			</span>
			<span className="hidden min-w-0 shrink items-center gap-3 truncate sm:flex">
				<span>{who.agent}</span>
				<span className="truncate">{who.model}</span>
			</span>
			{step && (
				<span
					key={step.text}
					className={cn(
						"min-w-0 flex-1 truncate motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150",
						step.stale && "text-warn",
					)}
					data-testid="run-strip-step"
				>
					{step.text}
				</span>
			)}
			<span
				className={cn(
					"shrink-0 font-medium text-text-1 tabular-nums",
					!step && "flex-1",
					lostAt !== null && "font-normal text-text-3",
				)}
				data-testid="run-strip-elapsed"
			>
				{lostAt !== null
					? `Last seen ${formatClock(lostAt)}`
					: formatElapsed(runElapsed(investigation, now))}
			</span>
			<div className="ml-auto flex shrink-0 items-center gap-1">
				{live && <StopButton />}
			</div>
		</div>
	);
}

/** Stop, behind a confirm: a stop is final for this run (#743 §4.5). */
function StopButton() {
	const { run } = useIncidentRecord();
	const { toast } = useToast();
	const [open, setOpen] = useState(false);
	const stopping = run.stopRequested;

	const confirm = () => {
		setOpen(false);
		run.stop({
			onError: (error) =>
				toast({
					title: "Stop did not reach the investigation",
					description: getErrorMessage(error),
					variant: "destructive",
				}),
		});
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="ghost"
					size="xs"
					className="text-danger hover:text-danger"
					disabled={stopping}
					data-testid="run-stop"
				>
					{stopping ? "Stopping" : "Stop"}
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				className="w-80 space-y-3 p-3"
				data-testid="run-stop-confirm"
				onOpenAutoFocus={(e) => {
					e.preventDefault();
					(e.currentTarget as HTMLElement)
						.querySelector<HTMLButtonElement>("[data-stop-run]")
						?.focus();
				}}
			>
				<div className="space-y-1">
					<p className="text-body font-medium">Stop this investigation?</p>
					<p className="text-body text-text-2">
						The agent stops at its current step. Everything it found so far
						stays in the conversation. You can start a new investigation
						afterwards.
					</p>
				</div>
				<div className="flex justify-end gap-2">
					<Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
						Keep going
					</Button>
					<Button
						variant="destructive"
						size="sm"
						onClick={confirm}
						data-stop-run
						data-testid="run-stop-confirm-button"
					>
						Stop
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}
