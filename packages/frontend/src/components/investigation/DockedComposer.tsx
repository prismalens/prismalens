// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	AccessLevel,
	HarnessId,
	RunMode,
} from "@prismalens/config/harness";
import {
	type FollowUpKind,
	fidelityAccess,
	type HarnessStatus,
	isRunStateLive,
	LIVE_TURN_LABEL,
	runStateLabel,
	TURN_OUTCOME_LABEL,
} from "@prismalens/contracts";
import { GitCommitHorizontal } from "lucide-react";
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
	runAccessLine,
	runEffort,
	runNumber,
	runTimed,
	turnElapsed,
	useRunAgentModel,
} from "@/components/incidents/run-facts";
import { useNow } from "@/hooks/use-now";
import { useToast } from "@/hooks/use-toast";
import { reconnectAsOf, useStreamStatus } from "@/lib/api/live-refresh";
import { uploadAttachment } from "@/lib/attachments";
import { composerMode } from "@/lib/composer-keys";
import { formatClock, formatElapsed } from "@/lib/format-time";
import { getErrorMessage } from "@/lib/get-error-message";
import { pinnedTo } from "@/lib/investigation-events";
import {
	defaultVerb,
	followUpKind,
	type RunVerb,
	verbCopy,
	verbsFor,
} from "@/lib/run-verb";
import { cn } from "@/lib/utils";
import { ComposerBox, type ComposerSend } from "./ComposerBox";

/** What a chip choice changes: one of the three, the rest stay. */
type Choice =
	| { kind: "model"; harness: HarnessStatus; model: string }
	| { kind: "effort"; effort: string }
	| { kind: "level"; level: AccessLevel }
	| { kind: "runMode"; runMode: RunMode };

/** The box's placeholder, by what the next message asks for (#673 w59, DESIGN §4). */
function placeholderFor(
	draft: boolean,
	live: boolean,
	continuable: boolean,
	chat: boolean,
	verb: RunVerb,
): string {
	if (draft)
		return verb === "investigate"
			? "Brief the agent (optional)"
			: "Ask about this incident";
	if (live) return "Message the agent";
	if (continuable) return "Say what to change, or just continue";
	return chat ? "Continue this chat" : "Ask about this run";
}

/**
 * The box under the transcript (#673): a draft starts a run, a live run takes
 * messages, a finished one continues. On a run the chips read that run, and
 * changing one opens a draft prefilled with the run plus the change.
 */
export function DockedComposer({
	branchId,
	boxRef,
	onRecheck,
}: {
	branchId?: string;
	/** What is in the box now, for `Investigate again` (#673 w59). */
	boxRef?: MutableRefObject<ComposerSend | null>;
	onRecheck?: () => void;
}) {
	const record = useIncidentRecord();
	const { run, incident, runs, draft } = record;
	const { toast } = useToast();
	const choice = useAgentChoice();
	const [message, setMessage] = useState("");
	const who = useRunAgentModel(run.investigation);
	const inv = run.investigation;
	const live = !!run.state && isRunStateLive(run.state);
	const mode = composerMode(
		draft || !inv
			? null
			: { live, continuable: run.continuable, resumable: run.resumable },
	);

	// What the next message asks for: a draft's own pick, else its default (#673 w59).
	const thread = { draft, live, continuable: run.continuable };
	const verbs = verbsFor(thread);
	// A pick holds for the state it was made in: a run stopped while open offers Investigate.
	const verbKey = `${inv?.id}:${run.continuable}`;
	const [picked, setPicked] = useState<{ key: string; verb: RunVerb } | null>(
		null,
	);
	const runVerb: RunVerb =
		picked?.key === verbKey
			? picked.verb
			: run.continuable
				? "investigate"
				: "ask";
	const setRunVerb = (v: RunVerb) => setPicked({ key: verbKey, verb: v });
	const verb: RunVerb = draft
		? (record.draftVerb ??
			defaultVerb(thread, {
				alertCount: incident.alertCount,
				reported: runs.some((r) => r.hasReport),
			}))
		: verbs.length
			? runVerb
			: "ask";
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
	// A run shows what it asked for; one from before the two axes, the level its report records (#673 w21).
	const defaults = defaultAccessOf(harness, choice.axes);
	const accessLevel: AccessLevel = draft
		? (own.accessLevel ?? defaults.level.level)
		: (inv?.accessLevel ??
			(inv?.report?.fidelity
				? fidelityAccess(inv.report.fidelity, inv.agentMode)
				: undefined) ??
			"supervised");
	const runMode: RunMode = draft
		? (own.runMode ?? defaults.mode.mode)
		: (inv?.runMode ?? "execute");

	const choose = (c: Choice) => {
		const now: DraftChoice = hid
			? { harness: hid, model, effort, accessLevel, runMode }
			: {};
		// Effort levels are per agent: another agent starts from its Settings (#798).
		const next: DraftChoice =
			c.kind === "model"
				? c.harness.id === hid
					? { ...now, model: c.model }
					: { harness: c.harness.id as HarnessId, model: c.model }
				: c.kind === "effort"
					? { ...now, effort: c.effort }
					: c.kind === "level"
						? { ...now, accessLevel: c.level }
						: { ...now, runMode: c.runMode };
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
				? `Run #${liveNumber} is working; message it or stop it`
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
				runMode={runMode}
				disabled={blocked}
				onLevel={(l) => choose({ kind: "level", level: l })}
				onRunMode={(m) => choose({ kind: "runMode", runMode: m })}
			/>
		</>
	);

	const upload = (files: File[]) =>
		Promise.all(files.map((f) => uploadAttachment(incident.id, f)));

	return (
		<div className="shrink-0 pb-3" data-testid="docked-composer">
			<ComposerBox
				mode={mode}
				chips={chips}
				verbs={verbs}
				verb={verb}
				onVerb={draft ? record.setDraftVerb : setRunVerb}
				verbCopy={verbCopy(thread)}
				placeholder={placeholderFor(
					draft,
					live,
					run.continuable,
					inv?.kind === "chat",
					verb,
				)}
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
						accessLevel,
						runMode,
						...sent,
						attachments: attachments.map((a) => a.id),
					});
				}}
				onAsk={async ({ text, files }) => {
					const attachments = await upload(files);
					await record.chat({
						text,
						accessLevel,
						runMode,
						...sent,
						attachments: attachments.map((a) => a.id),
					});
				}}
				onMessage={async ({ text, files }, send) => {
					const attachments = await upload(files);
					// Every message says what it asks for; a live one, the turn it joins (#673 w59).
					const kind = live ? liveKind : followUpKind(verb);
					await run.sendMessage(text, send, {
						branchId,
						attachments,
						...(kind ? { kind } : {}),
					});
				}}
				undeliverable={run.undeliverable}
				onSaveAsNote={(text) => record.addNote(text, run.clearUndeliverable)}
				status={draft ? null : <RunStatusLine onRecheck={onRecheck} />}
			/>
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

