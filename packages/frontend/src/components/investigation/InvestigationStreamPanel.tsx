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

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
}: InvestigationStreamPanelProps) {
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

	return (
		<Card data-testid="investigation-stream-panel">
			<CardHeader className="pb-3">
				<div className="flex items-center justify-between">
					<CardTitle className="text-base flex items-center gap-2">
						{status === "streaming" && (
							<Loader2 className="h-4 w-4 animate-spin text-blue-500" />
						)}
						{status === "completed" && (
							<CheckCircle className="h-4 w-4 text-green-500" />
						)}
						{status === "failed" && (
							<AlertTriangle className="h-4 w-4 text-red-500" />
						)}
						Investigation Progress
						{isMultiBranch && (
							<span
								data-testid="stream-branch-badge"
								className="text-xs font-normal px-2 py-0.5 rounded-full bg-muted text-muted-foreground flex items-center gap-1"
							>
								<GitBranch className="h-3 w-3" />
								{branches.length} branches
							</span>
						)}
					</CardTitle>
					{latestText && (
						<span className="text-sm text-muted-foreground max-w-md truncate">
							{latestText}
						</span>
					)}
				</div>
			</CardHeader>

			<CardContent className="pt-0">
				<ScrollArea className="h-48" ref={scrollRef}>
					<div className="space-y-1 pr-4">
						{!isMultiBranch &&
							flatRows.length === 0 &&
							status === "connecting" && (
								<p
									data-testid="stream-panel-connecting"
									className="text-sm text-muted-foreground py-4 text-center"
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
			</CardContent>
		</Card>
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
	activity: <Activity className="h-3.5 w-3.5 text-blue-500 shrink-0" />,
	brain: <Brain className="h-3.5 w-3.5 text-purple-500 shrink-0" />,
	tool: <Wrench className="h-3.5 w-3.5 text-blue-500 shrink-0" />,
	lightbulb: <Lightbulb className="h-3.5 w-3.5 text-green-500 shrink-0" />,
	warning: <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />,
	check: <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />,
};

function EventRow({ row }: { row: EventRowData }) {
	return (
		<div
			data-testid="stream-event-row"
			className="flex items-start gap-2 py-1 text-sm"
		>
			{ICON_MAP[row.icon]}
			<div className="min-w-0">
				<span className="text-foreground">{row.message}</span>
				{row.detail && (
					<p className="text-xs text-muted-foreground truncate">{row.detail}</p>
				)}
			</div>
		</div>
	);
}
