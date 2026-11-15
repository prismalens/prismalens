// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ChevronRight } from "lucide-react";
import { useSecondClock } from "@/hooks/use-clock";
import { formatElapsed } from "@/lib/format-time";
import { seconds } from "@/lib/investigation-events";
import { SUBAGENT_WORD, type SubagentView } from "@/lib/subagents";
import { SubagentMark } from "./SubagentNode";

/** Running sub-agents with their timers, finished ones folded under Earlier; each row opens its view. */
export function SubagentList({
	agents,
	onOpen,
}: {
	agents: readonly SubagentView[];
	onOpen?: (sessionId: string) => void;
}) {
	const running = agents.filter((a) => a.state === "running");
	const earlier = agents.filter((a) => a.state !== "running");
	return (
		<div className="flex flex-col gap-0.5" data-testid="status-subagents">
			<span className="text-meta text-text-3">Sub-agents</span>
			{running.map((a) => (
				<SubagentRow key={a.sessionId} agent={a} onOpen={onOpen} />
			))}
			{earlier.length > 0 && (
				<details className="group" data-testid="status-subagents-earlier">
					<summary className="flex cursor-pointer list-none items-center gap-1.5 py-0.5 text-meta text-text-2 hover:text-text-1">
						<ChevronRight
							aria-hidden
							className="size-3 shrink-0 text-text-3 transition-transform duration-(--dur-fast) group-open:rotate-90 motion-reduce:transition-none"
						/>
						Earlier
						<span className="text-text-3 tabular-nums">{earlier.length}</span>
					</summary>
					{earlier.map((a) => (
						<SubagentRow key={a.sessionId} agent={a} onOpen={onOpen} />
					))}
				</details>
			)}
		</div>
	);
}

function SubagentRow({
	agent,
	onOpen,
}: {
	agent: SubagentView;
	onOpen?: (sessionId: string) => void;
}) {
	return (
		<button
			type="button"
			onClick={() => onOpen?.(agent.sessionId)}
			className="flex min-h-6 w-full min-w-0 items-center gap-2 rounded-control px-1 text-left transition-colors duration-(--dur-instant) hover:bg-surface-2"
			data-testid="status-subagent"
			data-state={agent.state}
		>
			<span className="flex size-3.5 shrink-0 items-center justify-center">
				<SubagentMark state={agent.state} />
			</span>
			<span className="min-w-0 flex-1 truncate text-text-1">{agent.title}</span>
			{agent.state === "running" ? (
				<Elapsed since={agent.startedAt} />
			) : (
				<span className="shrink-0 text-meta text-text-3">
					{SUBAGENT_WORD[agent.state]}
				</span>
			)}
		</button>
	);
}

/** Counts up on the shared clock in its own leaf, so the box does not redraw each second. */
function Elapsed({ since }: { since: string }) {
	const now = useSecondClock();
	return (
		<span
			className="shrink-0 text-meta text-text-3 tabular-nums"
			data-testid="status-subagent-elapsed"
		>
			{formatElapsed(now === null ? 0 : seconds(since, now))}
		</span>
	);
}
