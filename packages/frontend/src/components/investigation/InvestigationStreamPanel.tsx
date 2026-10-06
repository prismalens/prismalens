// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import {
	Activity,
	AlertTriangle,
	Brain,
	CheckCircle,
	GitBranch,
	Lightbulb,
	Wrench,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Mono } from "@/components/shared/Mono";
import { StateWord } from "@/components/shared/StateWord";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	deriveStreamView,
	type EventRow as EventRowData,
} from "@/lib/investigation-events";
import { INITIAL_TAIL_FOLLOW, nextTailFollow } from "@/lib/stream-autoscroll";

interface InvestigationStreamPanelProps {
	events: CanonicalEvent[];
	latestText: string | null;
	status: "idle" | "connecting" | "streaming" | "completed" | "failed";
	/** After a run ends the ledger folds to its one-line chain; the rows are one click away. */
	collapsible?: boolean;
}

/** The run as one line: every tool the agent called, in order, then the report. */
export function ledgerChain(events: CanonicalEvent[]): string[] {
	const chain: string[] = [];
	for (const event of events) {
		if (event.kind === "agent_step") {
			for (const call of event.toolCalls) chain.push(call.name);
		} else if (event.kind === "report") {
			chain.push("report");
		}
	}
	return chain;
}

function runDuration(events: CanonicalEvent[]): string | null {
	const first = events[0];
	const last = events[events.length - 1];
	if (!first || !last || !("ts" in first) || !("ts" in last)) return null;
	const ms = new Date(last.ts).getTime() - new Date(first.ts).getTime();
	if (!Number.isFinite(ms) || ms < 0) return null;
	const s = Math.round(ms / 1000);
	return s < 60
		? `${s}s`
		: `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}

/**
 * Real-time investigation progress panel (ADR-0008 canonical stream).
 * Renders the harness-agnostic event stream via the shared view-model — no
 * LangGraph node strip (the two-tier engine runs a single branch, not a node graph).
 */
export function InvestigationStreamPanel({
	events,
	latestText,
	status,
	collapsible = false,
}: InvestigationStreamPanelProps) {
	const [expanded, setExpanded] = useState(false);
	const scrollRef = useRef<HTMLDivElement>(null);
	// Sampled while the reader scrolls, not after new rows land: at append time
	// the viewport's own growth is indistinguishable from a scroll-up (#280).
	const tailRef = useRef(INITIAL_TAIL_FOLLOW);

	useEffect(() => {
		const viewport = scrollRef.current?.querySelector<HTMLElement>(
			"[data-radix-scroll-area-viewport]",
		);
		if (!viewport) return;

		const onScroll = () => {
			tailRef.current = nextTailFollow(tailRef.current, viewport);
		};
		viewport.addEventListener("scroll", onScroll, { passive: true });
		return () => viewport.removeEventListener("scroll", onScroll);
	}, []);

	// Auto-scroll to bottom on new events (target the Radix viewport)
	useEffect(() => {
		if (events.length === 0 || !tailRef.current.following) return;
		const viewport = scrollRef.current?.querySelector<HTMLElement>(
			"[data-radix-scroll-area-viewport]",
		);
		if (viewport) {
			viewport.scrollTop = viewport.scrollHeight;
		}
	}, [events]);

	// Group by branchId (ADR-0016 fan-out seam). A run that did not fan out —
	// including the first branch of one that is about to — renders as the single
	// flat list it was before the grouping was added.
	const { isMultiBranch, branches, reportRows, flatRows } = useMemo(
		() => deriveStreamView(events),
		[events],
	);

	const chain = useMemo(() => ledgerChain(events), [events]);
	const duration = useMemo(() => runDuration(events), [events]);
	const folded = collapsible && !expanded;

	return (
		<div
			data-testid="investigation-stream-panel"
			data-folded={folded ? "true" : undefined}
			className="pool"
		>
			<div className="flex min-h-9 items-center justify-between gap-3 px-3 py-1.5">
				<div className="flex min-w-0 items-center gap-2">
					{status === "streaming" && (
						<StateWord tone="live" pulse>
							streaming
						</StateWord>
					)}
					{status === "connecting" && (
						<StateWord tone="neutral">connecting</StateWord>
					)}
					{status === "completed" && <StateWord tone="ok">completed</StateWord>}
					{status === "failed" && <StateWord tone="danger">failed</StateWord>}
					{isMultiBranch && (
						<StateWord tone="neutral" mono data-testid="stream-branch-badge">
							<GitBranch className="h-3 w-3" />
							{branches.length} branches
						</StateWord>
					)}
					{latestText && (
						<span className="truncate text-meta text-text-2">{latestText}</span>
					)}
					{folded && chain.length > 0 && (
						<span className="flex min-w-0 gap-2.5 text-meta text-text-2">
							<Mono className="truncate">{chain.join(", ")}</Mono>
							{duration && <span className="shrink-0">{duration}</span>}
						</span>
					)}
				</div>
				{collapsible && (
					<Button
						variant="text"
						size="sm"
						className="shrink-0"
						onClick={() => setExpanded((v) => !v)}
						data-testid="ledger-toggle"
					>
						{expanded ? "Fold" : `${events.length} events`}
					</Button>
				)}
			</div>

			{!folded && (
				<ScrollArea
					className={events.length > 8 ? "h-80" : undefined}
					ref={scrollRef}
				>
					<div className="space-y-0.5 px-3 py-2 pr-4">
						{!isMultiBranch &&
							flatRows.length === 0 &&
							status === "connecting" && (
								<p
									data-testid="stream-panel-connecting"
									className="py-4 text-center text-body text-text-2"
								>
									Connecting to stream...
								</p>
							)}
						{!isMultiBranch &&
							flatRows.map((row) => <EventRow key={row.key} row={row} />)}
						{isMultiBranch &&
							[...branches.flatMap((b) => b.rows), ...reportRows].map((row) => (
								<EventRow key={row.key} row={row} />
							))}
					</div>
				</ScrollArea>
			)}
		</div>
	);
}

const ICON_MAP: Record<EventRowData["icon"], React.ReactNode> = {
	activity: <Activity className="h-3.5 w-3.5 text-live shrink-0" />,
	brain: <Brain className="h-3.5 w-3.5 text-accent shrink-0" />,
	tool: <Wrench className="h-3.5 w-3.5 text-sev-low shrink-0" />,
	lightbulb: <Lightbulb className="h-3.5 w-3.5 text-ok shrink-0" />,
	warning: <AlertTriangle className="h-3.5 w-3.5 text-warn shrink-0" />,
	check: <CheckCircle className="h-3.5 w-3.5 text-ok shrink-0" />,
};

function EventRow({ row }: { row: EventRowData }) {
	return (
		<div
			data-testid="stream-event-row"
			className="flex items-start gap-2 py-1 text-body"
		>
			<span className="mt-0.5">{ICON_MAP[row.icon]}</span>
			<div className="min-w-0">
				<span
					className={
						row.icon === "tool" ? "font-mono text-text-1" : "text-text-1"
					}
				>
					{row.message}
				</span>
				{row.detail && (
					<p className="truncate text-meta text-text-2">{row.detail}</p>
				)}
			</div>
		</div>
	);
}
