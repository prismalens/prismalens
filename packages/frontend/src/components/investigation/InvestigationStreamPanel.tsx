import { INVESTIGATION_AGENTS } from "@prismalens/config/agents";
import {
	Activity,
	AlertTriangle,
	Brain,
	CheckCircle,
	Lightbulb,
	Loader2,
} from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import type { StreamTuple } from "@/lib/api/hooks/use-investigation-stream";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

interface InvestigationStreamPanelProps {
	tuples: StreamTuple[];
	currentNode: string | null;
	latestMessage: string | null;
	status: "idle" | "connecting" | "streaming" | "completed" | "error";
}

const AGENT_COLORS: Record<string, string> = {
	scout: "bg-amber-500",
	gatherer: "bg-blue-500",
	analyst: "bg-purple-500",
	resolver: "bg-green-500",
	supervisor: "bg-slate-500",
};

const AGENT_ORDER = ["scout", "gatherer", "analyst", "resolver", "supervisor"];

/**
 * Real-time investigation progress panel.
 * Shows agent strip, latest message, and scrolling event log.
 */
export function InvestigationStreamPanel({
	tuples,
	currentNode,
	latestMessage,
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
	}, [tuples.length]);

	// Memoize visited nodes set for O(1) lookup per agent
	const visitedNodes = useMemo(() => {
		const visited = new Set<string>();
		for (const [mode, data] of tuples) {
			if (mode === "tasks") {
				const d = data as Record<string, unknown>;
				if (d.name) visited.add(d.name as string);
			}
		}
		return visited;
	}, [tuples]);

	// Memoize displayable events
	const displayEvents = useMemo(
		() =>
			tuples
				.map((tuple, i) => parseDisplayEvent(tuple, i))
				.filter(Boolean) as DisplayEvent[],
		[tuples],
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
						Investigation Progress
					</CardTitle>
					{latestMessage && (
						<span className="text-sm text-muted-foreground max-w-md truncate">
							{latestMessage}
						</span>
					)}
				</div>

				{/* Agent strip */}
				<div className="flex gap-2 mt-2">
					{AGENT_ORDER.map((agentId) => {
						const agent =
							INVESTIGATION_AGENTS[
								agentId as keyof typeof INVESTIGATION_AGENTS
							];
						if (!agent) return null;

						const isActive = currentNode === agentId;
						const wasVisited = visitedNodes.has(agentId);

						return (
							<Badge
								key={agentId}
								variant={isActive ? "default" : "outline"}
								className={`text-xs transition-all ${
									isActive
										? `${AGENT_COLORS[agentId]} text-white`
										: wasVisited
											? "opacity-100"
											: "opacity-40"
								}`}
							>
								{isActive && (
									<Loader2 className="h-3 w-3 mr-1 animate-spin" />
								)}
								{agent.name}
							</Badge>
						);
					})}
				</div>
			</CardHeader>

			<CardContent className="pt-0">
				<ScrollArea className="h-48" ref={scrollRef}>
					<div className="space-y-1 pr-4">
						{displayEvents.length === 0 && status === "connecting" && (
							<p className="text-sm text-muted-foreground py-4 text-center">
								Connecting to stream...
							</p>
						)}
						{displayEvents.map((event) => (
							<EventRow key={event.key} event={event} />
						))}
					</div>
				</ScrollArea>
			</CardContent>
		</Card>
	);
}

interface DisplayEvent {
	key: number;
	icon: "activity" | "brain" | "lightbulb" | "warning" | "check";
	agent?: string;
	message: string;
}

function parseDisplayEvent(
	tuple: StreamTuple,
	index: number,
): DisplayEvent | null {
	const [mode, data] = tuple;
	const d = data as Record<string, unknown>;

	if (mode === "tasks") {
		const name = d.name as string | undefined;
		if (!name) return null;

		// Task with result = node finished
		if (d.result) {
			const agent =
				INVESTIGATION_AGENTS[name as keyof typeof INVESTIGATION_AGENTS];
			return {
				key: index,
				icon: "check",
				agent: name,
				message: `${agent?.name ?? name} completed`,
			};
		}

		// Task without result = node starting
		const agent =
			INVESTIGATION_AGENTS[name as keyof typeof INVESTIGATION_AGENTS];
		return {
			key: index,
			icon: "activity",
			agent: name,
			message: `${agent?.name ?? name} started`,
		};
	}

	if (mode === "custom") {
		const type = d.type as string | undefined;

		if (type === "progress") {
			return {
				key: index,
				icon: "activity",
				agent: d.agent as string | undefined,
				message: d.message as string,
			};
		}

		if (type === "phase_change") {
			return {
				key: index,
				icon: "activity",
				message: `Phase: ${d.from} → ${d.to}`,
			};
		}

		if (type === "stalled") {
			return {
				key: index,
				icon: "warning",
				message: `Stalled: ${d.reason}`,
			};
		}

		if (type === "hypothesis_formed") {
			return {
				key: index,
				icon: "brain",
				message: `Hypothesis: ${d.hypothesis}`,
			};
		}

		if (type === "recommendation_added") {
			return {
				key: index,
				icon: "lightbulb",
				message: `Recommendation: ${d.title}`,
			};
		}

		if (type === "error") {
			return {
				key: index,
				icon: "warning",
				message: `Error: ${d.message}`,
			};
		}
	}

	// Skip "updates" mode — too verbose for display
	return null;
}

const ICON_MAP = {
	activity: <Activity className="h-3.5 w-3.5 text-blue-500 shrink-0" />,
	brain: <Brain className="h-3.5 w-3.5 text-purple-500 shrink-0" />,
	lightbulb: <Lightbulb className="h-3.5 w-3.5 text-green-500 shrink-0" />,
	warning: (
		<AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
	),
	check: <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />,
};

function EventRow({ event }: { event: DisplayEvent }) {
	return (
		<div className="flex items-start gap-2 py-1 text-sm">
			{ICON_MAP[event.icon]}
			<span className="text-muted-foreground">{event.message}</span>
		</div>
	);
}
