// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HarnessId } from "@prismalens/config/harness";
import {
	type HarnessSetting,
	type HarnessStatus,
	isRunStateLive,
	RUN_STATE_LABEL,
} from "@prismalens/contracts";
import { useState } from "react";
import {
	defaultModeOf,
	EffortChip,
	ModeChip,
	ModelChip,
	modelName,
	unreadyReason,
	useAgentChoice,
} from "@/components/agent/AgentPicker";
import { useIncidentRecord } from "@/components/incidents/record-context";
import {
	modelSource,
	runEffort,
	runElapsed,
	runNumber,
	runTimed,
	useRunAgentModel,
} from "@/components/incidents/run-facts";
import { useNow } from "@/hooks/use-now";
import { useToast } from "@/hooks/use-toast";
import { useUpdateHarnessSettings } from "@/lib/api/hooks";
import { reconnectAsOf, useStreamStatus } from "@/lib/api/live-refresh";
import { uploadAttachment } from "@/lib/attachments";
import { composerMode } from "@/lib/composer-keys";
import { formatClock, formatElapsed } from "@/lib/format-time";
import { getErrorMessage } from "@/lib/get-error-message";
import { pinnedTo } from "@/lib/investigation-events";
import { cn } from "@/lib/utils";
import { ComposerBox } from "./ComposerBox";

/** What a chip choice changes: one of the three, the rest stay. */
type Choice =
	| { kind: "model"; harness: HarnessStatus; model: string }
	| { kind: "effort"; effort: string }
	| { kind: "mode"; mode: string };

/**
 * The box under the transcript (#673): a draft starts a run, a live run takes
 * messages, a finished one continues. On a run the chips read that run, and
 * changing one opens a draft prefilled with the run plus the change.
 */
export function DockedComposer({ branchId }: { branchId?: string }) {
	const record = useIncidentRecord();
	const { run, incident, runs, draft } = record;
	const { toast } = useToast();
	const choice = useAgentChoice();
	const [message, setMessage] = useState("");
	const update = useUpdateHarnessSettings();
	const who = useRunAgentModel(run.investigation);
	const inv = run.investigation;
	const live = !!run.state && isRunStateLive(run.state);
	const mode = composerMode(
		draft || !inv
			? null
			: {
					live,
					continuable: run.continuable,
					resumable: run.resumable && run.state !== "failed",
				},
	);

	const runHarness = choice.harnesses.find((h) => h.id === inv?.harness);
	const harness = draft ? choice.effective : runHarness;
	const model = draft ? choice.model : (inv?.model ?? "");
	const effort = draft
		? (choice.efforts[harness?.id as HarnessId] ?? null)
		: runEffort(inv, run.events);
	const agentMode = draft
		? (record.draftMode ?? defaultModeOf(harness, choice.agentModes))
		: (inv?.agentMode ?? "agent-default");

	const choose = (c: Choice) => {
		if (draft) {
			if (c.kind === "mode") return record.setDraftMode(c.mode);
			if (c.kind === "model")
				return update.mutate({
					harness: c.harness.id as HarnessSetting,
					models: { [c.harness.id]: c.model || null },
				});
			if (harness) update.mutate({ efforts: { [harness.id]: c.effort } });
			return;
		}
		// The draft is this run with one change: the run's agent, model and effort become the next run's.
		const h = c.kind === "model" ? c.harness : runHarness;
		if (h)
			update.mutate({
				harness: h.id as HarnessSetting,
				models: { [h.id]: (c.kind === "model" ? c.model : model) || null },
				...(c.kind === "effort" || effort
					? { efforts: { [h.id]: c.kind === "effort" ? c.effort : effort } }
					: {}),
			});
		record.newRun({
			agentMode:
				c.kind === "mode"
					? c.mode
					: c.kind === "model" && h?.id !== runHarness?.id
						? undefined
						: agentMode,
		});
	};

	const unready = draft && harness ? unreadyReason(harness) : null;
	const liveNumber = record.liveRun ? runNumber(runs, record.liveRun.id) : null;
	const blockedReason = !draft
		? undefined
		: liveNumber
			? `Run #${liveNumber} is working; message it or stop it`
			: unready
				? `${unready}. Check it in Settings, Agent.`
				: record.investigateBlocked;
	const blocked = draft && !!blockedReason;

	const chips = (
		<>
			<ModelChip
				harness={harness}
				model={model}
				disabled={blocked}
				onPick={(h, m) => choose({ kind: "model", harness: h, model: m })}
			/>
			<EffortChip
				harness={harness}
				model={model}
				effort={effort}
				disabled={blocked}
				onEffort={(e) => choose({ kind: "effort", effort: e })}
				onModel={(m) => harness && choose({ kind: "model", harness, model: m })}
			/>
			<ModeChip
				harness={harness}
				mode={agentMode}
				disabled={blocked}
				onMode={(m) => choose({ kind: "mode", mode: m })}
			/>
		</>
	);

	const upload = (files: File[]) =>
		Promise.all(files.map((f) => uploadAttachment(incident.id, f)));
	const talksTo = draft ? choice.effective : runHarness;

	return (
		<div className="shrink-0 pb-3" data-testid="docked-composer">
			<ComposerBox
				mode={mode}
				chips={chips}
				text={draft ? record.draftText : message}
				setText={draft ? record.setDraftText : setMessage}
				autoFocus={draft}
				enterInvestigates={incident.alertCount > 0}
				agent={{
					label: talksTo?.label ?? who.agent,
					images:
						talksTo?.checked?.outcome === "answers-acp"
							? talksTo.checked.images
							: null,
				}}
				waiting={run.waiting}
				isPending={record.isStarting}
				stopping={run.stopRequested}
				blockedReason={blockedReason}
				onNewRun={() => record.newRun()}
				onStop={() =>
					run.stop({
						onError: (error) =>
							toast({
								title: "Stop did not reach the agent",
								description: getErrorMessage(error),
								variant: "destructive",
							}),
					})
				}
				onInvestigate={async ({ text, files }) => {
					const attachments = await upload(files);
					await record.investigate({
						text: text || undefined,
						agentMode,
						attachments: attachments.map((a) => a.id),
					});
				}}
				onAsk={async ({ text, files }) => {
					const attachments = await upload(files);
					await record.chat({
						text,
						agentMode,
						attachments: attachments.map((a) => a.id),
					});
				}}
				onMessage={async ({ text, files }, send) => {
					const attachments = await upload(files);
					await run.sendMessage(text, send, { branchId, attachments });
				}}
				undeliverable={run.undeliverable}
				onSaveAsNote={(text) => record.addNote(text, run.clearUndeliverable)}
				status={draft ? null : <RunStatusLine />}
			/>
		</div>
	);
}

