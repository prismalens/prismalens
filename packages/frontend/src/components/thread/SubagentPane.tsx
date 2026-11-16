// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import { useMutation } from "@tanstack/react-query";
import { MessageSquareQuote } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Transcript } from "@/components/investigation/Transcript";
import { deriveSteps } from "@/components/run/run-steps";
import { MutationError } from "@/components/shared/MutationError";
import { Empty } from "@/components/shared/State";
import { Button } from "@/components/ui/button";
import { orpc } from "@/lib/api/orpc-client";
import { deriveTranscript } from "@/lib/investigation-events";
import {
	SUBAGENT_WORD,
	type SubagentView,
	subagentEvents,
} from "@/lib/subagents";
import { useThreadSchemasReady } from "@/lib/thread-schemas-load";
import { quoteOf, sendQuote } from "./composer/quote";
import { SubagentMark } from "./SubagentNode";

const QUOTE_TASK = 240;

/** The main composer's quote of a sub-agent: it is asked about, never messaged (ADR 0002 §5). */
export function askMainQuote(agent: Pick<SubagentView, "title" | "task">) {
	const task = (agent.task ?? "").replace(/\s+/g, " ").trim();
	const cut =
		task.length > QUOTE_TASK ? `${task.slice(0, QUOTE_TASK - 1)}…` : task;
	return `> Sub-agent "${agent.title}"${cut ? `: ${cut}` : ""}\n\n`;
}

/**
 * One sub-agent, read-only (#1025): its task, state, words and tool steps. It has
 * no composer; Cancel shows only while it runs and its agent granted it.
 */
export function SubagentPane({
	runId,
	agent,
	events,
	live,
	onAskMain,
}: {
	runId: string;
	agent: SubagentView;
	events: readonly CanonicalEvent[];
	live: boolean;
	/** Fills the page's main composer; absent where the page has none. */
	onAskMain?: (quote: string) => void;
}) {
	const cancel = useMutation(
		orpc.investigations.cancelSubagent.mutationOptions(),
	);
	// Its steps read as a run of their own, so the transcript draws them as the main agent's would.
	const own = useMemo(
		() =>
			subagentEvents(events, agent.sessionId).map(
				(e) => ({ ...e, path: [] }) as CanonicalEvent,
			),
		[events, agent.sessionId],
	);
	const ended = agent.state !== "running";
	const schemasReady = useThreadSchemasReady();
	const items = useMemo(
		() => (own.length ? deriveTranscript(own, { schemasReady }) : []),
		[own, schemasReady],
	);
	const all = useMemo(() => deriveSteps(own, { ended }), [own, ended]);
	const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
	const onToggle = useCallback(
		(n: number) =>
			setOpen((o) => {
				const next = new Set(o);
				if (!next.delete(n)) next.add(n);
				return next;
			}),
		[],
	);
	const steps = useMemo(
		() => ({
			all,
			open,
			onToggle,
			highlight: null,
			flagged: new Set<number>(),
		}),
		[all, open, onToggle],
	);
	const cancellable = live && agent.state === "running" && agent.canCancel;
	return (
		<div className="flex min-h-0 flex-1 flex-col" data-testid="subagent-pane">
			<div className="flex shrink-0 flex-col gap-1.5 px-3 py-2.5 text-body shadow-[0_1px_0_var(--hairline)]">
				<div className="flex min-w-0 items-center gap-2">
					<SubagentMark state={agent.state} />
					<h2
						className="min-w-0 flex-1 truncate font-medium text-text-1"
						data-testid="subagent-title"
					>
						{agent.title}
					</h2>
					<span className="shrink-0 text-meta text-text-3">
						{SUBAGENT_WORD[agent.state]}
					</span>
				</div>
				{agent.task && (
					<p
						dir="auto"
						className="m-0 max-h-32 overflow-y-auto whitespace-pre-wrap text-text-2 [overflow-wrap:anywhere]"
						data-testid="subagent-task"
					>
						{agent.task}
					</p>
				)}
				{agent.textCapped && (
					<p
						className="m-0 text-meta text-text-3"
						data-testid="subagent-capped"
					>
						Text over 200 KB not kept
					</p>
				)}
				<div className="flex flex-wrap items-center gap-2">
					{onAskMain && (
						<Button
							size="sm"
							variant="secondary"
							onClick={() => {
								// The main box takes it as a quote chip; a page without one gets the text.
								const chip = quoteOf(
									askMainQuote(agent).replace(/^> /, "").trim(),
									{
										threadId: runId,
										kind: "transcript",
									},
								);
								if (!chip || !sendQuote(runId, chip))
									onAskMain(askMainQuote(agent));
							}}
							data-testid="subagent-ask-main"
						>
							<MessageSquareQuote className="size-3.5" aria-hidden />
							Ask main agent about this
						</Button>
					)}
					{cancellable && (
						<Button
							size="sm"
							variant="secondary"
							disabled={cancel.isPending || cancel.isSuccess}
							onClick={() =>
								cancel.mutate({ id: runId, sessionId: agent.sessionId })
							}
							data-testid="subagent-cancel"
						>
							{cancel.isSuccess ? "Cancelling" : "Cancel"}
						</Button>
					)}
				</div>
				<MutationError error={cancel.error} />
			</div>
			<div className="min-h-0 flex-1">
				{items.length ? (
					<Transcript
						items={items}
						incidentId={null}
						agent={agent.title}
						steps={steps}
						runId={runId}
					/>
				) : (
					<div className="px-3">
						<Empty text="No steps yet" testId="subagent-empty" />
					</div>
				)}
			</div>
		</div>
	);
}
