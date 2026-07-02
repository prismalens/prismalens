import type { CanonicalEvent } from "@prismalens/contracts";
import {
	Activity,
	AlertTriangle,
	Brain,
	CheckCircle,
	Lightbulb,
	Loader2,
	Wrench,
} from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	canonicalEventToRow,
	type EventRow as EventRowData,
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

	const rows = useMemo(
		() =>
			events
				.map(canonicalEventToRow)
				.filter((r): r is EventRowData => r !== null),
		[events],
	);

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
						{rows.length === 0 && status === "connecting" && (
							<p className="text-sm text-muted-foreground py-4 text-center">
								Connecting to stream...
							</p>
						)}
						{rows.map((row) => (
							<EventRow key={row.key} row={row} />
						))}
					</div>
				</ScrollArea>
			</CardContent>
		</Card>
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
