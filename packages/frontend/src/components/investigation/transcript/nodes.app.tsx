// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { markLook } from "@/components/kit/marks";
import { retryCount, retryPassed, stopNodeLine } from "@/lib/provider-stop";
import { cn } from "@/lib/utils";
import type { TranscriptNodeProps, TranscriptNodes } from "./types";

/** A provider stop, a retry, a resume or a restart, one quiet line (#1024, #1101). */
function StopNode(props: TranscriptNodeProps) {
	const { event } = props;
	const line = stopNodeLine(event);
	if (!line) return null;
	if (event.kind === "provider_retry") return <RetryNode {...props} />;
	return (
		<div
			className="flex items-center gap-2 py-1 text-meta text-text-3"
			data-testid={`node-${event.kind}`}
		>
			<span aria-hidden className="h-px w-3 shrink-0 bg-hairline" />
			<span className="min-w-0 [overflow-wrap:anywhere]">{line}</span>
		</div>
	);
}

/** A retry is a counter on one line, amber while waiting; later tries replace it (#1101). */
function RetryNode({ event }: TranscriptNodeProps) {
	if (event.kind !== "provider_retry") return null;
	const now = Date.now();
	const line = stopNodeLine(event, undefined, now) ?? "";
	const count = retryCount(event);
	const passed = retryPassed(event, now);
	// Amber while a try is ahead, or when the last one ran out and the thread needs you.
	const waiting =
		event.phase !== "succeeded" &&
		(!passed || event.attempt >= event.maxAttempts);
	const look = markLook("limit", waiting ? "limited" : "any");
	const Icon = look.icon;
	return (
		<div
			className="flex h-7 min-w-0 items-center gap-2 text-meta text-text-3"
			data-testid="node-provider_retry"
		>
			<Icon
				aria-hidden
				className={cn("size-3.5 shrink-0 stroke-[1.75]", look.className)}
			/>
			<span
				className={cn("shrink-0 tabular-nums", waiting && "text-warn")}
				data-testid="node-retry-count"
			>
				{count}
			</span>{" "}
			<span className="min-w-0 truncate">
				{line.slice(count.length).trim()}
			</span>
		</div>
	);
}

const stop = { Node: StopNode };

/** What the agent sent that this host does not know, as a plain row: never dropped, never blocking (#1101). */
function DriftNode({ event }: TranscriptNodeProps) {
	if (event.kind !== "agent_drift") return null;
	const look = markLook("drift", event.protocol ? "protocol" : "update");
	const Icon = look.icon;
	const line = event.protocol
		? `The agent speaks protocol v${event.protocol.agent}; PrismaLens knows v${event.protocol.host}. Updates it does not know show as rows like this.`
		: `${event.update ?? "An update"}${event.text ? "" : ", not known to PrismaLens"}`;
	return (
		<div
			className="flex min-w-0 items-start gap-2 py-1 text-meta text-text-3"
			data-testid="node-agent_drift"
		>
			<Icon
				aria-label={look.label}
				className={cn("mt-0.5 size-3.5 shrink-0 stroke-[1.75]", look.className)}
			/>
			<span className="min-w-0 [overflow-wrap:anywhere]">
				{event.text ? (
					<>
						<span className="font-mono">{event.update}</span> {event.text}
					</>
				) : (
					line
				)}
			</span>
		</div>
	);
}

/** UI 3's transcript nodes (#1024, #1101). Only UI 3 edits this file. */
export const appNodes = {
	usage_limit: stop,
	provider_blocked: stop,
	provider_retry: stop,
	resume_scheduled: stop,
	resumed: stop,
	run_interrupted: stop,
	agent_drift: { Node: DriftNode },
} satisfies TranscriptNodes;
