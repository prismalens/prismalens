// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	SubagentState,
	SubagentSummary,
	ThreadLink,
} from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { type ReactNode, useState } from "react";
import { AgentMark } from "@/components/agent/AgentMark";
import { linkStates } from "@/components/investigation/transcript/link-states";
import { type StartedHow, StartedHowMark } from "@/components/kit/MarkBadges";
import { Status, type StatusKind } from "@/components/kit/Status";
import { Hint } from "@/components/shared/Hint";
import { useSecondClock } from "@/hooks/use-clock";
import { formatElapsed } from "@/lib/format-time";
import { cn } from "@/lib/utils";

const ROW =
	"flex h-7 w-full min-w-0 items-center gap-2 rounded-control px-2 text-left text-body outline-none hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-accent";

const SUBAGENT_STATUS: Record<SubagentState, StatusKind> = {
	running: "working",
	completed: "done",
	failed: "failed",
	cancelled: "interrupted",
};

type Band = "failed" | "running" | "other" | "finished";

/** One row of the Started section: a thread started from here, or a sub-agent its agent ran. */
export interface StartedItem {
	key: string;
	kind: "thread" | "subagent";
	title: string;
	status: StatusKind;
	band: Band;
	how: StartedHow;
	harness: string | null;
	startedAt: string | null;
	endedAt: string | null;
	unread: number;
	/** A thread's id, or a sub-agent's session id. */
	id: string;
}

function threadItem(l: ThreadLink): StartedItem {
	const status = l.status ?? linkStates.get(l.state).status;
	return {
		key: `t:${l.id}`,
		kind: "thread",
		title: l.title ?? "Thread",
		status,
		band:
			l.state === "failed"
				? "failed"
				: l.state === "running"
					? "running"
					: l.state === "queued"
						? "other"
						: "finished",
		how: l.via ?? "agent",
		harness: l.harness ?? null,
		startedAt: l.startedAt ?? null,
		endedAt: l.endedAt ?? null,
		unread: l.unread,
		id: l.id,
	};
}

function subagentItem(s: SubagentSummary, harness: string | null): StartedItem {
	return {
		key: `s:${s.sessionId}`,
		kind: "subagent",
		title: s.title,
		status: SUBAGENT_STATUS[s.state],
		band:
			s.state === "failed"
				? "failed"
				: s.state === "running"
					? "running"
					: "finished",
		how: "subagent",
		harness,
		startedAt: s.startedAt,
		endedAt: s.endedAt,
		unread: 0,
		id: s.sessionId,
	};
}

const BAND_ORDER: Record<Band, number> = {
	failed: 0,
	running: 1,
	other: 2,
	finished: 3,
};

/** Sub-agents and started threads in one list: failed, then running, then the rest, each oldest first. */
export function startedItems(
	started: readonly ThreadLink[],
	subagents: readonly SubagentSummary[],
	harness: string | null,
): StartedItem[] {
	return [
		...started.map(threadItem),
		...subagents.map((s) => subagentItem(s, harness)),
	]
		.map((item, i) => ({ item, i }))
		.sort(
			(a, b) =>
				BAND_ORDER[a.item.band] - BAND_ORDER[b.item.band] ||
				(a.item.startedAt ?? "").localeCompare(b.item.startedAt ?? "") ||
				a.i - b.i,
		)
		.map(({ item }) => item);
}

/** Running: elapsed on the shared clock; ended: its duration; else nothing. */
function RowTime({ item }: { item: StartedItem }) {
	if (!item.startedAt) return null;
	if (item.band === "running") return <Elapsed from={item.startedAt} />;
	if (!item.endedAt) return null;
	const s = (Date.parse(item.endedAt) - Date.parse(item.startedAt)) / 1000;
	return Number.isFinite(s) ? <TimeText>{formatElapsed(s)}</TimeText> : null;
}

function Elapsed({ from }: { from: string }) {
	const now = useSecondClock();
	if (now === null) return null;
	return <TimeText>{formatElapsed((now - Date.parse(from)) / 1000)}</TimeText>;
}

const TimeText = ({ children }: { children: ReactNode }) => (
	<span className="shrink-0 text-meta text-text-3 tabular-nums">
		{children}
	</span>
);

/** One started thread or sub-agent: agent, status, how it started, title, time. */
export function StartedRow({
	item,
	onOpenSubagent,
}: {
	item: StartedItem;
	onOpenSubagent?: (sessionId: string) => void;
}) {
	const body = (
		<>
			<span className="flex shrink-0 items-center gap-1">
				{item.harness && <AgentMark id={item.harness} className="size-3.5" />}
				<Status kind={item.status} showWord={false} fact={null} />
				<StartedHowMark how={item.how} />
			</span>
			<Hint label={item.title}>
				<span
					className={cn(
						"min-w-0 flex-1 truncate",
						item.band === "failed" ? "text-danger" : "text-text-1",
					)}
					data-testid="started-row-title"
				>
					{item.title}
				</span>
			</Hint>
			{item.unread > 0 && (
				<span className="shrink-0 text-meta text-text-3 tabular-nums">
					<span aria-hidden>{item.unread}</span>
					<span className="sr-only">{item.unread} unread</span>
				</span>
			)}
			<RowTime item={item} />
		</>
	);
	const data = {
		"data-testid": "started-row",
		"data-kind": item.kind,
		"data-state": item.band,
		"data-how": item.how,
		"data-id": item.id,
	};
	if (item.kind === "thread")
		return (
			<Link
				to="/threads/$id"
				params={{ id: item.id }}
				className={ROW}
				{...data}
			>
				{body}
			</Link>
		);
	return (
		<button
			type="button"
			className={ROW}
			onClick={() => onOpenSubagent?.(item.id)}
			disabled={!onOpenSubagent}
			{...data}
		>
			{body}
		</button>
	);
}

/**
 * The Started list (#1176 D16): sub-agents and started threads from stored state, failed
 * first, finished ones folded under "Finished {n}".
 */
export function DetailsStarted({
	started,
	subagents = [],
	harness = null,
	onOpenSubagent,
}: {
	started: readonly ThreadLink[];
	subagents?: readonly SubagentSummary[];
	/** The thread's own agent, which ran its sub-agents. */
	harness?: string | null;
	onOpenSubagent?: (sessionId: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const items = startedItems(started, subagents, harness);
	const shown = items.filter((i) => i.band !== "finished");
	const finished = items.filter((i) => i.band === "finished");
	return (
		<div className="flex flex-col" data-testid="started-list">
			{shown.map((item) => (
				<StartedRow
					key={item.key}
					item={item}
					{...(onOpenSubagent ? { onOpenSubagent } : {})}
				/>
			))}
			{finished.length > 0 && (
				<button
					type="button"
					className={cn(ROW, "text-meta text-text-2")}
					aria-expanded={open}
					onClick={() => setOpen((o) => !o)}
					data-testid="started-finished-toggle"
				>
					<ChevronRight
						aria-hidden
						className={cn(
							"size-3.5 shrink-0 transition-transform motion-reduce:transition-none",
							open && "rotate-90",
						)}
					/>
					<span className="flex-1">Finished {finished.length}</span>
				</button>
			)}
			{open &&
				finished.map((item) => (
					<StartedRow
						key={item.key}
						item={item}
						{...(onOpenSubagent ? { onOpenSubagent } : {})}
					/>
				))}
		</div>
	);
}
