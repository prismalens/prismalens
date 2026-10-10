// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AccessLevel, HarnessId } from "@prismalens/config/harness";
import {
	type FollowUpKind,
	fidelityAccess,
	type HarnessStatus,
	isRunStateLive,
	TURN_OUTCOME_LABEL,
} from "@prismalens/contracts";
import { type MutableRefObject, useState } from "react";
import {
	AccessChip,
	defaultAccessOf,
	EffortChip,
	ModelChip,
	unreadyReason,
	useAgentChoice,
} from "@/components/agent/AgentPicker";
import {
	type DraftChoice,
	useIncidentRecord,
} from "@/components/incidents/record-context";
import {
	runEffort,
	runNumber,
	useRunAgentModel,
} from "@/components/incidents/run-facts";
import { viewName } from "@/components/run/run-labels";
import { useToast } from "@/hooks/use-toast";
import { uploadAttachment } from "@/lib/attachments";
import { getErrorMessage } from "@/lib/get-error-message";
import { unmatchedPending } from "@/lib/investigation-events";
import { defaultVerb, recheckBrief } from "@/lib/run-verb";
import { cn } from "@/lib/utils";
import {
	type ComposerAction,
	ComposerBox,
	type ComposerSend,
} from "./ComposerBox";

/** What a chip choice changes: one of the three, the rest stay. */
type Choice =
	| { kind: "model"; harness: HarnessStatus; model: string }
	| { kind: "effort"; effort: string }
	| { kind: "level"; level: AccessLevel };

/** The thread the box sits under, and what Send can do on it (#811). */
export interface ThreadActions {
	actions: ComposerAction[];
	/** The action a fresh box starts on. */
	initial: string;
	placeholder: string;
	/** Where each action's result goes, the line above the box. */
	hint: Record<string, string>;
}

/**
 * The box's actions by thread (#811): a draft asks or investigates; a live
 * run takes messages; a finished run continues in its session or is
 * investigated again; a stopped run without a report continues to one.
 */
export function threadActions(t: {
	draft: boolean;
	live: boolean;
	chat: boolean;
	continuable: boolean;
	reported: boolean;
	name: string;
	nextName: string;
	defaultDraft: "ask" | "investigate";
}): ThreadActions {
	if (t.draft)
		return {
			actions: [
				{
					id: "ask",
					label: "Ask",
					detail: "A question about this incident. No new report.",
					needsText: true,
				},
				{
					id: "investigate",
					label: "Investigate",
					detail:
						"Gathers the alert, code and telemetry, then starts a run that ends in a report.",
					needsText: false,
				},
			],
			initial: t.defaultDraft,
			placeholder:
				t.defaultDraft === "ask"
					? "Ask about this incident"
					: "Brief the agent (optional)",
			hint: {
				ask: "Starts a conversation about this incident. Its latest answer also shows on the overview.",
				investigate:
					"Starts a run. It runs live and ends in a report on the overview.",
			},
		};
	if (t.live)
		return {
			actions: [
				{
					id: "message",
					label: "Message",
					detail: "Reaches the agent at its next pause.",
					needsText: true,
				},
			],
			initial: "message",
			placeholder: "Message the agent",
			hint: { message: "" },
		};
	if (t.chat)
		return {
			actions: [
				{
					id: "follow-up",
					label: "Ask",
					detail: "A follow-up in this conversation.",
					needsText: true,
				},
			],
			initial: "follow-up",
			placeholder: "Ask a follow-up",
			hint: {
				"follow-up":
					"Follow-ups stay in this conversation. The latest answer also shows on the overview.",
			},
		};
	if (t.continuable)
		return {
			actions: [
				{
					id: "continue",
					label: `Continue ${t.name}`,
					detail:
						"Resumes the agent's session and takes the run on to a report.",
					needsText: true,
				},
				{
					id: "follow-up",
					label: "Ask",
					detail: "A question in the same session. No report.",
					needsText: true,
				},
			],
			initial: "continue",
			placeholder: "Say what to change, or just continue",
			hint: {
				continue: `Continuing resumes ${t.name}'s agent session and ends in a report on the overview.`,
				"follow-up": `Asks in ${t.name}'s agent session. The answer shows here.`,
			},
		};
	const actions: ComposerAction[] = [
		{
			id: "follow-up",
			label: `Continue ${t.name}`,
			detail: `A follow-up in ${t.name}'s agent session. The answer shows here.`,
			needsText: true,
		},
	];
	if (t.reported)
		actions.push({
			id: "recheck",
			label: "Investigate again",
			detail: `Starts ${t.nextName} with this report quoted and anything typed here.`,
			needsText: false,
		});
	return {
		actions,
		initial: "follow-up",
		placeholder: "Say what to change, or just continue",
		hint: {
			"follow-up": `Continuing resumes ${t.name}'s agent session. Its answer shows here.`,
			recheck: `${t.nextName} runs live and ends in a new report on the overview; ${t.name}'s finding stands until then.`,
		},
	};
}

