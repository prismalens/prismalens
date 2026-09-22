// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	IncidentWithRelations,
	TimelineEntryWithRelations,
} from "@prismalens/contracts";
import { Activity, Bell, Clock, Gauge } from "lucide-react";
import type { ReactNode } from "react";
import type { InvestigationRun } from "@/components/investigation/useInvestigationRun";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { CorrelatedAlerts } from "./CorrelatedAlerts";
import {
	DetailsBlock,
	RunBlock,
	SimilarBlock,
	TelemetryBlock,
} from "./IncidentRail";
import { TimelineTab } from "./TimelineTab";

export type Surface = "run" | "alerts" | "timeline" | "telemetry";

export const SURFACES: {
	id: Surface;
	key: string;
	label: string;
	icon: ReactNode;
}[] = [
	{ id: "run", key: "r", label: "Run", icon: <Activity className="h-4 w-4" /> },
	{
		id: "alerts",
		key: "a",
		label: "Alerts",
		icon: <Bell className="h-4 w-4" />,
	},
	{
		id: "timeline",
		key: "t",
		label: "Timeline",
		icon: <Clock className="h-4 w-4" />,
	},
	{
		id: "telemetry",
		key: "m",
		label: "Telemetry",
		icon: <Gauge className="h-4 w-4" />,
	},
];

/**
 * The strip of surfaces at the record's right edge. One opens at a time; its
 * key toggles it. Counts ride on the icons so the closed surface still says
 * what it holds.
 */
export function SurfaceRail({
	active,
	counts,
	onPick,
}: {
	active: Surface | null;
	counts: Partial<Record<Surface, number>>;
	onPick: (s: Surface) => void;
}) {
	return (
		<TooltipProvider delayDuration={200}>
			<div
				className="flex w-10 flex-col items-center gap-1 border-l py-2"
				data-testid="surface-rail"
			>
				{SURFACES.map((s) => {
					const on = active === s.id;
					const count = counts[s.id];
					return (
						<Tooltip key={s.id}>
							<TooltipTrigger asChild>
								<button
									type="button"
									aria-pressed={on}
									aria-label={s.label}
									onClick={() => onPick(s.id)}
									data-testid={`surface-${s.id}`}
									className={cn(
										"relative flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground",
										on &&
											"bg-muted text-foreground shadow-[inset_-2px_0_0_var(--primary)]",
									)}
								>
									{s.icon}
									{count !== undefined && count > 0 && (
										<span className="absolute -right-0.5 -top-0.5 rounded bg-background px-0.5 text-[10px] leading-none text-muted-foreground tabular-nums">
											{count}
										</span>
									)}
								</button>
							</TooltipTrigger>
							<TooltipContent side="left" className="flex items-center gap-2">
								{s.label}
								<kbd className="rounded border bg-muted px-1 font-mono text-[10px]">
									{s.key}
								</kbd>
							</TooltipContent>
						</Tooltip>
					);
				})}
			</div>
		</TooltipProvider>
	);
}

/** The open surface's content, scrolling inside its own pane. */
export function SurfacePane({
	surface,
	incident,
	run,
	timeline,
	timelineLoading,
}: {
	surface: Surface;
	incident: IncidentWithRelations;
	run: InvestigationRun | null;
	timeline: TimelineEntryWithRelations[];
	timelineLoading: boolean;
}) {
	const title = SURFACES.find((s) => s.id === surface)?.label ?? "";
	return (
		<div
			className="flex min-h-0 flex-col border-l"
			data-testid={`surface-pane-${surface}`}
		>
			<h2 className="border-b px-3 py-2 text-record font-medium">{title}</h2>
			<div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
				{surface === "run" && (
					<>
						<RunBlock run={run} />
						<SimilarBlock run={run} />
						<DetailsBlock incident={incident} />
					</>
				)}
				{surface === "alerts" && (
					<CorrelatedAlerts alerts={incident.alerts ?? []} />
				)}
				{surface === "timeline" && (
					<TimelineTab
						incidentId={incident.id}
						entries={timeline}
						isLoading={timelineLoading}
					/>
				)}
				{surface === "telemetry" && <TelemetryBlock incident={incident} />}
			</div>
		</div>
	);
}
