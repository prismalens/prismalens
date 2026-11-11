// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CompactionMethod } from "@prismalens/contracts";
import { Button } from "@/components/ui/button";
import { formatClock } from "@/lib/format-time";
import { COMPACTION_METHOD_HINT, compactionLine } from "./session-words";

const LINE = "flex flex-wrap items-baseline gap-x-2 py-1 text-meta text-text-3";

/** A compaction in the transcript: started, completed with its sizes, or failed with Retry. */
export function CompactionNode({
	event,
	onRetry,
}: {
	event: {
		phase: "started" | "completed" | "failed";
		method: CompactionMethod;
		before?: number;
		after?: number;
		instructions?: string;
		/** Why it failed, when the API said. */
		reason?: string;
	};
	onRetry?: () => void;
}) {
	return (
		<div
			className={LINE}
			data-testid="node-compaction"
			data-phase={event.phase}
		>
			<span
				className={event.phase === "failed" ? "text-danger" : "text-text-2"}
			>
				{compactionLine(event)}
			</span>
			{event.phase === "completed" && (
				<span data-testid="node-compaction-method">
					{COMPACTION_METHOD_HINT[event.method]}
				</span>
			)}
			{event.instructions && (
				<span className="min-w-0 truncate" data-testid="node-compaction-focus">
					Kept: {event.instructions}
				</span>
			)}
			{event.phase === "failed" && event.reason && <span>{event.reason}</span>}
			{event.phase === "failed" && onRetry && (
				<Button
					size="sm"
					variant="text"
					onClick={onRetry}
					data-testid="node-compaction-retry"
				>
					Retry
				</Button>
			)}
		</div>
	);
}

/** `usage_limit`, `resume_scheduled` and `resumed`, one line each. */
export function limitNodeLine(
	e:
		| { kind: "usage_limit"; agent: string; resetsAt?: string | null }
		| {
				kind: "resume_scheduled";
				at: string | null;
				attempt?: number;
				gaveUp?: true;
		  }
		| { kind: "resumed"; reason: "limit_reset" | "idle_compact" | "wake" },
	clock: (at: string) => string = formatClock,
): string {
	switch (e.kind) {
		case "usage_limit":
			return e.resetsAt
				? `${e.agent} reached its usage limit · resets ${clock(e.resetsAt)}`
				: `${e.agent} reached its usage limit`;
		case "resume_scheduled":
			if (e.gaveUp || !e.at) return "Stopped trying to resume";
			return e.attempt && e.attempt > 1
				? `Trying again at ${clock(e.at)} (try ${e.attempt})`
				: `Resumes at ${clock(e.at)}`;
		case "resumed":
			return e.reason === "limit_reset"
				? "Resumed after the limit reset"
				: e.reason === "idle_compact"
					? "Compacted while idle"
					: "Woke up";
	}
}

export function LimitNode({
	event,
}: {
	event: Parameters<typeof limitNodeLine>[0];
}) {
	return (
		<div className={LINE} data-testid={`node-${event.kind}`}>
			<span>{limitNodeLine(event)}</span>
		</div>
	);
}
