// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AccessLevel, HarnessId } from "@prismalens/config/harness";
import type { FollowUpKind } from "@prismalens/contracts";
import { useState } from "react";
import {
	AccessChip,
	defaultAccessOf,
	EffortChip,
	ModelChip,
	unreadyReason,
	useAgentChoice,
} from "@/components/agent/AgentPicker";
import type { DraftChoice } from "@/components/incidents/record-context";
import { runNumber } from "@/components/incidents/run-facts";
import {
	type ComposerAction,
	ComposerBox,
	type ComposerSend,
} from "@/components/investigation/ComposerBox";
import { RunDock } from "@/components/investigation/RunDock";
import { viewName } from "@/components/run/run-labels";
import { uploadAttachment } from "@/lib/attachments";
import { recheckBrief } from "@/lib/run-verb";
import type { Overview } from "./use-overview";

export type OverviewAction = "ask" | "investigate" | "note" | "message";

/** What Send can do on the overview (#811), and where each result goes. */
export function overviewActions(t: {
	live: string | null;
	nextName: string;
	reported: boolean;
}): {
	actions: ComposerAction[];
	hint: Record<string, string>;
	placeholder: Record<string, string>;
} {
	const note: ComposerAction = {
		id: "note",
		label: "Note",
		detail: "Goes on the timeline. The agent never reads it.",
		needsText: true,
	};
	const placeholder = {
		ask: "Ask about this incident",
		investigate: "Brief the agent (optional)",
		note: "Add a note",
		message: "Message the agent",
	};
	if (t.live)
		return {
			actions: [
				{
					id: "message",
					label: "Message",
					detail: `Goes to ${t.live} at its next pause.`,
					needsText: true,
				},
				note,
			],
			hint: {
				message: `Reaches ${t.live} at its next pause. You stay here.`,
				note: "Goes on the timeline. The agent never reads it.",
			},
			placeholder,
		};
	return {
		actions: [
			{
				id: "ask",
				label: "Ask",
				detail: "A question to the agent. No new report.",
				needsText: true,
			},
			{
				id: "investigate",
				label: t.reported ? "Investigate again" : "Investigate",
				detail: "A new run that ends in a report.",
				needsText: false,
			},
			note,
		],
		hint: {
			ask: "The answer appears under Stop the impact and as a conversation in the sidebar.",
			investigate: t.reported
				? `Starts ${t.nextName}. You stay here; this finding stands until ${t.nextName} reports.`
				: `Starts ${t.nextName}. You stay here; its finding lands on this page.`,
			note: "Goes on the timeline. The agent never reads it.",
		},
		placeholder,
	};
}

/**
 * The overview's chat box (#811), docked at reading width: Ask, Investigate
 * again or Note (Message and Note while a run is live). Every result lands
 * on this page; nothing navigates away.
 */
