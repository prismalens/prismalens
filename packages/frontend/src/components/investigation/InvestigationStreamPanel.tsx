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
	type EventRow as EventRowData,
	groupEventsByBranch,
} from "@/lib/investigation-events";

interface InvestigationStreamPanelProps {
	events: CanonicalEvent[];
	latestText: string | null;
	status: "idle" | "connecting" | "streaming" | "completed" | "error";
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

	// Auto-scroll to bottom on new events (target the Radix viewport)
	useEffect(() => {
		const viewport = scrollRef.current?.querySelector(
			"[data-radix-scroll-area-viewport]",
		);
		if (viewport) {
			viewport.scrollTop = viewport.scrollHeight;
		}
	}, []);

	// Group by branchId (ADR-0016 fan-out seam — CanonicalEvent already carries
	// branchId/path). N=1 today collapses to a single "root" branch, so this is a
	// no-op shape until fan-out lands.
	const grouped = useMemo(() => groupEventsByBranch(events), [events]);
	const isMultiBranch = grouped.branches.length > 1;

	// Single-branch (today's default): flatten back to one list, report row
	// last, so the panel renders EXACTLY as before the grouping was added.
	const flatRows: EventRowData[] = isMultiBranch
		? []
		: [...(grouped.branches[0]?.rows ?? []), ...grouped.reportRows];

	return (
		<Card>
			<CardHeader className="pb-3">
				<div className="flex items-center justify-between">
					<CardTitle className="text-base flex items-center gap-2">
						{status === "streaming" && (
							<Loader2 className="h-4 w-4 animate-spin text-blue-500" />
						)}
						{status === "completed" && (
							<CheckCircle className="h-4 w-4 text-green-500" />
						)}
						{status === "error" && (
							<AlertTriangle className="h-4 w-4 text-amber-500" />
						)}
						Investigation Progress
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
								<p className="text-sm text-muted-foreground py-4 text-center">
									Connecting to stream...
								</p>
							)}
						{!isMultiBranch &&
							flatRows.map((row) => <EventRow key={row.key} row={row} />)}
						{isMultiBranch && (
							<div className="space-y-2">
								{grouped.branches.map((group) => (
									<BranchSection key={group.branchId} group={group} />
								))}
								{grouped.reportRows.map((row) => (
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
			<div className="rounded-md border">
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
		<div className="flex items-start gap-2 py-1 text-sm">
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
