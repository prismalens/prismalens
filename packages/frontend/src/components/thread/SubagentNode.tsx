// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { SubagentState } from "@prismalens/contracts";
import { Mark } from "@/components/kit/Mark";
import { Surface } from "@/components/kit/Surface";
import { Ring } from "@/components/shared/Ring";
import { SUBAGENT_WORD, type SubagentView } from "@/lib/subagents";
import { cn } from "@/lib/utils";

/** The `run` mark: the ring while it works, else its end's shape; the word rides in the hint. */
export function SubagentMark({
	state,
	testId,
}: {
	state: SubagentState;
	testId?: string;
}) {
	return (
		<Mark
			id="run"
			state={state}
			word={SUBAGENT_WORD[state]}
			glyph={state === "running" ? <Ring /> : undefined}
			testId={testId}
		/>
	);
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
			<SubagentMark state={agent.state} testId="subagent-state" />
			<span className="min-w-0 shrink truncate font-medium text-text-1">
				{agent.title}
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
		<Surface
			id="subagent.node"
			ctx={{
				title: agent.title,
				onOpen: onOpen ? () => onOpen(agent.sessionId) : undefined,
				facts: { is: { openable: !!onOpen } },
			}}
		>
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
		</Surface>
	);
}
