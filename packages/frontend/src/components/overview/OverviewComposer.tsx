// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AccessLevel, HarnessId } from "@prismalens/config/harness";
import type { FollowUpKind } from "@prismalens/contracts";
import { useState } from "react";
import {
	defaultAccessOf,
	unreadyLine,
	useAgentChoice,
} from "@/components/agent/AgentPicker";
import type { DraftChoice } from "@/components/incidents/record-context";
import { runNumber } from "@/components/incidents/run-facts";
import { RunDock } from "@/components/investigation/RunDock";
import { viewName } from "@/components/run/run-labels";
import {
	actionProps,
	Composer,
	type ComposerAction,
	type ComposerChoice,
} from "@/components/thread/Composer";
import { uploadAttachment } from "@/lib/attachments";
import {
	messageContext,
	messageFields,
	type SendEnvelope,
	uploadEach,
} from "@/lib/composer-send";
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
			// The overview is for a thread with no run; the first run opens on its transcript (#1020).
			ask: "Opens the conversation; the agent answers there.",
			investigate: `Starts ${t.nextName} and opens it.`,
			note: "Goes on the timeline. The agent never reads it.",
		},
		placeholder,
	};
}

/**
 * The agent, model, effort and level the overview box shows, and what a start
 * sends for them; the Next strip starts with the same (w8-7).
 */
export function useBoxChoice(record: Overview["record"]) {
	return boxChoice(useAgentChoice(), record.draftChoice);
}

export function boxChoice(
	choice: ReturnType<typeof useAgentChoice>,
	draft: DraftChoice,
) {
	const kept = choice.harnesses.find((h) => h.id === draft.harness);
	// A draft's agent that is gone falls back to the shown default, with its model and effort.
	const own: DraftChoice =
		draft.harness && !kept ? { accessLevel: draft.accessLevel } : draft;
	const harness = kept ?? choice.effective;
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
		accessLevel,
		...(draft.harness && hid ? { harness: hid } : {}),
		...(own.model !== undefined ? { model: own.model } : {}),
		...(own.effort !== undefined ? { effort: own.effort } : {}),
	};
	return { choice, harness, hid, model, effort, accessLevel, now, sent };
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
	const { choice, harness, hid, model, effort, accessLevel, now, sent } =
		useBoxChoice(record);
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

	const unready = harness ? unreadyLine(harness) : null;
	const agentBlocked =
		current === "note" || current === "message"
			? undefined
			: unready
				? unready
				: record.investigateBlocked;

	const agentless = current === "note" || current === "message";
	const onChoice = (n: Partial<ComposerChoice> & { harnessId?: HarnessId }) => {
		if (n.harnessId)
			record.setDraftChoice(
				n.harnessId === hid
					? { ...now, model: n.model ?? "" }
					: { harness: n.harnessId, model: n.model ?? "" },
			);
		else if (n.model !== undefined)
			record.setDraftChoice({ ...now, model: n.model });
		else if (n.effort) record.setDraftChoice({ ...now, effort: n.effort });
		else if (n.accessLevel)
			record.setDraftChoice({ ...now, accessLevel: n.accessLevel });
	};

	const forward = async (env: SendEnvelope) => {
		const { text } = env;
		if (current === "note")
			return new Promise<void>((resolve, reject) =>
				record.addNote(text, resolve, reject),
			);
		const attachments = await uploadEach(env.attachments, (f) =>
			uploadAttachment(incident.id, f),
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
				fields: messageFields(env),
			});
			return;
		}
		if (current === "ask")
			return record.chat({
				text,
				...sent,
				attachments: ids,
				context: messageContext(env),
			});
		const report = o.report;
		return record.investigate({
			text:
				report && o.reported
					? recheckBrief(report, runNumber(runs, o.reported.id), text)
					: text || undefined,
			...sent,
			attachments: ids,
		});
	};

	const onSend = async (env: SendEnvelope) => {
		await forward(env);
		return "sent" as const;
	};

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
				agent={
					choice.harnesses.find((h) => h.id === latest.investigation?.harness)
						?.label ?? "The agent"
				}
				cwd={latest.investigation?.workspace?.cwd}
			/>
		) : null;
	return (
		<div className="shrink-0 px-4 pt-2 pb-3" data-testid="overview-composer">
			<div className="mx-auto w-full max-w-[760px]">
				<Composer
					state="ready"
					{...actionProps(t.actions, current, (id) =>
						onAction(id as OverviewAction),
					)}
					choice={{ harness, model, effort, accessLevel }}
					onChoice={onChoice}
					agentless={agentless}
					onSend={onSend}
					placeholder={t.placeholder[current] ?? ""}
					text={text}
					onText={setText}
					dock={dock}
					pending={record.isStarting || record.isSavingNote}
					blockedReason={agentBlocked}
				/>
			</div>
		</div>
	);
}
