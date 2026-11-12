// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A thread tree as the parent's transcript shows it (#1101 cat 10): a live row per child,
 * a labelled card per message, and a finish card with the answer, all without leaving.
 */
import type { CanonicalEvent, ThreadTreeNode } from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import {
	ArrowDownLeft,
	ArrowUpRight,
	CornerDownLeft,
	CornerLeftUp,
	GitFork,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Status, type StatusKind } from "@/components/kit/Status";
import { TOOL_LINE } from "@/components/kit/ToolLine";
import { useThreadTree } from "@/lib/api/hooks/use-thread-tree-orpc";
import { formatClock } from "@/lib/format-time";
import { cn } from "@/lib/utils";

type Ev<K extends CanonicalEvent["kind"]> = Extract<
	CanonicalEvent,
	{ kind: K }
>;

/** A child's state in the closed set (sheet §9.1): stopped and answered both read Done. */
const NODE_STATUS: Record<ThreadTreeNode["state"], StatusKind> = {
	queued: "waiting",
	running: "working",
	answered: "done",
	failed: "failed",
	stopped: "done",
};

const LINK =
	"text-text-1 underline decoration-hairline underline-offset-[3px] hover:decoration-current";

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

/** A child as one flat line (sheet §2): mark, verb, title, role, status, unread. */
export function ChildRow({
	node,
	fallbackTitle,
	threadRole,
	verb,
}: {
	node: ThreadTreeNode | undefined;
	fallbackTitle: string;
	threadRole: string;
	verb?: string;
}) {
	return (
		<div className="flex min-w-0 flex-col">
			<p className={cn(TOOL_LINE, "hover:text-text-2")}>
				<GitFork
					aria-hidden
					className="size-3.5 shrink-0 stroke-[1.75] text-text-3"
				/>
				{verb && <span className="shrink-0">{verb}</span>}
				<span className="min-w-0 truncate">
					{node ? (
						<ThreadLink id={node.id}>{node.title ?? fallbackTitle}</ThreadLink>
					) : (
						fallbackTitle
					)}
				</span>
				<span className="shrink-0 text-text-3">{threadRole}</span>
				<span className="flex-1" />
				{node && node.unread > 0 && (
					<span
						className="shrink-0 text-meta text-text-3 tabular-nums"
						data-testid="child-unread"
					>
						{node.unread} unread
					</span>
				)}
				<span className="shrink-0 text-meta" data-testid="child-state">
					<Status kind={node ? NODE_STATUS[node.state] : "waiting"} />
				</span>
			</p>
			{node?.state === "running" && node.lastStep && (
				<p
					className="truncate pl-[22px] font-mono text-meta text-text-3"
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
		<div data-testid="tree-started">
			<ChildRow
				node={node}
				fallbackTitle={event.title}
				threadRole={event.role}
				verb="Started"
			/>
		</div>
	);
}

/** The one card between threads: a labelled head, a clamped body, a quiet disclosure. */
function ThreadCard({
	head,
	body,
	more,
	testId,
	data,
}: {
	head: ReactNode;
	body: string;
	more?: ReactNode;
	testId: string;
	data: Record<string, string>;
}) {
	const [open, setOpen] = useState(false);
	const long = body.length > CLAMP_CHARS || body.includes("\n");
	return (
		<div
			className="flex min-w-0 flex-col gap-1 rounded-surface bg-surface-1 px-3 py-2"
			data-testid={testId}
			{...data}
		>
			<p className="flex min-w-0 items-center gap-1.5 text-meta text-text-3">
				{head}
			</p>
			{body && (
				<p
					className={cn(
						"text-body whitespace-pre-wrap text-text-1 [overflow-wrap:anywhere]",
						!open && "line-clamp-3",
					)}
				>
					{body}
				</p>
			)}
			{(long || more) && (
				<div className="flex items-center gap-3 text-meta">
					{long && (
						<button
							type="button"
							onClick={() => setOpen((o) => !o)}
							aria-expanded={open}
							className="min-h-6 text-text-2 hover:text-text-1"
							data-testid="tree-message-expand"
						>
							{open ? "Show less" : "Show all"}
						</button>
					)}
					{more}
				</div>
			)}
		</div>
	);
}

const CLAMP_CHARS = 280;

/** A message between threads: who sent it, its role and time, sent and received told apart. */
export function ThreadMessageCard({ event }: { event: Ev<"thread_message"> }) {
	const tree = useTreeOf(event.runId);
	// A delivery parsed from `[FROM role #n]` names its sender by tree number only.
	const number = /^#(\d+)$/.exec(event.peerId)?.[1];
	const peer = number
		? tree?.nodes.find((n) => n.number === Number(number))
		: tree?.nodes.find((n) => n.id === idOf(event.peerLink, event.peerId));
	const peerId =
		peer?.id ?? (number ? null : idOf(event.peerLink, event.peerId));
	const peerName =
		peer?.title ??
		(event.peerRole === "root" ? "the root thread" : event.peerRole);
	const sent = event.direction === "sent";
	const Icon = sent ? ArrowUpRight : ArrowDownLeft;
	return (
		<ThreadCard
			testId="tree-message"
			data={{ "data-direction": event.direction }}
			body={event.text}
			head={
				<>
					<Icon aria-hidden className="size-3.5 shrink-0" />
					<span className="shrink-0">{sent ? "To" : "From"}</span>
					<span className="min-w-0 truncate">
						{peerId ? (
							<ThreadLink id={peerId}>{peerName}</ThreadLink>
						) : (
							peerName
						)}
					</span>
					{peerName !== event.peerRole && (
						<span className="shrink-0">· {event.peerRole}</span>
					)}
					<span className="shrink-0">· {event.type}</span>
					<span className="ml-auto shrink-0 tabular-nums">
						{formatClock(event.ts)}
					</span>
				</>
			}
		/>
	);
}

const OUTCOME: Record<Ev<"child_finished">["outcome"], StatusKind> = {
	answered: "done",
	failed: "failed",
	stopped: "done",
	limited: "limited",
};

/** A child's finish: its answer's excerpt, on the same card as a message. */
export function ChildFinishedCard({ event }: { event: Ev<"child_finished"> }) {
	const tree = useTreeOf(event.runId);
	const node = tree?.nodes.find((n) => n.id === event.childId);
	return (
		<ThreadCard
			testId="tree-finished"
			data={{ "data-outcome": event.outcome }}
			body={event.excerpt ?? ""}
			head={
				<>
					<CornerDownLeft aria-hidden className="size-3.5 shrink-0" />
					<span className="min-w-0 truncate">
						<ThreadLink id={event.childId}>
							{node?.title ?? event.role}
						</ThreadLink>
					</span>
					{node?.title && <span className="shrink-0">· {event.role}</span>}
					<Status kind={OUTCOME[event.outcome]} className="shrink-0" />
					<span className="ml-auto shrink-0 tabular-nums">
						{formatClock(event.ts)}
					</span>
				</>
			}
			more={
				<Link
					to="/threads/$id"
					params={{ id: event.childId }}
					className="min-h-6 text-text-2 hover:text-text-1"
				>
					Read the answer
				</Link>
			}
		/>
	);
}

/** On a child: who started it, its role and depth, as one quiet line (#1101 cat 10). */
export function ParentBar({ threadId }: { threadId: string }) {
	const tree = useTreeOf(threadId);
	const self = tree?.nodes.find((n) => n.id === threadId);
	if (!tree || !self?.parentId) return null;
	const parent = tree.nodes.find((n) => n.id === self.parentId);
	const max = tree.limits?.depth;
	return (
		<div
			className="flex min-h-7 min-w-0 items-center gap-1.5 pt-2 text-meta text-text-3"
			data-testid="parent-bar"
		>
			<CornerLeftUp aria-hidden className="size-3.5 shrink-0" />
			<span className="shrink-0">Started by</span>
			<span className="min-w-0 truncate">
				<Link
					to="/threads/$id"
					params={{ id: self.parentId }}
					className={LINK}
					data-testid="open-parent"
				>
					{parent?.title ?? `#${parent?.number ?? 1}`}
				</Link>
			</span>
			{self.role && <span className="shrink-0">· {self.role}</span>}
			<span className="shrink-0">
				· level {self.depth}
				{max ? ` of ${max}` : ""}
			</span>
		</div>
	);
}
