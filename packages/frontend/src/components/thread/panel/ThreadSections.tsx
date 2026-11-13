// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	PlanEntry,
	ThreadContext,
	ThreadLinks,
	ThreadSession,
} from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { Check, Circle, CircleDot } from "lucide-react";
import type { ReactNode } from "react";
import { AgentMark } from "@/components/agent/AgentMark";
import { linkStates } from "@/components/investigation/transcript/link-states";
import { StartedByMark } from "@/components/kit/MarkBadges";
import { Status } from "@/components/kit/Status";
import { Hint } from "@/components/shared/Hint";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DetailsStarted, STARTED_SHOWN, StartedRow } from "./DetailsStarted";

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

const START_WORD = {
	ask: "New threads ask you",
	allow: "Agents start threads freely",
	never: "Agents may not start threads",
} as const;

/**
 * The panel's Threads section (#1101 cat 10): who started this thread, every thread it
 * started with its status mark, the caps it runs under, and the chain's allowance.
 */
export function ThreadLinksSection({
	links,
	isHost,
	onRevoke,
	onFilter,
}: {
	links: ThreadLinks;
	isHost: boolean;
	onRevoke?: () => void;
	onFilter?: () => void;
}) {
	const running = links.started.filter((l) => l.state === "running").length;
	const by = links.startedBy;
	return (
		<div className="flex flex-col">
			{by && (
				<Link
					to="/threads/$id"
					params={{ id: by.id }}
					className="flex h-7 min-w-0 items-center gap-2 rounded-control px-2 text-body hover:bg-surface-3"
					data-testid="thread-links-started-by"
				>
					<StartedByMark by={by} />
					<span className="min-w-0 flex-1 truncate text-text-1">
						{by.title ?? "Thread"}
					</span>
					<Status
						kind={by.status ?? linkStates.get(by.state).status}
						showWord={false}
					/>
				</Link>
			)}
			{links.started.length > 0 && (
				<DetailsStarted
					started={links.started}
					{...(onFilter ? { onFilter } : {})}
				/>
			)}
			{links.started.length > STARTED_SHOWN && (
				<ul
					className="m-0 flex list-none flex-col p-0"
					data-testid="thread-links-rest"
				>
					{links.started.slice(STARTED_SHOWN).map((l) => (
						<li key={l.id}>
							<StartedRow l={l} />
						</li>
					))}
				</ul>
			)}
			<p
				className="flex h-7 items-center gap-x-1.5 px-2 text-meta text-text-3"
				data-testid="thread-tree-limits"
			>
				<span>
					{running} of {links.limits.perStarter} running
				</span>
				<span className="flex-1" />
				<Hint
					label={START_WORD[links.limits.agentsStartThreads]}
					when={!links.allowance}
				>
					<Link
						to="/settings"
						search={{ tab: "agent" }}
						className="text-text-2 hover:text-text-1"
					>
						Limits
					</Link>
				</Hint>
			</p>
			{links.allowance && (
				<p
					className="flex h-7 items-center gap-2 px-2 text-meta text-text-2"
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
