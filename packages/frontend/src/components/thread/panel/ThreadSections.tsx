// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	PlanEntry,
	ThreadContext,
	ThreadNodeState,
	ThreadSession,
	ThreadTree,
} from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { Check, Circle, CircleDot } from "lucide-react";
import type { ReactNode } from "react";
import { AgentMark } from "@/components/agent/AgentMark";
import { TickDot } from "@/components/schedules/TickDot";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** One titled section of the Thread tab; `id` is what `?section=` names. */
export function PanelSection({
	id,
	title,
	aside,
	children,
}: {
	id: string;
	title: string;
	aside?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section
			id={`panel-section-${id}`}
			aria-label={title}
			className="flex flex-col gap-1.5"
			data-testid={`panel-section-${id}`}
		>
			<h3 className="flex items-baseline gap-2 px-2 text-meta font-medium text-text-2">
				<span className="flex-1">{title}</span>
				{aside}
			</h3>
			{children}
		</section>
	);
}

const NODE_STATE: Record<
	ThreadNodeState,
	[tone: "live" | "ok" | "bad" | "muted", word: string]
> = {
	queued: ["muted", "Queued"],
	running: ["live", "Working"],
	answered: ["ok", "Answered"],
	failed: ["bad", "Failed"],
	stopped: ["muted", "Stopped"],
};

const START_WORD = {
	ask: "New threads ask you",
	allow: "Agents start threads freely",
	never: "Agents may not start threads",
} as const;

/** The deepest indent the tree draws; deeper threads sit at this level. */
export const TREE_INDENT_MAX = 3;

/** The threads an agent started from this one: indented, with state and unread count. */
export function ThreadTreeSection({
	tree,
	currentId,
	isHost,
	onRevoke,
}: {
	tree: ThreadTree;
	currentId: string;
	isHost: boolean;
	onRevoke?: () => void;
}) {
	return (
		<div className="flex flex-col gap-1">
			<ul className="m-0 flex list-none flex-col p-0" data-testid="thread-tree">
				{tree.nodes.map((n) => {
					const [tone, word] = NODE_STATE[n.state];
					return (
						<li
							key={n.id}
							style={{
								paddingLeft: `${Math.min(n.depth, TREE_INDENT_MAX) * 14}px`,
							}}
							data-testid="thread-tree-node"
							data-depth={n.depth}
						>
							<Link
								to="/threads/$id"
								params={{ id: n.id }}
								aria-current={n.id === currentId ? "page" : undefined}
								className={cn(
									"flex min-w-0 items-center gap-2 rounded-control px-2 py-1 transition-colors duration-(--dur-instant) hover:bg-surface-3",
									n.id === currentId && "bg-surface-3",
								)}
							>
								<TickDot tone={tone} />
								<span className="min-w-0 flex-1 truncate text-text-1">
									{n.title ?? `#${n.number}`}
								</span>
								{n.role && (
									<span className="shrink-0 text-meta text-text-3">
										{n.role}
									</span>
								)}
								<span className="shrink-0 text-meta text-text-2">{word}</span>
								{n.unread > 0 && (
									<span
										className="shrink-0 rounded-full bg-surface-3 px-1.5 text-meta text-text-1 tabular-nums"
										data-testid="thread-tree-unread"
									>
										<span aria-hidden>{n.unread}</span>
										<span className="sr-only">{n.unread} unread</span>
									</span>
								)}
							</Link>
							{n.state === "running" && n.lastStep && (
								<p
									className="truncate px-2 pl-6 font-mono text-meta text-text-3"
									data-testid="thread-tree-last-step"
								>
									{n.lastStep}
								</p>
							)}
						</li>
					);
				})}
			</ul>
			{tree.limits && (
				<p
					className="flex flex-wrap items-center gap-x-2 px-2 text-meta text-text-3"
					data-testid="thread-tree-limits"
				>
					<span>
						Depth {Math.max(...tree.nodes.map((n) => n.depth))} of{" "}
						{tree.limits.depth}
					</span>
					<span>
						· {tree.nodes.filter((n) => n.state === "running").length} of{" "}
						{tree.limits.perTree} running
					</span>
					{!tree.allowance && (
						<span>· {START_WORD[tree.limits.agentsStartThreads]}</span>
					)}
					<Link
						to="/settings"
						search={{ tab: "agent" }}
						className="ml-auto text-accent hover:underline"
					>
						Limits
					</Link>
				</p>
			)}
			{tree.allowance && (
				<p
					className="flex items-center gap-2 px-2 text-meta text-text-2"
					data-testid="thread-tree-allowance"
				>
					<span className="flex-1">Agents may start threads here</span>
					{isHost && onRevoke && (
						<Button variant="text" size="sm" onClick={onRevoke}>
							Revoke
						</Button>
					)}
				</p>
			)}
		</div>
	);
}