/** Who started a thread, from its trigger (#673 w59). */
export function originWord(triggerType: string | null | undefined): string {
	if (triggerType === "re_trigger") return "Started by the alert, reopened";
	if (triggerType && triggerType !== "manual") return "Started by the alert";
	return "Started by you";
}

/**
 * The thread's own facts under the box (#673, w59): which thread, who started
 * it, its state or live turn, how its last message ended, its code.
 */
function RunStatusLine({ onRecheck }: { onRecheck?: () => void }) {
	const { run, runs, incident } = useIncidentRecord();
	const { harnesses } = useAgentChoice();
	const now = useNow(1000);
	const stream = useStreamStatus();
	const inv = run.investigation;
	if (!inv || !run.state) return null;
	const live = isRunStateLive(run.state);
	const chat = inv.kind === "chat";
	// With the stream lost the clock stops at when the run was last heard from.
	const lostAt = live && now !== null ? reconnectAsOf(stream, now) : null;
	const took = runTimed(inv)
		? formatElapsed(turnElapsed(inv, run.events, now))
		: null;
	const state =
		run.state === "working"
			? inv.liveTurn
				? LIVE_TURN_LABEL[inv.liveTurn]
				: "Working"
			: runStateLabel(inv.kind, run.state);
	const sha = pinnedTo(inv.workspace);
	const service = incident.service?.displayName || incident.service?.name;
	const lastMessage = !live && !chat ? lastMessageWord(inv) : null;
	const access = runAccessLine(
		inv,
		harnesses.find((h) => h.id === inv.harness),
	);
	return (
		<div
			className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 pt-0.5 text-meta text-text-3"
			data-testid="run-status"
			data-disconnected={lostAt !== null ? "" : undefined}
		>
			<span className="inline-flex items-center gap-1.5 text-text-2">
				{chat ? (
					"Chat"
				) : (
					<>
						Run #{runNumber(runs, inv.id)}
						<span className="text-[11px] text-text-3">Investigation</span>
					</>
				)}
			</span>
			<span data-testid="run-status-origin">{originWord(inv.triggerType)}</span>
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
			{lastMessage && (
				<span data-testid="run-status-last-message">{lastMessage}</span>
			)}
			{access && <span data-testid="run-status-access">{access}</span>}
			{sha && (
				<span
					className="inline-flex items-center gap-1"
					title={service ? `${service}, commit ${sha}` : `Commit ${sha}`}
				>
					<GitCommitHorizontal className="size-3" aria-hidden />
					<span className="font-mono">{sha}</span>
				</span>
			)}
			{!live && !chat && inv.hasReport && onRecheck && (
				<button
					type="button"
					onClick={onRecheck}
					className="text-accent hover:underline"
					title="Opens + New run with this report and anything typed here"
					data-testid="run-status-recheck"
				>
					Investigate again
				</button>
			)}
		</div>
	);
}
