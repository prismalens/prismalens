// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ChevronRight } from "lucide-react";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { type GroupView, useLayoutPrefs } from "@/hooks/use-layout-prefs";
import { cn } from "@/lib/utils";

/** Group the alerts pane by service or not; remembered (#743). */
export function GroupBySelect({ className }: { className?: string }) {
	const { alertsGroupBy, setAlertsGroupBy } = useLayoutPrefs();
	return (
		<Select
			value={alertsGroupBy}
			onValueChange={(v) =>
				setAlertsGroupBy(v === "service" ? "service" : "none")
			}
		>
			<SelectTrigger
				aria-label="Group by"
				className={className}
				data-testid="group-by-alerts"
			>
				<SelectValue />
			</SelectTrigger>
			<SelectContent align="end">
				<SelectItem value="none">No grouping</SelectItem>
				<SelectItem value="service">By service</SelectItem>
			</SelectContent>
		</Select>
	);
}

/** A service lane's header: its name and count, folding the lane on click. */
export function LaneHeader({
	view,
	id,
	name,
	count,
	foldedByDefault = false,
	className,
}: {
	view: GroupView;
	id: string;
	name: string;
	count: number;
	/** A stored id then means the lane was opened, not folded. */
	foldedByDefault?: boolean;
	className?: string;
}) {
	const { folded, toggleLane } = useLayoutPrefs();
	const isFolded = folded[view].includes(id) !== foldedByDefault;
	return (
		<button
			type="button"
			aria-expanded={!isFolded}
			onClick={() => toggleLane(view, id)}
			className={cn(
				"group/lane flex w-full items-center gap-1 rounded-control px-2.5 pt-3.5 pb-1 text-left text-meta text-text-3 transition-colors duration-(--dur-instant) hover:text-text-2",
				className,
			)}
			data-testid="service-lane"
			data-lane={id}
		>
			<span className="truncate">{name}</span>
			<ChevronRight
				aria-hidden
				className={cn(
					"size-3 shrink-0",
					isFolded ? "" : "rotate-90 opacity-0 group-hover/lane:opacity-100",
				)}
			/>
			<span className="ml-auto tabular-nums">{count}</span>
		</button>
	);
}

/** Whether a lane is folded, for the views that render its rows. */
export function useLaneFolded(view: GroupView) {
	const { folded } = useLayoutPrefs();
	return (id: string, foldedByDefault = false) =>
		folded[view].includes(id) !== foldedByDefault;
}
