// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { FileText } from "lucide-react";
import { useEffect, useRef } from "react";
import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
} from "@/components/ai/conversation";
import {
	Message,
	MessageHeader,
	MessageResponse,
} from "@/components/ai/message";
import { Tool, ToolCall, ToolContent, ToolHeader } from "@/components/ai/tool";
import { RECORD_GRID, RecordLink } from "@/components/incidents/RecordLayout";
import { StateWord } from "@/components/shared/StateWord";
import { failureSentence } from "@/lib/failure-sentence";
import { formatClock, formatElapsed } from "@/lib/format-time";
import {
	type AttachmentView,
	type EventRow,
	OPERATOR_STATE_LABEL,
	type OperatorState,
	type TranscriptItem,
} from "@/lib/investigation-events";
import { refusalReason, refusalSentence } from "@/lib/refusal-sentence";
import { commandText, shortPath } from "@/lib/report-view";
import { cn } from "@/lib/utils";

const ENTER =
	"motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200";

/** The delivery word under "You" (decision 18): Enter waits for the agent's next pause. */
function deliveryWord(state: OperatorState, mode: "queue" | "now"): string {
	if (state === "not_delivered") return "Not delivered";
	if (state === "started" || state === "resumed")
		return OPERATOR_STATE_LABEL[state];
	if (state === "queued") return "Waits for the next pause";
	return mode === "now" ? "Sent now" : "Delivered at the next pause";
}

/**
 * The conversation (#743) on AI Elements' Conversation, Message and Tool, in
 * the one column (#673); it fades over its last 28 px above the box.
 */
export function Transcript({
	items,
	incidentId,
	focus,
	cwd,
	agent,
	lead,
}: {
	items: TranscriptItem[];
	incidentId: string;
	/** A tool call to open and scroll to, from a report's evidence link. */
	focus?: string;
	/** The run's workspace, shown as `repo/` (walk f16). */
	cwd?: string | null;
	agent: string;
	/** What the run started with, the transcript's first line (#673). */
	lead?: string;
}) {
	return (
		<Conversation
			className="h-full [mask-image:linear-gradient(to_bottom,#000_calc(100%-28px),transparent)]"
			data-testid="transcript-scroller"
		>
			{/* The library's both-edges gutter insets the phone column 15 px a side. */}
			<ConversationContent
				className="pt-4 pb-8"
				scrollClassName="max-md:[scrollbar-gutter:auto]!"
			>
				<div className={RECORD_GRID}>
					<div
						className="flex min-w-0 flex-col gap-3.5"
						data-testid="transcript"
					>
						{lead && (
							<p
								className="text-meta text-text-2"
								data-testid="transcript-gather"
							>
								{lead}
							</p>
						)}
						{items.map((item) => (
							<TranscriptRow
								key={item.key}
								item={item}
								incidentId={incidentId}
								focus={focus}
								cwd={cwd}
								agent={agent}
							/>
						))}
					</div>
				</div>
			</ConversationContent>
			<ConversationScrollButton />
		</Conversation>
	);
}

