// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	HarnessStatus,
	PlanEntry,
	ThreadContext,
	ThreadLinks,
	ThreadSession,
} from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { Check, Circle, CircleDot } from "lucide-react";
import type { ReactNode } from "react";
import { defaultModel, modelName } from "@/components/agent/agent-choice";
import { linkStates } from "@/components/investigation/transcript/link-states";
import { fact } from "@/components/kit/fact";
import { StartedByMark } from "@/components/kit/MarkBadges";
import { Status } from "@/components/kit/Status";
import { Hint } from "@/components/shared/Hint";
import { Button } from "@/components/ui/button";
import { sessionLine } from "@/lib/session-boundary";
import { cn } from "@/lib/utils";
import { DetailsStarted } from "./DetailsStarted";
import {
	contextWords,
	costWords,
	sessionWord,
	tokenWords,
} from "./thread-usage";

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
				<span className="flex-1" data-testid={`panel-section-${id}-title`}>
					{title}
				</span>
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

/** The Started section's heading: "Started · {r} running", or "Started" when nothing runs (#1176 D16). */
export function startedHeading(r: number): string {
	return r > 0 ? `Started · ${r} running` : "Started";
}

/**
 * The panel's Started section (#1176 D16): who started this thread above, then every
 * sub-agent and thread started from it, from stored state, then the caps it runs under.
 */
export function StartedSection({
	links,
	isHost,
	harness = null,
	onRevoke,
	onOpenSubagent,
}: {
	links: ThreadLinks;
	isHost: boolean;
	/** The thread's own agent, which ran its sub-agents. */
	harness?: string | null;
	onRevoke?: () => void;
	onOpenSubagent?: (sessionId: string) => void;
}) {
	// The caps count only agent starts; a person's fork, side question or fix is not one.
	const running = links.started.filter(
		(l) => l.state === "running" && (l.via ?? "agent") === "agent",
	).length;
	const by = links.startedBy;
	const subagents = links.subagents ?? [];
	return (
		<div className="flex flex-col" data-testid="started-section">
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
						fact={null}
					/>
				</Link>
			)}
			{(links.started.length > 0 || subagents.length > 0) && (
				<DetailsStarted
					started={links.started}
					subagents={subagents}
					harness={harness}
					{...(onOpenSubagent ? { onOpenSubagent } : {})}
				/>
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

/** The session's prompt cache, when known; its status is the header's, never said here (#1101 cat 21). */
export function cacheWord(session: ThreadSession | undefined): string | null {
	return session && session.cache !== "unknown"
		? CACHE_WORD[session.cache]
		: null;
}
const CACHE_WORD: Record<Exclude<ThreadSession["cache"], "unknown">, string> = {
	warm: "Warm",
	cold: "Cold",
};

const ROW_TONE = { warn: "text-warn", danger: "text-danger" } as const;

/** One `dt`/`dd` pair; `hint` holds the detail the few words leave out. */
function SessionRow({
	id,
	label,
	value,
	hint,
	tone,
}: {
	id: string;
	label: string;
	value: ReactNode;
	hint?: string | null;
	tone?: "warn" | "danger" | undefined;
}) {
	const dd = (
		<dd
			className={cn(
				"m-0 min-w-0 truncate",
				tone ? ROW_TONE[tone] : "text-text-1",
			)}
			data-testid={`session-row-${id}`}
		>
			{value}
		</dd>
	);
	return (
		<>
			<dt className="text-text-3">{label}</dt>
			{hint ? <Hint label={hint}>{dd}</Hint> : dd}
		</>
	);
}

/**
 * The Details tab's Session section (#1176 D10): agent, model, session, context, tokens
 * and cost from stored usage, then the machine and the prompt cache.
 */
export function SessionSection({
	context,
	session,
	harness,
}: {
	context: Pick<ThreadContext, "machine" | "agent" | "usage" | "session">;
	session?: ThreadSession;
	harness?: HarnessStatus | undefined;
}) {
	const { machine, agent, usage } = context;
	const cache = cacheWord(session);
	const agentName = (id: string) => (id === harness?.id ? harness.label : id);
	const model = (id: string) => modelName(harness, id) ?? id;
	const ctx = contextWords(usage);
	const tokens = tokenWords(usage);
	const cost = costWords(usage);
	const opening = context.session ?? null;
	return (
		<dl
			className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-2 text-meta"
			data-testid="session-section"
		>
			{agent.harness && (
				<SessionRow
					id="agent"
					label="Agent"
					value={<span {...fact("agent")}>{agentName(agent.harness)}</span>}
				/>
			)}
			{agent.harness && (
				<SessionRow
					id="model"
					label="Model"
					value={
						<span {...fact("model")}>
							{`${(harness && defaultModel(harness, agent.model)?.name) ?? "Agent default"}${agent.effort ? `, ${agent.effort}` : ""}`}
						</span>
					}
					hint={agent.model ? null : "Agent default"}
				/>
			)}
			<SessionRow
				id="session"
				label="Session"
				value={sessionWord(opening)}
				hint={
					opening ? sessionLine(opening, { agent: agentName, model }) : null
				}
			/>
			<SessionRow
				id="context"
				label="Context"
				value={ctx.text}
				tone={ctx.tone}
			/>
			{tokens && <SessionRow id="tokens" label="Tokens" value={tokens} />}
			{cost && (
				<SessionRow id="cost" label="Cost" value={cost.text} hint={cost.hint} />
			)}
			<SessionRow
				id="machine"
				label="Machine"
				value={
					<span data-testid="machine">
						{machine.hostName} · {OS_WORD[machine.os]}
						{!machine.isHost && (
							<span className="text-text-3" data-testid="machine-other">
								{" "}
								· Another machine
							</span>
						)}
					</span>
				}
			/>
			{cache && (
				<SessionRow
					id="cache"
					label="Cache"
					value={<span data-testid="session">{cache}</span>}
				/>
			)}
		</dl>
	);
}
