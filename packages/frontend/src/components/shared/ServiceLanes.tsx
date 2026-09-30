// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ChevronRight } from "lucide-react";
import { type GroupView, useLayoutPrefs } from "@/hooks/use-layout-prefs";
import { cn } from "@/lib/utils";
import { Mono } from "./Mono";

/** Group the alerts pane by service or not; remembered (#743). */
export function GroupBySelect({ className }: { className?: string }) {
	const { alertsGroupBy, setAlertsGroupBy } = useLayoutPrefs();
	return (
		<select
			value={alertsGroupBy}
			onChange={(e) =>
				setAlertsGroupBy(e.target.value === "service" ? "service" : "none")
			}
			aria-label="Group by"
			className={cn(
				"h-6 rounded border bg-background px-1 text-meta text-muted-foreground outline-none",
				className,
			)}
			data-testid="group-by-alerts"
		>
			<option value="none">No grouping</option>
			<option value="service">By service</option>
		</select>
	);
}

/** A service lane's header: its name and count, folding the lane on click. */
export function LaneHeader({
	view,
	id,
	name,
	count,
	className,
}: {
	view: GroupView;
	id: string;
	name: string;
	count: number;
	className?: string;
}) {
	const { folded, toggleLane } = useLayoutPrefs();
	const isFolded = folded[view].includes(id);
	return (
		<button
			type="button"
			aria-expanded={!isFolded}
			onClick={() => toggleLane(view, id)}
			className={cn(
				"flex w-full items-center gap-1.5 px-3 py-1 text-left text-meta font-medium text-muted-foreground hover:text-foreground",
				className,
			)}
			data-testid="service-lane"
			data-lane={id}
		>
			<ChevronRight
				className={cn("h-3 w-3 shrink-0", !isFolded && "rotate-90")}
			/>
			<span className="truncate">{name}</span>
			<Mono className="ml-1 font-normal">{count}</Mono>
		</button>
	);
}

/** Whether a lane is folded, for the views that render its rows. */
export function useLaneFolded(view: GroupView) {
	const { folded } = useLayoutPrefs();
	return (id: string) => folded[view].includes(id);
}
