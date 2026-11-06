// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { SubagentState } from "@prismalens/contracts";
import { TickDot } from "@/components/schedules/TickDot";
import { Ring } from "@/components/shared/Ring";
import { SUBAGENT_WORD, type SubagentView } from "@/lib/subagents";
import { cn } from "@/lib/utils";

const TONE = {
	completed: "ok",
	failed: "bad",
	cancelled: "muted",
} as const;

/** A ring while it works, else a dot in its end's tone; its word always beside it. */
export function SubagentMark({ state }: { state: SubagentState }) {
	if (state === "running") return <Ring />;
	return <TickDot tone={TONE[state]} />;
}

/** One sub-agent's node in the transcript (#1025): title, state and last step; it opens its view. */
export function SubagentNode({
	agent,
	onOpen,
}: {
	agent: SubagentView;
	onOpen?: (sessionId: string) => void;
}) {
	const body = (
		<>
			<SubagentMark state={agent.state} />
			<span className="min-w-0 shrink truncate font-medium text-text-1">
				{agent.title}
			</span>
			<span className="shrink-0 text-text-3" data-testid="subagent-state">
				{SUBAGENT_WORD[agent.state]}
			</span>
			{agent.step && (
				<span
					className="min-w-0 flex-1 truncate text-text-2"
					data-testid="subagent-step"
				>
					{agent.step}
				</span>
			)}
		</>
	);
	const look =
		"flex w-full min-w-0 items-center gap-2.5 rounded-surface bg-surface-1 px-3 py-2 text-left text-meta";
	return (
		<li
			className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200"
			data-testid="transcript-subagent"
			data-state={agent.state}
		>
			{onOpen ? (
				<button
					type="button"
					onClick={() => onOpen(agent.sessionId)}
					className={cn(
						look,
						"transition-colors duration-(--dur-instant) hover:bg-surface-2",
					)}
					data-testid="subagent-open"
				>
					{body}
				</button>
			) : (
				<div className={look}>{body}</div>
			)}
		</li>
	);
}
