// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Link } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import { Fragment, type ReactNode, useState } from "react";
import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
} from "@/components/ai/conversation";
import { MessageResponse } from "@/components/ai/message";
import type { RunStep } from "@/components/run/run-steps";
import { StepCard } from "@/components/run/StepCard";
import { StateWord } from "@/components/shared/StateWord";
import { failureSentence } from "@/lib/failure-sentence";
import { formatClock, formatElapsed } from "@/lib/format-time";
import {
	type AttachmentView,
	OPERATOR_STATE_LABEL,
	type OperatorState,
	type TranscriptItem,
} from "@/lib/investigation-events";
import { shortPath } from "@/lib/report-view";
import { type AskRecord, askEnd, askTitle } from "@/lib/run-asks";
import { cn } from "@/lib/utils";

export { unfence } from "@/components/run/run-steps";

const ENTER =
	"motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200";

const LEVEL_TEST_ID = {
	allowed: "transcript-allowed",
	mode_kept: "transcript-mode-kept",
	unattended: "transcript-unattended",
} as const;

/** A group longer than this shows its ends and folds the middle (#811, very long step lists). */
const FOLD_OVER = 8;
const FOLD_KEEP = 3;

/** The delivery word beside a message (decision 18): Enter waits for the agent's next pause. */
function deliveryWord(state: OperatorState, mode: "queue" | "now"): string {
	if (state === "not_delivered") return "not delivered";
	if (state === "started" || state === "resumed" || state === "asked")
		return OPERATOR_STATE_LABEL[state].toLowerCase();
	if (state === "queued") return "waits for the next pause";
	return mode === "now" ? "sent now" : "delivered at the next pause";
}

/** What the page tells the transcript about its steps; absent, tool calls read as plain steps. */
export interface TranscriptSteps {
	all: RunStep[];
	open: ReadonlySet<number>;
	onToggle: (n: number) => void;
	highlight: number | null;
	flagged: ReadonlySet<number>;
	onSeeFlag?: () => void;
	/** The run's asks, each on its step (#820). */
	asks?: readonly AskRecord[];
	/** A read step's file at the run's commit, and opening it (proposal item 2). */
	fileOf?: (s: RunStep) => { sha: string } | null;
	onOpenFile?: (s: RunStep) => void;
}

/**
 * A run's transcript (#811): the brief and your messages on the right,
 * the agent's prose, each tool call a numbered step, and how the run ended.
 * A pane: it scrolls itself and follows the tail while live.
 */
export function Transcript({
	items,
	incidentId,
	cwd,
	agent,
	steps,
	runName,
	briefBy = "You",
	report,
	empty,
	worked,
}: {
	items: TranscriptItem[];
	incidentId: string;
	/** The run's workspace, shown as `repo/` (walk f16). */
	cwd?: string | null;
	agent: string;
	steps?: TranscriptSteps;
	/** `Run 2`, in the brief's line and the report card. */
	runName?: string;
	/** Who wrote the brief: you, or PrismaLens when the alert started the run. */
	briefBy?: string;
	/** The report card's title and summary, when the run reported. */
	report?: { title: string; summary: string; detail?: ReactNode } | null;
	/** What shows before anything is sent: the new conversation's box. */
	empty?: boolean;
	/** Once a report exists: the step cards fold behind `Worked for 4m 12s - 23 steps`. */
	worked?: { seconds: number; steps: number } | null;
}) {
	const [showWork, setShowWork] = useState(false);
	// A citation that opens a step must find it, so a highlighted or opened step unfolds the work.
	const folded =
		!!worked &&
		!showWork &&
		steps?.highlight == null &&
		(steps?.open.size ?? 0) === 0;
	const firstTools = items.findIndex((i) => i.kind === "tools");
	return (
		<Conversation className="h-full" data-testid="transcript-scroller">
			<ConversationContent className="px-4 pt-5 pb-2">
				<ol
					className="mx-auto flex w-full max-w-[760px] min-w-0 list-none flex-col gap-3 p-0"
					data-testid="transcript"
					data-empty={empty ? "" : undefined}
				>
					{items.map((item, i) => (
						<Fragment key={item.key}>
							{worked && i === firstTools && (
								<WorkedToggle
									worked={worked}
									folded={folded}
									onToggle={() => setShowWork((v) => !v)}
								/>
							)}
							{(!folded || item.kind !== "tools") && (
								<TranscriptRow
									item={item}
									incidentId={incidentId}
									cwd={cwd}
									agent={agent}
									steps={steps}
									runName={runName}
									briefBy={briefBy}
									report={report}
								/>
							)}
						</Fragment>
					))}
				</ol>
			</ConversationContent>
			<ConversationScrollButton />
		</Conversation>
	);
}

