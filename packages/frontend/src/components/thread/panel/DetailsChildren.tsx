// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadNodeState, ThreadTreeNode } from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, History } from "lucide-react";
import { useState } from "react";
import { AgentMark } from "@/components/agent/AgentMark";
import { markLook } from "@/components/kit/marks";
import { Status, type StatusKind } from "@/components/kit/Status";
import { useNow } from "@/hooks/use-now";
import { elapsedWord } from "@/lib/thread-status";
import { cn } from "@/lib/utils";

type Child = Pick<
	ThreadTreeNode,
	"id" | "number" | "title" | "state" | "harness" | "startedAt"
>;

const KIND: Record<ThreadNodeState, StatusKind> = {
	queued: "waiting",
	running: "working",
	answered: "done",
	failed: "failed",
	stopped: "done",
};

/** Failed first, then live; finished children fold into one "previous" row. */
export function splitChildren<C extends Pick<Child, "state">>(
	nodes: readonly C[],
) {
	const failed = nodes.filter((n) => n.state === "failed");
	const live = nodes.filter(
		(n) => n.state === "running" || n.state === "queued",
	);
	const done = nodes.filter(
		(n) => n.state === "answered" || n.state === "stopped",
	);
	return { shown: [...failed, ...live], done };
}

/** Lines the block takes folded: the heading, the shown rows and the previous row. */
export function childrenSpan(nodes: readonly Pick<Child, "state">[]) {
	const { shown, done } = splitChildren(nodes);
	return 1 + shown.length + (done.length ? 1 : 0);
}

const ROW =
	"flex h-7 min-w-0 items-center gap-2 rounded-control px-2 text-body outline-none hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-accent";

function ChildRow({ c, now }: { c: Child; now: number | null }) {
	const kind = KIND[c.state];
	const since = c.startedAt ? Date.parse(c.startedAt) : Number.NaN;
	const time =
		kind === "working" && now !== null && !Number.isNaN(since)
			? elapsedWord(now - since)
			: null;
	return (
		<Link
			to="/threads/$id"
			params={{ id: c.id }}
			className={ROW}
			data-testid="details-child"
			data-state={c.state}
		>
			<span className="flex shrink-0 items-center gap-1">
				{c.harness && <AgentMark id={c.harness} className="size-3.5" />}
				<Status kind={kind} showWord={false} />
			</span>
			<span
				className={cn(
					"min-w-0 flex-1 truncate",
					kind === "failed" ? "text-danger" : "text-text-1",
				)}
			>
				{c.title ?? `#${c.number}`}
			</span>
			{time && (
				<span
					className="shrink-0 text-meta text-text-3 tabular-nums"
					data-testid="details-child-time"
				>
					{time}
				</span>
			)}
		</Link>
	);
}

/** The details card's children (sheet §3): live rows, failures on top, the rest folded. */
export function DetailsChildren({
	nodes,
	onOpen,
}: {
	nodes: readonly Child[];
	onOpen?: () => void;
}) {
	const now = useNow(10_000);
	const [open, setOpen] = useState(false);
	const { shown, done } = splitChildren(nodes);
	const running = nodes.filter((n) => n.state === "running").length;
	const failed = nodes.filter((n) => n.state === "failed").length;
	const head = markLook("children");
	const heading = (
		<>
			<head.icon
				aria-hidden
				className={cn("size-3.5 shrink-0", head.className)}
			/>
			<span className="min-w-0 flex-1 truncate text-text-1">Children</span>
			{running > 0 && (
				<span className="flex items-center gap-1 text-meta text-text-2 tabular-nums">
					<Status kind="working" showWord={false} />
					<span aria-hidden>{running}</span>
					<span className="sr-only">running</span>
				</span>
			)}
			{failed > 0 && (
				<span className="flex items-center gap-1 text-meta text-text-2 tabular-nums">
					<Status kind="failed" showWord={false} />
					<span aria-hidden>{failed}</span>
					<span className="sr-only">failed</span>
				</span>
			)}
		</>
	);
	return (
		<div className="flex flex-col" data-testid="details-children">
			{onOpen ? (
				<button
					type="button"
					className={cn(ROW, "w-full text-left")}
					onClick={onOpen}
					data-testid="details-children-heading"
				>
					{heading}
				</button>
			) : (
				<div className={ROW} data-testid="details-children-heading">
					{heading}
				</div>
			)}
			{shown.map((c) => (
				<ChildRow key={c.id} c={c} now={now} />
			))}
			{done.length > 0 && (
				<button
					type="button"
					aria-expanded={open}
					className={cn(ROW, "w-full text-left")}
					onClick={() => setOpen((o) => !o)}
					data-testid="details-children-previous"
				>
					<History aria-hidden className="size-3.5 shrink-0 text-text-3" />
					<span className="min-w-0 flex-1 truncate text-text-2">
						Previous {done.length}
					</span>
					{open ? (
						<ChevronDown
							aria-hidden
							className="size-3.5 shrink-0 text-text-3"
						/>
					) : (
						<ChevronRight
							aria-hidden
							className="size-3.5 shrink-0 text-text-3"
						/>
					)}
				</button>
			)}
			{open && done.map((c) => <ChildRow key={c.id} c={c} now={now} />)}
		</div>
	);
}
