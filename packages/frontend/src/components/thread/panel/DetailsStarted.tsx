// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadLink } from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { ListFilter } from "lucide-react";
import { AgentMark } from "@/components/agent/AgentMark";
import { LINK_STATUS } from "@/components/investigation/transcript/ThreadCards";
import { markLook } from "@/components/kit/marks";
import { Status } from "@/components/kit/Status";
import { Hint } from "@/components/shared/Hint";
import { cn } from "@/lib/utils";

/** Rows the card lists before "N more", which opens the panel's full list. */
export const STARTED_SHOWN = 5;

/** Lines the block takes: the heading, the rows shown and a "more" row. */
export function startedSpan(n: number) {
	return 1 + Math.min(n, STARTED_SHOWN) + (n > STARTED_SHOWN ? 1 : 0);
}

const ROW =
	"flex h-7 min-w-0 items-center gap-2 rounded-control px-2 text-body outline-none hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-accent";

/** One started thread: its agent, its status mark, its title as a link, unread as a count. */
export function StartedRow({ l }: { l: ThreadLink }) {
	const kind = l.status ?? LINK_STATUS[l.state];
	return (
		<Link
			to="/threads/$id"
			params={{ id: l.id }}
			className={ROW}
			data-testid="details-started-row"
			data-state={l.state}
		>
			<span className="flex shrink-0 items-center gap-1">
				{l.harness && <AgentMark id={l.harness} className="size-3.5" />}
				<Status kind={kind} showWord={false} />
			</span>
			<span
				className={cn(
					"min-w-0 flex-1 truncate",
					kind === "failed" ? "text-danger" : "text-text-1",
				)}
				data-testid="details-started-title"
			>
				{l.title ?? "Thread"}
			</span>
			{l.unread > 0 && (
				<span className="shrink-0 text-meta text-text-3 tabular-nums">
					<span aria-hidden>{l.unread}</span>
					<span className="sr-only">{l.unread} unread</span>
				</span>
			)}
		</Link>
	);
}

/**
 * The details card's "Threads it started" (sheet §3, #1101 cat 10): a static list in
 * start order, each with its status mark; the filter keeps the sidebar to them.
 */
export function DetailsStarted({
	started,
	onFilter,
	onMore,
}: {
	started: readonly ThreadLink[];
	onFilter?: () => void;
	onMore?: () => void;
}) {
	const head = markLook("startedBy");
	const more = started.length - STARTED_SHOWN;
	return (
		<div className="flex flex-col" data-testid="details-started">
			<div className={ROW} data-testid="details-started-heading">
				<head.icon
					aria-hidden
					className={cn("size-3.5 shrink-0", head.className)}
				/>
				<span className="min-w-0 flex-1 truncate text-text-2">
					Threads it started
				</span>
				<span className="text-meta text-text-3 tabular-nums">
					{started.length}
				</span>
				{onFilter && (
					<Hint label="Show only these in the list">
						<button
							type="button"
							aria-label="Show only these in the list"
							onClick={onFilter}
							className="flex size-5 shrink-0 items-center justify-center rounded-control text-text-3 hover:bg-surface-3 hover:text-text-1"
							data-testid="details-started-filter"
						>
							<ListFilter aria-hidden className="size-3.5" />
						</button>
					</Hint>
				)}
			</div>
			{started.slice(0, STARTED_SHOWN).map((l) => (
				<StartedRow key={l.id} l={l} />
			))}
			{more > 0 && (
				<button
					type="button"
					className={cn(ROW, "w-full text-left text-meta text-text-2")}
					onClick={onMore}
					data-testid="details-started-more"
				>
					{more} more
				</button>
			)}
		</div>
	);
}