/** `Worked for 4m 12s - 23 steps`: the report is out, so the steps wait behind one line. */
function WorkedToggle({
	worked,
	folded,
	onToggle,
}: {
	worked: { seconds: number; steps: number };
	folded: boolean;
	onToggle: () => void;
}) {
	return (
		<li>
			<button
				type="button"
				onClick={onToggle}
				aria-expanded={!folded}
				className="w-full rounded-surface px-3 py-1.5 text-left text-meta text-text-2 transition-colors duration-(--dur-instant) hover:bg-surface-2 hover:text-text-1"
				data-testid="worked-toggle"
			>
				Worked for {formatElapsed(worked.seconds)} · {worked.steps}{" "}
				{worked.steps === 1 ? "step" : "steps"}
			</button>
		</li>
	);
}

function TranscriptRow({
	item,
	incidentId,
	cwd,
	agent,
	steps,
	runName,
	briefBy,
	report,
}: {
	item: TranscriptItem;
	incidentId: string;
	cwd?: string | null;
	agent: string;
	steps?: TranscriptSteps;
	runName?: string;
	briefBy: string;
	report?: { title: string; summary: string; detail?: ReactNode } | null;
}) {
	switch (item.kind) {
		case "prose":
			return (
				<li className={ENTER} data-testid="transcript-agent">
					{item.text && (
						<div data-testid="transcript-prose" className="leading-[22px]">
							<MessageResponse>{item.text}</MessageResponse>
						</div>
					)}
					{item.draft && (
						<details
							className={cn("text-meta text-text-3", item.text && "mt-2")}
							data-testid="transcript-report-draft"
						>
							<summary className="cursor-pointer hover:text-text-2">
								Report draft as the agent wrote it
							</summary>
							<pre className="m-0 mt-1.5 max-h-80 overflow-auto rounded-control bg-surface-1 px-3 py-2 font-mono text-mono whitespace-pre-wrap text-text-2 [overflow-wrap:anywhere]">
								{item.draft}
							</pre>
						</details>
					)}
				</li>
			);
		case "line":
		case "divider":
			return (
				<li
					className={cn("text-meta text-text-3", ENTER)}
					data-testid={
						item.kind === "line" ? "transcript-line" : "transcript-divider"
					}
				>
					{item.text}
				</li>
			);
		case "level":
			return (
				<li
					className={cn("text-meta text-text-3", ENTER)}
					data-testid={LEVEL_TEST_ID[item.outcome]}
				>
					{item.text}
				</li>
			);
		case "tools":
			return <StepGroup item={item} steps={steps} cwd={cwd} />;
		case "ask": {
			// An ask no step carries keeps its own line where it was (#820).
			const ask = steps?.asks?.find((a) => a.askId === item.askId);
			if (!ask || ask.step !== undefined) return null;
			const end = askEnd(ask);
			return (
				<li
					className={cn(
						"text-meta [overflow-wrap:anywhere]",
						ask.state === "waiting" ? "text-warn" : "text-text-3",
						ENTER,
					)}
					data-testid="transcript-ask"
					data-state={ask.state}
				>
					{agent} asked to run {shortPath(askTitle(ask), cwd)}:{" "}
					{end.charAt(0).toLowerCase() + end.slice(1)}
				</li>
			);
		}
		case "thought":
			return (
				<li className="text-meta text-text-3" data-testid="transcript-thought">
					Thought for {formatElapsed(item.seconds)}
				</li>
			);
		case "thinking":
			return (
				<li
					className={cn(
						"flex items-center gap-2 tabular-nums",
						item.stale ? "text-warn" : "text-text-2",
					)}
					data-testid="transcript-thinking"
				>
					<span
						aria-hidden
						className={cn(
							"size-[7px] rounded-full",
							item.stale ? "bg-warn" : "breathe bg-live",
						)}
						data-testid="transcript-thinking-bar"
					/>
					{item.stale ? "Quiet" : "Thinking"}
					<span className="text-meta text-text-3">
						for {formatElapsed(item.seconds)}
					</span>
				</li>
			);
		case "operator": {
			const brief = item.state === "started";
			const who = brief ? briefBy : "You";
			return (
				<li
					className={cn(
						"flex max-w-[80%] flex-col gap-0.5 self-end rounded-[10px] bg-surface-2 px-3 py-2",
						ENTER,
					)}
					data-testid="transcript-operator"
					data-state={item.state}
				>
					<span className="text-meta text-text-3">
						{who}, {formatClock(item.at)},{" "}
						<span
							className={cn(item.state === "not_delivered" && "text-danger")}
							data-testid="transcript-delivery"
						>
							{brief
								? runName === "Ask"
									? "asked"
									: `brief for ${runName ?? "this run"}`
								: deliveryWord(item.state, item.mode)}
						</span>
					</span>
					{item.text && (
						<p
							dir="auto"
							className="whitespace-pre-wrap [overflow-wrap:anywhere]"
						>
							{item.text}
						</p>
					)}
					{item.attachments.length > 0 && (
						<Attachments incidentId={incidentId} files={item.attachments} />
					)}
				</li>
			);
		}
		case "end": {
			if (item.report && report)
				return (
					<li
						className={cn(
							"flex flex-col gap-1.5 rounded-[10px] bg-surface-2 px-3.5 py-3",
							ENTER,
						)}
						data-testid="transcript-report"
					>
						<span id="report" className="font-semibold">
							{report.title}
						</span>
						<span dir="auto" className="text-text-2">
							{report.summary}
						</span>
						{report.detail}
						<Link
							to="/incidents/$id"
							params={{ id: incidentId }}
							className="self-start text-accent underline-offset-[3px] hover:underline"
							data-testid="transcript-report-overview"
						>
							See it on the overview
						</Link>
						{item.hint && (
							<span
								className="text-meta text-text-3"
								data-testid="transcript-end-hint"
							>
								{item.hint}
							</span>
						)}
					</li>
				);
			const failure =
				item.tone === "failed" ? failureSentence(agent, item.error) : null;
			return (
				<li className={cn("space-y-1", ENTER)} data-testid="transcript-end">
					<p className="flex flex-wrap items-baseline gap-x-2 text-text-2">
						{failure ? (
							<span className="[overflow-wrap:anywhere]">
								<StateWord tone="danger" className="text-body">
									Run failed
								</StateWord>
								{item.at ? ` at ${formatClock(item.at)}` : ""}: {failure.said}
								{failure.detail && failure.next ? ` ${failure.next}` : ""}
							</span>
						) : (
							<span className="[overflow-wrap:anywhere]">
								{item.text}
								{item.detail ? ` ${item.detail}` : ""}.
							</span>
						)}
						{item.hint && (
							<span className="text-text-2" data-testid="transcript-end-hint">
								{item.hint}
							</span>
						)}
					</p>
					{failure?.detail && (
						<p
							className="text-meta text-text-3 [overflow-wrap:anywhere]"
							data-testid="transcript-end-detail"
						>
							{failure.detail}
						</p>
					)}
				</li>
			);
		}
		case "empty":
			return (
				<li
					className="py-6 text-center text-text-2"
					data-testid="transcript-empty"
				>
					{item.text}
				</li>
			);
	}
}

