// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A thread tree as the parent's transcript shows it (#1101 cat 10): a live row per child,
 * a labelled card per message, and a finish card with the answer, all without leaving.
 */
import type { CanonicalEvent, ThreadTreeNode } from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { ArrowDownLeft, ArrowUpRight, CornerLeftUp } from "lucide-react";
import { useState } from "react";
import { TickDot } from "@/components/schedules/TickDot";
import { useThreadTree } from "@/lib/api/hooks/use-thread-tree-orpc";
import { formatClock } from "@/lib/format-time";
import { cn } from "@/lib/utils";

type Ev<K extends CanonicalEvent["kind"]> = Extract<
	CanonicalEvent,
	{ kind: K }
>;

const NODE_WORD: Record<
	ThreadTreeNode["state"],
	["live" | "ok" | "bad" | "muted", string]
> = {
	queued: ["muted", "Queued"],
	running: ["live", "Working"],
	answered: ["ok", "Answered"],
	failed: ["bad", "Failed"],
	stopped: ["muted", "Stopped"],
};

const LINK = "text-accent hover:underline";

/** The tree this thread is in, refreshed while any member works. */
export function useTreeOf(threadId: string | undefined) {
	const first = useThreadTree(threadId ?? null, false);
	const live = !!first.data?.nodes.some((n) => n.state === "running");
	const tree = useThreadTree(threadId ?? null, live);
	return tree.data ?? first.data ?? null;
}

const idOf = (link: string, fallback: string) =>
	link.split("/").pop() || fallback;

function ThreadLink({ id, children }: { id: string; children: string }) {
	return (
		<Link to="/threads/$id" params={{ id }} className={LINK}>
			{children}
		</Link>
	);
}

/** A child as a live row: its title, role, state, what it did last and its unread count. */
export function ChildRow({
	node,
	fallbackTitle,
	role,
}: {
	node: ThreadTreeNode | undefined;
	fallbackTitle: string;
	role: string;
}) {
	const [tone, word] = node ? NODE_WORD[node.state] : NODE_WORD.queued;
	return (
		<div className="flex min-w-0 flex-col gap-0.5">
			<p className="flex min-w-0 items-center gap-2 text-body">
				<TickDot tone={tone} />
				<span className="min-w-0 truncate">
					{node ? (
						<ThreadLink id={node.id}>{node.title ?? fallbackTitle}</ThreadLink>
					) : (
						fallbackTitle
					)}
				</span>
				<span className="shrink-0 text-meta text-text-3">{role}</span>
				<span
					className="shrink-0 text-meta text-text-2"
					data-testid="child-state"
				>
					{word}
				</span>
				{node && node.unread > 0 && (
					<span
						className="shrink-0 rounded-full bg-surface-3 px-1.5 text-meta text-text-1 tabular-nums"
						data-testid="child-unread"
					>
						{node.unread} unread
					</span>
				)}
			</p>
			{node?.state === "running" && node.lastStep && (
				<p
					className="truncate pl-4 font-mono text-meta text-text-3"
					data-testid="child-last-step"
				>
					{node.lastStep}
				</p>
			)}
		</div>
	);
}

export function ThreadStartedCard({ event }: { event: Ev<"thread_started"> }) {
	const tree = useTreeOf(event.runId);
	const node = tree?.nodes.find((n) => n.id === event.childId);
	return (
		<div
			className="flex flex-col gap-1 rounded-surface bg-surface-1 px-3 py-2"
			data-testid="tree-started"
		>
			<p className="text-meta text-text-3">
				Started a thread · {formatClock(event.ts)}
			</p>
			<ChildRow node={node} fallbackTitle={event.title} role={event.role} />
		</div>
	);
}

const CLAMP_CHARS = 280;