export function OverviewComposer({
	o,
	action,
	onAction,
}: {
	o: Overview;
	action: OverviewAction | null;
	onAction: (a: OverviewAction) => void;
}) {
	const record = o.record;
	const { incident, runs } = record;
	const choice = useAgentChoice();
	const [text, setText] = useState("");
	const live = o.live;
	const liveName = live ? viewName(runs, live) : null;
	const nextName = `Run ${runNumber(runs, "")}`;
	const t = overviewActions({
		live: liveName,
		nextName,
		reported: !!o.report,
	});
	const current =
		action && t.actions.some((a) => a.id === action)
			? action
			: (t.actions[0]?.id as OverviewAction);

	const own = record.draftChoice;
	const harness =
		choice.harnesses.find((h) => h.id === own.harness) ?? choice.effective;
	const hid = harness?.id as HarnessId;
	const model =
		own.model ?? (own.harness ? choice.models[hid] : choice.model) ?? "";
	const effort =
		own.effort !== undefined ? own.effort : (choice.efforts[hid] ?? null);
	const accessLevel: AccessLevel =
		own.accessLevel ?? defaultAccessOf(harness, choice.axes).level.level;
	const now: DraftChoice = hid
		? { harness: hid, model, effort, accessLevel }
		: {};
	const sent = {
		...(own.harness ? { harness: own.harness } : {}),
		...(own.model !== undefined ? { model: own.model } : {}),
		...(own.effort !== undefined ? { effort: own.effort } : {}),
	};

	const unready = harness ? unreadyReason(harness) : null;
	const agentBlocked =
		current === "note" || current === "message"
			? undefined
			: unready
				? `${unready}. Check it in Settings, Agent.`
				: record.investigateBlocked;

	const chips =
		current === "note" || current === "message" ? null : (
			<>
				<ModelChip
					harness={harness}
					model={model}
					disabled={!!agentBlocked}
					onPick={(h, m) =>
						record.setDraftChoice(
							h.id === hid
								? { ...now, model: m }
								: { harness: h.id as HarnessId, model: m },
						)
					}
				/>
				<EffortChip
					harness={harness}
					model={model}
					effort={effort}
					disabled={!!agentBlocked}
					onEffort={(e) => record.setDraftChoice({ ...now, effort: e })}
					onModel={(m) => record.setDraftChoice({ ...now, model: m })}
				/>
				<AccessChip
					harness={harness}
					level={accessLevel}
					disabled={!!agentBlocked}
					onLevel={(l) => record.setDraftChoice({ ...now, accessLevel: l })}
				/>
			</>
		);

	const onSend = async ({ text, files }: ComposerSend) => {
		if (current === "note")
			return new Promise<void>((resolve, reject) =>
				record.addNote(text, resolve, reject),
			);
		const attachments = await Promise.all(
			files.map((f) => uploadAttachment(incident.id, f)),
		);
		const ids = attachments.map((a) => a.id);
		if (current === "message") {
			const inv = o.latestRun.investigation;
			const kind: FollowUpKind | undefined =
				inv?.liveTurn === "report"
					? "continue"
					: inv?.liveTurn === "answer"
						? "chat"
						: undefined;
			await o.latestRun.sendMessage(text, "queue", {
				attachments,
				...(kind ? { kind } : {}),
			});
			return;
		}
		if (current === "ask")
			return record.chat({
				text,
				accessLevel,
				...sent,
				attachments: ids,
				stay: true,
			});
		const report = o.report;
		return record.investigate({
			text:
				report && o.reported
					? recheckBrief(report, runNumber(runs, o.reported.id), text)
					: text || undefined,
			accessLevel,
			...sent,
			attachments: ids,
			stay: true,
		});
	};

	const hint = t.hint[current];
	// The live run's asks open here too: the box that messages it is where it waits on you (#820).
	const latest = o.latestRun;
	const asks = latest.isActive
		? latest.asks.filter((a) => a.state === "waiting")
		: [];
	const dock =
		asks.length > 0 || latest.queued.length > 0 ? (
			<RunDock
				asks={asks}
				queued={latest.queued}
				runId={latest.investigation?.id}
				agent={harness?.label ?? "The agent"}
				cwd={latest.investigation?.workspace?.cwd}
			/>
		) : null;
	return (
		<div className="shrink-0 px-4 pt-2 pb-3" data-testid="overview-composer">
			<div className="mx-auto w-full max-w-[760px]">
				<ComposerBox
					actions={t.actions}
					action={current}
					onAction={(id) => onAction(id as OverviewAction)}
					chips={chips}
					onSend={onSend}
					placeholder={t.placeholder[current] ?? ""}
					text={text}
					setText={setText}
					agent={{
						label: harness?.label ?? "The agent",
						images:
							harness?.checked?.outcome === "answers-acp"
								? harness.checked.images
								: null,
					}}
					dock={dock}
					isPending={record.isStarting || record.isSavingNote}
					blockedReason={agentBlocked}
					above={
						hint ? (
							<p
								className="px-3 text-meta text-text-3"
								data-testid="composer-hint"
							>
								{hint}
							</p>
						) : null
					}
				/>
			</div>
		</div>
	);
}