/** The run's own facts under the box (#673): which run, its state, its code, where its model came from. */
function RunStatusLine() {
	const { run, runs, incident } = useIncidentRecord();
	const { harnesses } = useAgentChoice();
	const now = useNow(1000);
	const stream = useStreamStatus();
	const inv = run.investigation;
	if (!inv || !run.state) return null;
	const live = isRunStateLive(run.state);
	// With the stream lost the clock stops at when the run was last heard from.
	const lostAt = live && now !== null ? reconnectAsOf(stream, now) : null;
	const took = runTimed(inv) ? formatElapsed(runElapsed(inv, now)) : null;
	const state = RUN_STATE_LABEL[run.state];
	const sha = pinnedTo(inv.workspace);
	const service = incident.service?.displayName || incident.service?.name;
	const harness = harnesses.find((h) => h.id === inv.harness);
	return (
		<div
			className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 pt-0.5 text-meta text-text-3"
			data-testid="run-status"
			data-disconnected={lostAt !== null ? "" : undefined}
		>
			<span className="inline-flex items-center gap-1.5 text-text-2">
				Run #{runNumber(runs, inv.id)}
				<span className="text-[11px] text-text-3">
					{inv.kind === "chat" ? "Chat" : "Investigation"}
				</span>
			</span>
			<span
				className={cn(
					"tabular-nums",
					live && lostAt === null && "text-live",
					run.state === "failed" && "text-danger",
				)}
				data-testid="run-status-state"
			>
				{lostAt !== null
					? `${state}, last seen ${formatClock(lostAt)}`
					: live
						? `${state}${took ? ` ${took}` : ""}`
						: `${state}${took ? ` after ${took}` : ""}`}
			</span>
			{sha && (
				<span>
					{service ? `${service} at ` : "Code at "}
					<span className="font-mono">{sha}</span>
				</span>
			)}
			<span>{modelSource(inv, (id) => modelName(harness, id) ?? id)}</span>
			<span>A different agent, model or mode starts a new run</span>
		</div>
	);
}
