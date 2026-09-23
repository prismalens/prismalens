// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import {
	Activity,
	AlertTriangle,
	Brain,
	CheckCircle,
	ChevronDown,
	ChevronRight,
	GitBranch,
	Lightbulb,
	Loader2,
	Wrench,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Mono } from "@/components/shared/Mono";
import { StateChip } from "@/components/shared/StateChip";
import { Button } from "@/components/ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	type BranchGroup,
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
			className="rounded-md border"
		>
			<div className="flex min-h-9 items-center justify-between gap-3 border-b px-3 py-1.5">
				<div className="flex min-w-0 items-center gap-2">
					{status === "streaming" && (
						<StateChip tone="active" pulse>
							streaming
						</StateChip>
					)}
					{status === "connecting" && (
						<StateChip tone="neutral">connecting</StateChip>
					)}
					{status === "completed" && (
						<StateChip tone="done">completed</StateChip>
					)}
					{status === "failed" && <StateChip tone="failed">failed</StateChip>}
					{isMultiBranch && (
						<StateChip tone="neutral" mono data-testid="stream-branch-badge">
							<GitBranch className="h-3 w-3" />
							{branches.length} branches
						</StateChip>
					)}
					{latestText && (
						<span className="truncate text-meta text-muted-foreground">
							{latestText}
						</span>
					)}
					{folded && chain.length > 0 && (
						<Mono className="truncate text-meta text-muted-foreground">
							{chain.join(" → ")}
							{duration ? ` · ${duration}` : ""}
						</Mono>
					)}
				</div>
				{collapsible && (
					<Button
						variant="ghost"
						size="sm"
						className="h-6 shrink-0 px-2 text-meta"
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
									className="py-4 text-center text-record text-muted-foreground"
								>
									Connecting to stream...
								</p>
							)}
						{!isMultiBranch &&
							flatRows.map((row) => <EventRow key={row.key} row={row} />)}
						{isMultiBranch && (
							<div className="space-y-2">
								{branches.map((group) => (
									<BranchSection key={group.branchId} group={group} />
								))}
								{reportRows.map((row) => (
									<EventRow key={row.key} row={row} />
								))}
							</div>
						)}
					</div>
				</ScrollArea>
			)}
		</div>
	);
}

/**
 * One branch's collapsible section (ADR-0007 differentiator): a small header
 * (branch id + best-effort focus) over its own event rows. Only rendered when
 * >1 distinct branchId is present — the single-branch path never mounts this.
 */
function BranchSection({ group }: { group: BranchGroup }) {
	const [isOpen, setIsOpen] = useState(true);

	return (
		<Collapsible open={isOpen} onOpenChange={setIsOpen}>
			<div data-testid="stream-branch-section" className="rounded-md border">
				<CollapsibleTrigger asChild>
					<button
						type="button"
						className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-muted/50 transition-colors rounded-md"
					>
						{isOpen ? (
							<ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
						) : (
							<ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
						)}
						<GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
						<span className="text-xs font-medium truncate">
							{group.branchId}
							{group.focus && (
								<span className="font-normal text-muted-foreground">
									{" "}
									— {group.focus}
								</span>
							)}
						</span>
					</button>
				</CollapsibleTrigger>
				<CollapsibleContent>
					<div className="space-y-1 px-2 pb-2 pt-1">
						{group.rows.map((row) => (
							<EventRow key={row.key} row={row} />
						))}
					</div>
				</CollapsibleContent>
			</div>
		</Collapsible>
	);
}

const ICON_MAP: Record<EventRowData["icon"], React.ReactNode> = {
	activity: <Activity className="h-3.5 w-3.5 text-run-active shrink-0" />,
	brain: <Brain className="h-3.5 w-3.5 text-primary shrink-0" />,
	tool: <Wrench className="h-3.5 w-3.5 text-sev-low shrink-0" />,
	lightbulb: <Lightbulb className="h-3.5 w-3.5 text-run-done shrink-0" />,
	warning: <AlertTriangle className="h-3.5 w-3.5 text-stale shrink-0" />,
	check: <CheckCircle className="h-3.5 w-3.5 text-run-done shrink-0" />,
};

function EventRow({ row }: { row: EventRowData }) {
	return (
		<div
			data-testid="stream-event-row"
			className="flex items-start gap-2 py-1 text-record"
		>
			<span className="mt-0.5">{ICON_MAP[row.icon]}</span>
			<div className="min-w-0">
				<span
					className={
						row.icon === "tool"
							? "font-mono text-foreground"
							: "text-foreground"
					}
				>
					{row.message}
				</span>
				{row.detail && (
					<p className="truncate text-meta text-muted-foreground">
						{row.detail}
					</p>
				)}
			</div>
		</div>
	);
}