const PLAN_ICON = {
	completed: Check,
	in_progress: CircleDot,
	pending: Circle,
} as const;

export function PlanSection({ plan }: { plan: PlanEntry[] }) {
	return (
		<ol
			className="m-0 flex list-none flex-col gap-0.5 p-0 px-2"
			data-testid="plan"
		>
			{plan.map((p, i) => {
				const Icon = PLAN_ICON[p.status];
				return (
					<li
						// Plan entries carry no id; their order is the agent's.
						// biome-ignore lint/suspicious/noArrayIndexKey: the agent's list order is the identity
						key={i}
						className="flex items-start gap-2"
						data-status={p.status}
					>
						<Icon
							className={cn(
								"mt-1 size-3 shrink-0",
								p.status === "completed" ? "text-ok" : "text-text-3",
							)}
							aria-hidden
						/>
						<span
							className={cn(
								"min-w-0 flex-1",
								p.status === "completed" ? "text-text-3" : "text-text-1",
							)}
						>
							{p.content}
						</span>
					</li>
				);
			})}
		</ol>
	);
}

const OS_WORD = {
	windows: "Windows",
	macos: "macOS",
	linux: "Linux",
	other: "Other",
} as const;

const clock = new Intl.DateTimeFormat(undefined, {
	hour: "numeric",
	minute: "2-digit",
});

/** Working, Idle, or Limited until a time; the cache word only when it is known. */
export function sessionLine(
	live: boolean,
	session: ThreadSession | undefined,
): string {
	const limit = session?.limit;
	const state = limit
		? limit.resetsAt
			? `Limited until ${clock.format(new Date(limit.resetsAt))}`
			: "Limited"
		: live
			? "Working"
			: "Idle";
	const cache =
		session && session.cache !== "unknown" ? `, ${session.cache}` : "";
	return state + cache;
}

/** Which machine and agent the thread runs on; "Another machine" only when the viewer is not the host. */
export function MachineAgentSection({
	context,
	agentLabel,
	live,
	session,
}: {
	context: Pick<ThreadContext, "machine" | "agent">;
	agentLabel: string | null;
	live: boolean;
	session?: ThreadSession;
}) {
	const { machine, agent } = context;
	return (
		<dl
			className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-2 text-meta"
			data-testid="machine-agent"
		>
			<dt className="text-text-3">Machine</dt>
			<dd className="m-0 min-w-0 truncate text-text-1" data-testid="machine">
				{machine.hostName} · {OS_WORD[machine.os]}
				{!machine.isHost && (
					<span className="text-text-3" data-testid="machine-other">
						{" "}
						· Another machine
					</span>
				)}
			</dd>
			<dt className="text-text-3">Agent</dt>
			<dd
				className="m-0 flex min-w-0 items-center gap-1.5 text-text-1"
				data-testid="agent"
			>
				{agent.harness && (
					<AgentMark id={agent.harness} className="size-3.5 shrink-0" />
				)}
				<span className="truncate">
					{[agentLabel ?? agent.harness ?? "Agent", agent.model, agent.effort]
						.filter(Boolean)
						.join(" · ")}
				</span>
			</dd>
			<dt className="text-text-3">Session</dt>
			<dd className="m-0 text-text-1" data-testid="session">
				{sessionLine(live, session)}
			</dd>
		</dl>
	);
}