function TranscriptRow({
	item,
	incidentId,
	focus,
	cwd,
	agent,
}: {
	item: TranscriptItem;
	incidentId: string;
	focus?: string;
	cwd?: string | null;
	agent: string;
}) {
	switch (item.kind) {
		case "prose":
			return (
				<Message from="agent" className={ENTER} data-testid="transcript-agent">
					<MessageHeader
						who={agent}
						at={item.at ? formatClock(item.at) : undefined}
					/>
					<div data-testid="transcript-prose">
						<MessageResponse>{item.text}</MessageResponse>
					</div>
				</Message>
			);
		case "line":
			return (
				<p
					className={cn("text-meta text-text-3", ENTER)}
					data-testid="transcript-line"
				>
					{item.text}
				</p>
			);
		case "tools":
			return <ToolGroup item={item} focus={focus} cwd={cwd} />;
		case "divider":
			return (
				<p className="text-meta text-text-3" data-testid="transcript-divider">
					{item.text}
				</p>
			);
		case "thought":
			return (
				<p className="text-meta text-text-3" data-testid="transcript-thought">
					Thought for {formatElapsed(item.seconds)}
				</p>
			);
		case "thinking":
			return (
				<p
					className={cn(
						"flex items-center gap-2 text-meta tabular-nums",
						item.stale ? "text-warn" : "text-text-2",
					)}
					data-testid="transcript-thinking"
				>
					<span
						aria-hidden
						className={cn(
							"h-3 w-[3px] rounded-full",
							item.stale ? "bg-warn" : "breathe bg-live",
						)}
						data-testid="transcript-thinking-bar"
					/>
					{item.stale
						? `Quiet for ${formatElapsed(item.seconds)}`
						: `Thinking, ${formatElapsed(item.seconds)}`}
				</p>
			);
		case "operator":
			return (
				<Message
					from="you"
					className={ENTER}
					data-testid="transcript-operator"
					data-state={item.state}
				>
					<MessageHeader
						who="You"
						at={formatClock(item.at)}
						aside={
							<span
								className={cn(item.state === "not_delivered" && "text-danger")}
								data-testid="transcript-delivery"
							>
								{deliveryWord(item.state, item.mode)}
							</span>
						}
					/>
					{item.text && (
						<p className="text-body whitespace-pre-wrap [overflow-wrap:anywhere]">
							{item.text}
						</p>
					)}
					{item.attachments.length > 0 && (
						<Attachments incidentId={incidentId} files={item.attachments} />
					)}
				</Message>
			);
		case "end": {
			const failure =
				item.tone === "failed" ? failureSentence(agent, item.error) : null;
			return (
				<div className={cn("space-y-1", ENTER)} data-testid="transcript-end">
					<p className="flex flex-wrap items-baseline gap-x-2 text-body text-text-2">
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
						{item.report && (
							<RecordLink incidentId={incidentId} to="report">
								Read the report
							</RecordLink>
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
				</div>
			);
		}
		case "empty":
			return (
				<p
					className="py-6 text-center text-body text-text-2"
					data-testid="transcript-empty"
				>
					{item.text}
				</p>
			);
	}
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
			className="mt-2 flex flex-wrap gap-2"
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

/** A call's row, its result row if one came, in the order the calls were made. */
function callsOf(rows: EventRow[]) {
	const results = new Map<string, EventRow>();
	for (const r of rows)
		if (r.callId && r.icon !== "tool") results.set(r.callId, r);
	const out: { key: string; source: string; result?: EventRow }[] = [];
	const seen = new Set<string>();
	for (const r of rows) {
		const id = r.callId ?? r.key;
		if (seen.has(id)) continue;
		seen.add(id);
		const result = r.callId ? results.get(r.callId) : r;
		out.push({ key: r.key, source: result?.message ?? r.message, result });
	}
	return out;
}

/** A tool's output without the Markdown fences the agent wrapped it in (#673). */
export function unfence(text: string): string {
	return text.replace(/```[\w-]*[ \t]*\n|```/g, "").trim();
}

/** Refused calls did not run; the rest ran and failed (#673). */
function FailedCount({ calls }: { calls: ReturnType<typeof callsOf> }) {
	const failed = calls.filter((c) => c.result?.ok === false);
	const refused = failed.filter((c) => refusalReason(c.result?.detail)).length;
	const errored = failed.length - refused;
	const parts = [
		refused > 0 && `${refused} not run`,
		errored > 0 && `${errored} failed`,
	].filter(Boolean);
	if (parts.length === 0) return null;
	return <span className="shrink-0 text-danger">{parts.join(", ")}</span>;
}

function headline(item: Extract<TranscriptItem, { kind: "tools" }>): string {
	const s = item.summary.replace(/^./, (c) => c.toUpperCase());
	return s || `Ran ${item.count} tool${item.count === 1 ? "" : "s"}`;
}

function ToolGroup({
	item,
	focus,
	cwd,
}: {
	item: Extract<TranscriptItem, { kind: "tools" }>;
	focus?: string;
	cwd?: string | null;
}) {
	const cited = !!focus && item.callIds.includes(focus);
	const calls = callsOf(item.rows);
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (cited) ref.current?.scrollIntoView({ block: "center" });
	}, [cited]);
	return (
		<div
			ref={ref}
			data-testid="transcript-tools"
			data-cited={cited ? "" : undefined}
		>
			<Tool defaultOpen={cited}>
				<ToolHeader aside={<FailedCount calls={calls} />}>
					{headline(item)}
				</ToolHeader>
				<ToolContent data-testid="transcript-tool-rows">
					{calls.map(({ key, source, result }) => {
						const reason =
							result?.ok === false ? refusalReason(result.detail) : null;
						const detail = result?.detail && unfence(result.detail);
						return (
							<ToolCall
								key={key}
								command={commandText(source, cwd)}
								running={!result}
								output={detail && shortPath(detail, cwd)}
								refused={
									result?.ok === false
										? reason
											? refusalSentence(reason)
											: `Failed: ${detail || "no output"}`
										: undefined
								}
							/>
						);
					})}
				</ToolContent>
			</Tool>
		</div>
	);
}
