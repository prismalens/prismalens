// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AccessLevel, HarnessId } from "@prismalens/config/harness";
import {
	ACCESS_LEVEL_LABEL,
	type FollowUpKind,
	fidelityAccess,
	type HarnessStatus,
	type InvestigationWithRelations,
	isRunStateLive,
	pendingAsks,
	TURN_OUTCOME_LABEL,
} from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { type MutableRefObject, useEffect, useState } from "react";
import {
	defaultAccessOf,
	unreadyLine,
	useAgentChoice,
} from "@/components/agent/AgentPicker";
import { modeOnSwitch } from "@/components/agent/agent-modes";
import {
	type DraftChoice,
	useIncidentRecord,
} from "@/components/incidents/record-context";
import {
	runEffort,
	runNumber,
	useRunAgentModel,
} from "@/components/incidents/run-facts";
import { startedBy, viewName } from "@/components/run/run-labels";
import type { PageSlots } from "@/components/thread/slots";
import { useToast } from "@/hooks/use-toast";
import { orpc } from "@/lib/api/orpc-client";
import { uploadAttachment } from "@/lib/attachments";
import { onCompose } from "@/lib/compose";
import {
	interceptSend,
	messageContext,
	messageFields,
	placesOf,
	type SendEnvelope,
	uploadEach,
} from "@/lib/composer-send";
import { getErrorMessage } from "@/lib/get-error-message";
import { handoffHint } from "@/lib/handoff-line";
import { openAsksOf } from "@/lib/run-asks";
import { defaultVerb, recheckBrief } from "@/lib/run-verb";
import { cn } from "@/lib/utils";
import {
	actionProps,
	Composer,
	type ComposerAction,
	type ComposerChoice,
	type ComposerSend,
} from "../thread/Composer";
import { RunDock } from "./RunDock";

/** What a chip choice changes: one of the three, the rest stay. */
type Choice =
	| { kind: "model"; harness: HarnessStatus; model: string }
	| { kind: "effort"; effort: string }
	| { kind: "level"; level: AccessLevel; agentMode: string | null };

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
	/** Who a finished run's message goes to: its own agent, in its own session. */
	agent: string;
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
				ask: "Starts a conversation",
				investigate: "Ends in a report",
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
			hint: { message: "Sends at the next pause" },
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
				"follow-up": "Stays in this conversation",
			},
		};
	// No continue control (rulings 2, 3): typing and sending continues; the run decides which kind.
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
			],
			initial: "continue",
			placeholder: `Message ${t.agent}`,
			hint: {
				continue: "Same session, ends in report",
			},
		};
	return {
		actions: [
			{
				id: "follow-up",
				label: `Continue ${t.name}`,
				detail: `A follow-up in ${t.name}'s agent session. The answer shows here.`,
				needsText: true,
			},
		],
		initial: "follow-up",
		placeholder: `Message ${t.agent}`,
		hint: { "follow-up": "Same agent session" },
	};
}

/**
 * The level a run's follow-up or recheck goes at: the run's own, or the
 * person's Settings for an ended alert-started run (#673 w6-13).
 */
export function runFollowUpLevel(
	inv: InvestigationWithRelations | null | undefined,
	settings: AccessLevel,
	live: boolean,
): AccessLevel {
	if (!live && startedBy(inv?.triggerType) === "PrismaLens") return settings;
	return (
		inv?.accessLevel ??
		(inv?.report?.fidelity
			? fidelityAccess(inv.report.fidelity, inv.agentMode)
			: undefined) ??
		"supervised"
	);
}

/** Investigate again from a reported run: a new run with its report quoted; null when there is none. */
export function useRecheck():
	| ((text?: string, attachments?: string[]) => Promise<void>)
	| null {
	const record = useIncidentRecord();
	const choice = useAgentChoice();
	const inv = record.run.investigation;
	const live = !!record.run.state && isRunStateLive(record.run.state);
	const harness = choice.harnesses.find((h) => h.id === inv?.harness);
	const report = inv?.report;
	// startOrGet hands back the live run and drops the recheck text, so offer none while any run is live.
	if (
		!inv ||
		!report ||
		live ||
		record.liveRun ||
		choice.isLoading ||
		inv.kind === "chat"
	)
		return null;
	const level = runFollowUpLevel(
		inv,
		defaultAccessOf(harness, choice.axes).level.level,
		live,
	);
	return (text = "", attachments = []) =>
		record.investigate({
			text: recheckBrief(report, runNumber(record.runs, inv.id), text),
			accessLevel: level,
			attachments,
		});
}