/**
 * A run of tool calls, one card per step. Past {@link FOLD_OVER} the middle
 * folds behind one control; a step opened or highlighted there unfolds it.
 */
function StepGroup({
	item,
	steps,
	cwd,
}: {
	item: Extract<TranscriptItem, { kind: "tools" }>;
	steps?: TranscriptSteps;
	cwd?: string | null;
}) {
	const [unfolded, setUnfolded] = useState(false);
	const byCall = new Map(steps?.all.map((s) => [s.callId, s]));
	const own = item.callIds.flatMap((id) => {
		const s = byCall.get(id);
		return s ? [s] : [];
	});
	if (!steps || own.length === 0)
		return (
			<li className="text-meta text-text-3" data-testid="transcript-tools">
				{item.summary || `Ran ${item.count} tools`}
			</li>
		);
	const hidden =
		own.length > FOLD_OVER ? own.slice(FOLD_KEEP, own.length - FOLD_KEEP) : [];
	const fold =
		!unfolded &&
		hidden.length > 0 &&
		!hidden.some((s) => steps.open.has(s.n) || steps.highlight === s.n);
	const shown = fold
		? [...own.slice(0, FOLD_KEEP), ...own.slice(own.length - FOLD_KEEP)]
		: own;
	return (
		<>
			{shown.map((s, i) => (
				<Fragment key={s.callId}>
					{fold && i === FOLD_KEEP && (
						<li>
							<button
								type="button"
								onClick={() => setUnfolded(true)}
								className="w-full rounded-surface px-3 py-1.5 text-left text-meta text-text-2 transition-colors duration-(--dur-instant) hover:bg-surface-2 hover:text-text-1"
								data-testid="steps-unfold"
							>
								Steps {hidden[0]?.n} to {hidden[hidden.length - 1]?.n},{" "}
								{hidden.length} more
							</button>
						</li>
					)}
					<StepCard
						step={{
							...s,
							command: shortPath(s.command, cwd),
						}}
						open={steps.open.has(s.n)}
						onToggle={() => steps.onToggle(s.n)}
						highlight={steps.highlight === s.n}
						flagged={steps.flagged.has(s.n)}
						onSeeFlag={steps.onSeeFlag}
						ask={steps.asks?.findLast((a) => a.step === s.n)}
						fileSha={steps.fileOf?.(s)?.sha}
						onOpenFile={
							steps.onOpenFile ? () => steps.onOpenFile?.(s) : undefined
						}
					/>
				</Fragment>
			))}
		</>
	);
}

/** Thumbnails for images, a file chip for text, each opening the stored file. */
function Attachments({
	incidentId,
	files,
}: {
	incidentId: string;
	files: AttachmentView[];
}) {
	return (
		<div
			className="mt-1 flex flex-wrap gap-2"
			data-testid="transcript-attachments"
		>
			{files.map((f) => {
				const href = `/api/incidents/${incidentId}/attachments/${f.id}`;
				return f.mimeType.startsWith("image/") ? (
					<a key={f.id} href={href} target="_blank" rel="noreferrer">
						<img
							src={href}
							alt={f.name}
							className="h-16 max-w-40 rounded-[var(--radius-control)] object-cover"
						/>
					</a>
				) : (
					<a
						key={f.id}
						href={href}
						target="_blank"
						rel="noreferrer"
						className="inline-flex h-7 max-w-56 items-center gap-1.5 rounded-[var(--radius-control)] bg-surface-3 px-2 text-meta text-text-1 hover:bg-surface-4"
					>
						<FileText className="size-3.5 shrink-0 text-text-3" />
						<span className="truncate">{f.name}</span>
					</a>
				);
			})}
		</div>
	);
}