/** A message between threads: who sent it, its role and time, sent and received told apart. */
export function ThreadMessageCard({ event }: { event: Ev<"thread_message"> }) {
	const tree = useTreeOf(event.runId);
	const [open, setOpen] = useState(false);
	const peerId = idOf(event.peerLink, event.peerId);
	const peer = tree?.nodes.find((n) => n.id === peerId);
	const sent = event.direction === "sent";
	const Icon = sent ? ArrowUpRight : ArrowDownLeft;
	const long = event.text.length > CLAMP_CHARS || event.text.includes("\n");
	return (
		<div
			className={cn(
				"flex flex-col gap-1 rounded-surface px-3 py-2",
				sent ? "ml-8 bg-surface-2" : "mr-8 bg-surface-1",
			)}
			data-testid="tree-message"
			data-direction={event.direction}
		>
			<p className="flex min-w-0 items-center gap-1.5 text-meta text-text-3">
				<Icon aria-hidden className="size-3.5 shrink-0" />
				<span className="shrink-0">{sent ? "To" : "From"}</span>
				<span className="min-w-0 truncate">
					<ThreadLink id={peerId}>
						{peer?.title ??
							(event.peerRole === "root" ? "the root thread" : event.peerRole)}
					</ThreadLink>
				</span>
				<span className="shrink-0">· {event.peerRole}</span>
				<span className="shrink-0">· {event.type}</span>
				<span className="ml-auto shrink-0 tabular-nums">
					{formatClock(event.ts)}
				</span>
			</p>
			<p
				className={cn(
					"text-body whitespace-pre-wrap text-text-1 [overflow-wrap:anywhere]",
					!open && "line-clamp-3",
				)}
			>
				{event.text}
			</p>
			{long && (
				<button
					type="button"
					onClick={() => setOpen((o) => !o)}
					aria-expanded={open}
					className="min-h-6 self-start text-meta text-accent hover:underline"
					data-testid="tree-message-expand"
				>
					{open ? "Show less" : "Show all"}
				</button>
			)}
		</div>
	);
}

const OUTCOME: Record<Ev<"child_finished">["outcome"], string> = {
	answered: "answered",
	failed: "failed",
	stopped: "was stopped",
	limited: "hit a usage limit",
};

/** A child's finish: its answer's excerpt and a link to read it whole. */
export function ChildFinishedCard({ event }: { event: Ev<"child_finished"> }) {
	const tree = useTreeOf(event.runId);
	const node = tree?.nodes.find((n) => n.id === event.childId);
	const tone =
		event.outcome === "answered"
			? "ok"
			: event.outcome === "failed"
				? "bad"
				: "muted";
	return (
		<div
			className="flex flex-col gap-1 rounded-surface bg-surface-1 px-3 py-2"
			data-testid="tree-finished"
			data-outcome={event.outcome}
		>
			<p className="flex min-w-0 items-center gap-2 text-body">
				<TickDot tone={tone} />
				<span className="min-w-0 truncate">
					<ThreadLink id={event.childId}>
						{node?.title ?? event.role}
					</ThreadLink>
				</span>
				<span className="shrink-0 text-meta text-text-3">{event.role}</span>
				<span className="shrink-0 text-meta text-text-2">
					{OUTCOME[event.outcome]}
				</span>
				<span className="ml-auto shrink-0 text-meta text-text-3 tabular-nums">
					{formatClock(event.ts)}
				</span>
			</p>
			{event.excerpt && (
				<p className="line-clamp-3 text-body text-text-2">{event.excerpt}</p>
			)}
			<Link
				to="/threads/$id"
				params={{ id: event.childId }}
				className="min-h-6 self-start text-meta text-accent hover:underline"
			>
				Read the answer
			</Link>
		</div>
	);
}

/** On a child: who started it, its role and depth, and the way back (#1101 cat 10). */
export function ParentBar({ threadId }: { threadId: string }) {
	const tree = useTreeOf(threadId);
	const self = tree?.nodes.find((n) => n.id === threadId);
	if (!tree || !self?.parentId) return null;
	const parent = tree.nodes.find((n) => n.id === self.parentId);
	const max = tree.limits?.depth;
	return (
		<li
			className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-surface bg-surface-1 px-3 py-2 text-meta text-text-2"
			data-testid="parent-bar"
		>
			<span className="min-w-0 truncate">
				Started by {parent?.title ?? `#${parent?.number ?? 1}`}
			</span>
			{self.role && <span className="text-text-3">· {self.role}</span>}
			<span className="text-text-3">
				· level {self.depth}
				{max ? ` of ${max}` : ""}
			</span>
			<Link
				to="/threads/$id"
				params={{ id: self.parentId }}
				className="ml-auto inline-flex min-h-6 items-center gap-1 text-accent hover:underline"
				data-testid="open-parent"
			>
				<CornerLeftUp aria-hidden className="size-3.5" />
				Open parent
			</Link>
		</li>
	);
}