/** The destructive toast for a Stop that never reached the agent; the run strip's Stop shares it. */
export const stopFailed =
	(toast: ReturnType<typeof useToast>["toast"]) => (error: unknown) =>
		toast({
			title: "Stop did not reach the agent",
			description: getErrorMessage(error),
			variant: "destructive",
		});

/**
 * The box under a transcript (#811): a draft starts a run or an Ask, a live
 * run takes messages, a finished one continues. On a finished run the agent
 * and model chips pick who the message goes to (rulings 2, 3); on a live run
 * changing one opens a draft prefilled with the run plus the change.
 */
export function DockedComposer({
	branchId,
	boxRef,
	floating,
	onStep,
	slots,
}: {
	branchId?: string;
	boxRef?: MutableRefObject<ComposerSend | null>;
	/** The page's dock, footer and send interceptors (components/thread/slots). */
	slots?: Pick<PageSlots, "dock" | "strip" | "composerFooter" | "interceptors">;
	/** The new conversation's box, centred until the first send. */
	floating?: boolean;
	/** Rings a step in the transcript, from the dock's ask. */
	onStep?: (n: number) => void;
}) {
	const record = useIncidentRecord();
	const { run, incident, runs, draft } = record;
	const { toast } = useToast();
	const choice = useAgentChoice();
	const [message, setMessage] = useState("");
	// A transcript card's "Ask for a lasting fix" fills the box; you still press Send.
	useEffect(
		() =>
			onCompose((text) => {
				if (text) (draft ? record.setDraftText : setMessage)(text);
				window.setTimeout(
					() =>
						document
							.querySelector<HTMLTextAreaElement>(
								'[data-testid="composer-box"] textarea',
							)
							?.focus(),
					0,
				);
			}),
		[draft, record.setDraftText],
	);
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
		nextName: `Run ${runNumber(runs, "")}`,
		agent: who.agent,
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
	// A finished run's chips pick where its message goes; the run row is unchanged until it is sent.
	const finished = !draft && !!inv && !live && !ended;
	const [picks, setPicks] = useState<{ id: string; to: DraftChoice } | null>(
		null,
	);
	const to: DraftChoice = finished && picks?.id === inv?.id ? picks.to : {};
	const other = !!to.harness && to.harness !== inv?.harness;
	const runHarness = choice.harnesses.find(
		(h) => h.id === (to.harness ?? inv?.harness),
	);
	const harness = draft
		? (choice.harnesses.find((h) => h.id === own.harness) ?? choice.effective)
		: runHarness;
	const hid = harness?.id as HarnessId;
	const model = draft
		? (own.model ?? (own.harness ? choice.models[hid] : choice.model) ?? "")
		: (to.model ?? (other ? choice.models[hid] : inv?.model) ?? "");
	const effort = draft
		? own.effort !== undefined
			? own.effort
			: (choice.efforts[hid] ?? null)
		: to.effort !== undefined
			? to.effort
			: other
				? (choice.efforts[hid] ?? null)
				: (runEffort(inv, run.events) ?? inv?.effort ?? null);
	const preview = useQuery({
		...orpc.investigations.handoff.queryOptions({
			input: {
				id: inv?.id ?? "",
				...(to.harness ? { harness: to.harness } : {}),
				...(to.model ? { model: to.model } : {}),
			},
		}),
		enabled: finished,
		retry: false,
	});
	const agentLabel = harness?.label ?? who.agent;
	const handoff = preview.data
		? handoffHint(preview.data, {
				agent: agentLabel,
				continues: run.continuable,
				reported: !!inv?.report,
				name,
			})
		: null;
	// A run shows what it asked for; one from before levels, the level its report records (#673 w21).
	const defaults = defaultAccessOf(harness, choice.axes);
	const accessLevel: AccessLevel = draft
		? (own.accessLevel ?? defaults.level.level)
		: runFollowUpLevel(inv, defaults.level.level, live);
	// Only a new run takes a picked mode; a follow-up keeps the run's (sheet §5).
	const agentMode = draft ? (own.agentMode ?? null) : null;

	const choose = (c: Choice) => {
		const now: DraftChoice = hid
			? { harness: hid, model, effort, accessLevel, agentMode }
			: {};
		// Effort levels are per agent: another agent starts from its Settings (#798).
		const next: DraftChoice =
			c.kind === "model"
				? c.harness.id === hid
					? { ...now, model: c.model }
					: {
							harness: c.harness.id as HarnessId,
							model: c.model,
							...modeOnSwitch(c.harness, accessLevel, agentMode),
						}
				: c.kind === "effort"
					? { ...now, effort: c.effort }
					: { ...now, accessLevel: c.level, agentMode: c.agentMode };
		// On a run, the draft is this run with one change; a follow-up never changes the level.
		if (draft) record.setDraftChoice(next);
		else if (finished && inv) {
			if (c.kind !== "level") setPicks({ id: inv.id, to: next });
		} else record.newRun({ choice: next });
	};
	const sent = {
		...(own.harness ? { harness: own.harness } : {}),
		...(own.model !== undefined ? { model: own.model } : {}),
		...(own.effort !== undefined ? { effort: own.effort } : {}),
		...(agentMode ? { agentMode } : {}),
	};

	const unready = draft && harness ? unreadyLine(harness) : null;
	const otherLive =
		record.liveRun && record.liveRun.id !== inv?.id ? record.liveRun : null;
	const liveNumber = otherLive ? runNumber(runs, otherLive.id) : null;
	// One live thread per incident: a draft and an ended thread both wait for it (OBJ-007).
	const blockedReason =
		!draft && (live || !liveNumber)
			? undefined
			: liveNumber
				? otherLive?.kind === "chat"
					? "An Ask is answering; message it or stop it"
					: `Run ${liveNumber} is working; message it or stop it`
				: unready
					? unready
					: own.harness
						? harness?.installed
							? undefined
							: `${harness?.label ?? own.harness} is not on this machine.`
						: record.investigateBlocked;

	const onChoice = (n: Partial<ComposerChoice> & { harnessId?: HarnessId }) => {
		const picked = n.harnessId
			? choice.harnesses.find((h) => h.id === n.harnessId)
			: harness;
		if (n.harnessId || n.model !== undefined) {
			if (picked)
				choose({ kind: "model", harness: picked, model: n.model ?? "" });
		} else if (n.effort) choose({ kind: "effort", effort: n.effort });
		else if (n.accessLevel || n.agentMode !== undefined)
			choose({
				kind: "level",
				level: n.accessLevel ?? accessLevel,
				agentMode: n.agentMode ?? null,
			});
	};

	const upload = (env: SendEnvelope) =>
		uploadEach(env.attachments, (f) => uploadAttachment(incident.id, f));

	const rechecker = useRecheck();
	const recheck = async (text: string, attachments: string[]) =>
		rechecker?.(text, attachments);

	const forward = async (env: SendEnvelope, now: boolean) => {
		const { text } = env;
		const attachments = await upload(env);
		const ids = attachments.map((a) => a.id);
		switch (action) {
			case "investigate":
				// POST /incidents/{id}/investigate takes a brief, no quotes or references.
				return record.investigate({
					text: text || undefined,
					accessLevel,
					...sent,
					...placesOf(env),
					attachments: ids,
				});
			case "ask":
				return record.chat({
					text,
					accessLevel,
					...sent,
					attachments: ids,
					context: messageContext(env),
				});
			case "recheck":
				return recheck(text, ids);
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
					fields: messageFields(env),
					...(kind ? { kind } : {}),
					...(finished && to.harness
						? {
								to: {
									harness: to.harness,
									// The picker's "" is the agent's own model, which the API spells null.
									...(to.model !== undefined
										? { model: to.model || null }
										: {}),
									...(to.effort !== undefined ? { effort: to.effort } : {}),
								},
							}
						: {}),
				});
			}
		}
	};

	const onSend = (env: SendEnvelope, now: boolean) =>
		interceptSend(env, now, slots?.interceptors ?? [], forward);

	// Where the message goes and what a fresh session gets; the server plans it again on send.
	const hint: string[] = ended
		? []
		: !finished
			? [thread.hint[action] ?? ""]
			: handoff
				? [handoff.where, ...(handoff.what ? [handoff.what] : [])]
				: preview.isPending
					? ["Checking the session"]
					: [];
	const notice = !finished
		? undefined
		: (handoff?.problem ??
			(preview.isError ? "Not checked; sending still works" : undefined));
	const above = hint.some(Boolean) ? (
		<p className="px-3 text-meta text-text-3" data-testid="composer-hint">
			{hint.map((line) => (
				<span key={line} className="block">
					{line}
				</span>
			))}
		</p>
	) : null;
	const restarted = finished && !!preview.data?.note;
	// Open asks come from the ask record: one outlives the run that opened it (#1024).
	const asks = openAsksOf(run.asks, inv ? pendingAsks(inv.id, run.events) : []);
	const askDock = restarted ? (
		<p className="text-meta text-text-1" data-testid="composer-restart-note">
			PrismaLens restarted while the previous session was working. Its last
			command may or may not have completed; check before relying on it.
		</p>
	) : asks.length > 0 || run.queued.length > 0 ? (
		<RunDock
			asks={asks}
			queued={run.queued}
			runId={inv?.id}
			agent={harness?.label ?? who.agent}
			cwd={inv?.workspace?.cwd}
			onStep={onStep}
			always={!!inv?.scheduleId}
		/>
	) : null;
	const dock =
		askDock || slots?.dock ? (
			<>
				{askDock}
				{slots?.dock}
			</>
		) : null;

	return (
		<div
			className={cn(
				"shrink-0",
				!floating &&
					"px-4 pt-2 pb-3 max-md:pb-[calc(0.75rem+var(--kb-inset,0px))]",
			)}
			data-testid="docked-composer"
		>
			<div className="mx-auto w-full max-w-[760px]">
				<Composer
					state={live ? "live" : "ready"}
					scope={inv ? `thread:${inv.id}` : `new:incident:${incident.id}`}
					{...actionProps(thread.actions, action, setAction)}
					choice={{ harness, model, effort, accessLevel, agentMode }}
					onChoice={onChoice}
					accessHint={
						finished
							? `A follow-up keeps the run's permission, ${ACCESS_LEVEL_LABEL[preview.data?.accessLevel ?? accessLevel]}. Start a new run to change it.`
							: undefined
					}
					onSend={onSend}
					ended={
						ended
							? {
									onNewRun: () => record.newRun(),
									...(inv?.resumeBlockedReason
										? { reason: inv.resumeBlockedReason }
										: {}),
									...(inv?.report && {
										onRecheck: () =>
											recheck("", []).catch((error: unknown) =>
												toast({
													title: "Run not started",
													description: getErrorMessage(error),
													variant: "destructive",
												}),
											),
									}),
								}
							: undefined
					}
					placeholder={
						finished && inv?.kind !== "chat"
							? `Message ${agentLabel}`
							: thread.placeholder
					}
					initialFiles={draft ? record.draftFiles : undefined}
					onFilesChange={draft ? record.setDraftFiles : undefined}
					boxRef={boxRef}
					text={draft ? record.draftText : message}
					onText={draft ? record.setDraftText : setMessage}
					autoFocus={draft}
					dock={dock}
					strip={slots?.strip}
					pending={record.isStarting}
					stopping={run.stopRequested}
					blockedReason={live ? undefined : blockedReason}
					notice={notice}
					holdSend={finished && (preview.isPending || !!handoff?.problem)}
					onStop={
						live ? () => run.stop({ onError: stopFailed(toast) }) : undefined
					}
					undeliverable={run.undeliverable}
					onSaveAsNote={(text) => record.addNote(text, run.clearUndeliverable)}
					above={above}
					floating={floating}
					footer={slots?.composerFooter}
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
