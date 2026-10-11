// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { FileText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAnswerAsk } from "@/lib/api/hooks/use-investigations-orpc";
import { formatClock } from "@/lib/format-time";
import type { AttachmentView } from "@/lib/investigation-events";
import { mcpTool, shortPath } from "@/lib/report-view";
import { type AskRecord, askTitle } from "@/lib/run-asks";
import { isConflict } from "./useInvestigationRun";

/** After the next ask takes the slot, a click or key this soon was meant for the last one (#820). */
const SWAP_GUARD_MS = 600;

/**
 * What waits on you, docked on the box (#820, #673 w5-43): the agent's ask
 * with Approve and Deny, then your messages waiting for its next pause. The
 * box adds the files going with your next message under them.
 */
export function RunDock({
	asks,
	queued,
	runId,
	agent,
	cwd,
	onStep,
}: {
	/** Asks still waiting, oldest first. */
	asks: readonly AskRecord[];
	queued: readonly {
		key: string;
		text: string;
		attachments: AttachmentView[];
	}[];
	runId?: string;
	agent: string;
	cwd?: string | null;
	/** Rings the ask's step in the transcript. */
	onStep?: (n: number) => void;
}) {
	const ask = asks[0];
	// An answer moves focus to the next ask's text, never onto its Approve.
	const [answered, setAnswered] = useState(false);
	return (
		<>
			{ask && (
				<AskPanel
					key={ask.askId}
					ask={ask}
					count={asks.length}
					runId={runId}
					agent={agent}
					cwd={cwd}
					onStep={onStep}
					focus={answered}
					onAnswer={() => setAnswered(true)}
				/>
			)}
			{queued.length > 0 && (
				<ul className="flex flex-col gap-0.5" data-testid="dock-queued">
					{queued.map((m) => (
						<li
							key={m.key}
							className="flex min-w-0 items-baseline gap-2 text-meta"
							data-testid="composer-queued"
						>
							<span className="shrink-0 text-text-3">
								Waits for the agent's next pause
							</span>
							<span dir="auto" className="min-w-0 flex-1 truncate text-text-1">
								{m.text}
							</span>
							{m.attachments.length > 0 && (
								<span className="inline-flex shrink-0 items-center gap-1 text-text-3">
									<FileText className="size-3" aria-hidden />
									{m.attachments.length === 1
										? "1 file"
										: `${m.attachments.length} files`}
								</span>
							)}
						</li>
					))}
				</ul>
			)}
		</>
	);
}

/**
 * One ask at a time, keyed by its id: when the next takes the slot, focus
 * moves to what it asks, never onto Approve, and a press in the first moment
 * is ignored, so one Enter never answers two asks.
 */
function AskPanel({
	ask,
	count,
	runId,
	agent,
	cwd,
	onStep,
	focus,
	onAnswer,
}: {
	ask: AskRecord;
	count: number;
	runId?: string;
	agent: string;
	cwd?: string | null;
	onStep?: (n: number) => void;
	focus: boolean;
	onAnswer: () => void;
}) {
	const answer = useAnswerAsk();
	const what = useRef<HTMLParagraphElement>(null);
	const [armed, setArmed] = useState(false);
	const focused = useRef(focus);
	useEffect(() => {
		if (focused.current) what.current?.focus();
		const t = window.setTimeout(() => setArmed(true), SWAP_GUARD_MS);
		return () => window.clearTimeout(t);
	}, []);
	const send = (decision: "approve" | "deny") => {
		if (!runId || !armed) return;
		onAnswer();
		answer.mutate({ id: runId, askId: ask.askId, decision });
	};
	const mcp = mcpTool(ask.title);
	const body = ask.detail ?? ask.input;
	const title = askTitle(ask);
	return (
		<section
			aria-label="The agent asks before a tool call"
			className="flex min-w-0 flex-col gap-1.5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-200"
			data-testid="dock-ask"
		>
			<p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-meta">
				<span
					aria-hidden
					className="breathe size-[7px] shrink-0 self-center rounded-full bg-warn"
				/>
				<span className="font-medium text-text-1">{agent} asks to run</span>
				{count > 1 && (
					<span
						className="text-text-3 tabular-nums"
						data-testid="dock-ask-count"
					>
						1 of {count}
					</span>
				)}
				{ask.step !== undefined && onStep && (
					<button
						type="button"
						onClick={() => ask.step !== undefined && onStep(ask.step)}
						className="text-accent underline-offset-[3px] hover:underline"
						data-testid="dock-ask-step"
					>
						Step {ask.step}
					</button>
				)}
				<span className="ml-auto text-text-3 tabular-nums">
					{ask.clamped
						? `The run's time limit is near, so this ask expires at ${formatClock(ask.expiresAt)}`
						: `Denied at ${formatClock(ask.expiresAt)} if no one answers`}
				</span>
			</p>
			<p
				ref={what}
				tabIndex={-1}
				aria-live="polite"
				className="outline-none [overflow-wrap:anywhere]"
				data-testid="dock-ask-title"
			>
				{mcp || !body ? title : <span className="sr-only">{title}</span>}
			</p>
			{body && (
				<pre
					className="m-0 max-h-36 overflow-auto rounded-control bg-surface-2 px-2.5 py-1.5 font-mono text-mono whitespace-pre-wrap text-text-1 [overflow-wrap:anywhere]"
					data-testid="dock-ask-detail"
				>
					{shortPath(body, cwd)}
				</pre>
			)}
			<div className="flex flex-wrap items-center gap-2">
				<Button
					variant="primary"
					disabled={!runId || !armed || answer.isPending || answer.isSuccess}
					onClick={() => send("approve")}
					data-testid="ask-approve"
				>
					Approve
				</Button>
				<Button
					variant="secondary"
					disabled={!runId || !armed || answer.isPending || answer.isSuccess}
					onClick={() => send("deny")}
					data-testid="ask-deny"
				>
					Deny
				</Button>
				{answer.isError && (
					<span className="text-meta text-danger" data-testid="dock-ask-error">
						{isConflict(answer.error)
							? "That ask is no longer waiting."
							: "Your answer did not reach the run. Try again."}
					</span>
				)}
			</div>
		</section>
	);
}