/**
 * The box under a transcript (#811): a draft starts a run or an Ask, a live
 * run takes messages, a finished one continues. On a run the chips read
 * that run, and changing one opens a draft prefilled with the run plus the change.
 */
export function DockedComposer({
	branchId,
	boxRef,
	floating,
}: {
	branchId?: string;
	boxRef?: MutableRefObject<ComposerSend | null>;
	/** The new conversation's box, centred until the first send. */
	floating?: boolean;
}) {
	const record = useIncidentRecord();
	const { run, incident, runs, draft } = record;
	const { toast } = useToast();
	const choice = useAgentChoice();
	const [message, setMessage] = useState("");
	const who = useRunAgentModel(run.investigation);
	const inv = run.investigation;
	const live = !!run.state && isRunStateLive(run.state);
	const ended = !draft && !!inv && !live && !run.continuable && !run.resumable;

	const name = inv ? viewName(runs, inv) : "this run";
	const thread = threadActions({
		draft,
		live,
		chat: inv?.kind === "chat",
		continuable: run.continuable,
		reported: !!inv?.report,
		name,
		nextName: `Run ${runs.filter((r) => r.kind !== "chat").length + 1}`,
		defaultDraft:
			record.draftVerb ??
			defaultVerb(
				{ draft: true },
				{
					alertCount: incident.alertCount,
					reported: runs.some((r) => r.hasReport),
				},
			),
	});
	const actionKey = `${draft ? "draft" : inv?.id}:${live}:${run.continuable}`;
	const [picked, setPicked] = useState<{ key: string; id: string } | null>(
		null,
	);
	const action =
		draft && record.draftVerb
			? record.draftVerb
			: picked?.key === actionKey
				? picked.id
				: thread.initial;
	const setAction = (id: string) => {
		if (draft && (id === "ask" || id === "investigate"))
			record.setDraftVerb(id);
		else setPicked({ key: actionKey, id });
	};
	const liveKind: FollowUpKind | undefined =
		inv?.liveTurn === "report"
			? "continue"
			: inv?.liveTurn === "answer"
				? "chat"
				: undefined;

	// A draft reads its own chips, then Settings, per field; Settings is never written here (#673 w52).
	const own = record.draftChoice;
	const runHarness = choice.harnesses.find((h) => h.id === inv?.harness);
	const harness = draft
		? (choice.harnesses.find((h) => h.id === own.harness) ?? choice.effective)
		: runHarness;
	const hid = harness?.id as HarnessId;
	const model = draft
		? (own.model ?? (own.harness ? choice.models[hid] : choice.model) ?? "")
		: (inv?.model ?? "");
	const effort = draft
		? own.effort !== undefined
			? own.effort
			: (choice.efforts[hid] ?? null)
		: (runEffort(inv, run.events) ?? inv?.effort ?? null);
	// A run shows what it asked for; one from before levels, the level its report records (#673 w21).
	const defaults = defaultAccessOf(harness, choice.axes);
	const accessLevel: AccessLevel = draft
		? (own.accessLevel ?? defaults.level.level)
		: (inv?.accessLevel ??
			(inv?.report?.fidelity
				? fidelityAccess(inv.report.fidelity, inv.agentMode)
				: undefined) ??
			"supervised");

	const choose = (c: Choice) => {
		const now: DraftChoice = hid
			? { harness: hid, model, effort, accessLevel }
			: {};
		// Effort levels are per agent: another agent starts from its Settings (#798).
		const next: DraftChoice =
			c.kind === "model"
				? c.harness.id === hid
					? { ...now, model: c.model }
					: { harness: c.harness.id as HarnessId, model: c.model }
				: c.kind === "effort"
					? { ...now, effort: c.effort }
					: { ...now, accessLevel: c.level };
		// On a run, the draft is this run with one change.
		if (draft) record.setDraftChoice(next);
		else record.newRun({ choice: next });
	};
	const sent = {
		...(own.harness ? { harness: own.harness } : {}),
		...(own.model !== undefined ? { model: own.model } : {}),
		...(own.effort !== undefined ? { effort: own.effort } : {}),
	};

	const unready = draft && harness ? unreadyReason(harness) : null;
	const otherLive =
		record.liveRun && record.liveRun.id !== inv?.id ? record.liveRun : null;
	const liveNumber = otherLive ? runNumber(runs, otherLive.id) : null;
	// One live thread per incident: a draft and an ended thread both wait for it (OBJ-007).
	const blockedReason =
		!draft && (live || !liveNumber)
			? undefined
			: liveNumber
				? `Run ${liveNumber} is working; message it or stop it`
				: unready
					? `${unready}. Check it in Settings, Agent.`
					: own.harness
						? harness?.installed
							? undefined
							: `${harness?.label ?? own.harness} is not on this machine.`
						: record.investigateBlocked;
	const blocked = !!blockedReason;

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
			<AccessChip
				harness={harness}
				level={accessLevel}
				disabled={blocked}
				onLevel={(l) => choose({ kind: "level", level: l })}
			/>
		</>
	);

	const upload = (files: File[]) =>
		Promise.all(files.map((f) => uploadAttachment(incident.id, f)));

	const onSend = async ({ text, files }: ComposerSend, now: boolean) => {
		const attachments = await upload(files);
		const ids = attachments.map((a) => a.id);
		switch (action) {
			case "investigate":
				return record.investigate({
					text: text || undefined,
					accessLevel,
					...sent,
					attachments: ids,
				});
			case "ask":
				return record.chat({ text, accessLevel, ...sent, attachments: ids });
			case "recheck":
				if (!inv?.report) return;
				return record.investigate({
					text: recheckBrief(inv.report, runNumber(runs, inv.id), text),
					accessLevel,
					attachments: ids,
				});
			default: {
				// Every message says what it asks for; a live one, the turn it joins (#673 w59).
				const kind: FollowUpKind | undefined = live
					? liveKind
					: action === "continue"
						? "continue"
						: "chat";
				await run.sendMessage(text, now ? "now" : "queue", {
					branchId,
					attachments,
					...(kind ? { kind } : {}),
				});
			}
		}
	};

	const queued = live
		? unmatchedPending(run.events, run.pending).filter(
				(m) => m.mode === "queue" && !m.undelivered,
			)
		: [];
	const hint = thread.hint[action];
	const above = (
		<>
			{hint && (
				<p className="px-3 text-meta text-text-3" data-testid="composer-hint">
					{hint}
				</p>
			)}
			{queued.map((m) => (
				<p
					key={m.id}
					className="truncate px-3 text-meta text-text-2"
					data-testid="composer-queued"
				>
					Waiting for the agent's next pause: {m.text}
				</p>
			))}
		</>
	);

	return (
		<div
			className={cn("shrink-0", !floating && "px-4 pt-2 pb-3")}
			data-testid="docked-composer"
		>
			<div className="mx-auto w-full max-w-[760px]">
				<ComposerBox
					actions={thread.actions}
					action={action}
					onAction={setAction}
					chips={chips}
					onSend={onSend}
					live={live}
					ended={ended ? { onNewRun: () => record.newRun() } : undefined}
					placeholder={thread.placeholder}
					initialFiles={draft ? record.draftFiles : undefined}
					onFilesChange={draft ? record.setDraftFiles : undefined}
					boxRef={boxRef}
					text={draft ? record.draftText : message}
					setText={draft ? record.setDraftText : setMessage}
					autoFocus={draft}
					agent={{
						label: harness?.label ?? who.agent,
						images:
							harness?.checked?.outcome === "answers-acp"
								? harness.checked.images
								: null,
					}}
					waiting={run.waiting}
					isPending={record.isStarting}
					stopping={run.stopRequested}
					blockedReason={blockedReason}
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
					undeliverable={run.undeliverable}
					onSaveAsNote={(text) => record.addNote(text, run.clearUndeliverable)}
					above={above}
					floating={floating}
				/>
			</div>
		</div>
	);
}

/**
 * How the last message ended, when the standing does not already say it
 * (#804 OBJ-028): an Ask that errored on a stopped run is not its old Stop.
 */
export function lastMessageWord(inv: {
	status: string;
	lastTurnOutcome?: string | null;
}): string | null {
	const o = inv.lastTurnOutcome;
	if (o === "stopped" && inv.status !== "cancelled")
		return `Last message: ${TURN_OUTCOME_LABEL.stopped}`;
	if (o === "error" && inv.status !== "failed")
		return `Last message: ${TURN_OUTCOME_LABEL.error}`;
	return null;
}
