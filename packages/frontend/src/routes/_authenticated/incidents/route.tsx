/**
 * The incidents frame (#523, #811): a fixed viewport beside the sidebar; the
 * inbox, All incidents, Analytics or the open incident fills it. Nothing here
 * scrolls the window; each pane scrolls itself. The views and their filters
 * live in this route's search.
 */
import type { IncidentStatus, Priority, Severity } from "@prismalens/contracts";
import { createFileRoute, Outlet } from "@tanstack/react-router";

export interface IncidentsSearch {
	status?: IncidentStatus;
	severity?: Severity;
	priority?: Priority;
	/** `1` narrows the list to open incidents (the "Open" slot). */
	open?: "1";
	from?: string;
	to?: string;
	view?: "analytics" | "all";
}

function str<T extends string>(v: unknown): T | undefined {
	return typeof v === "string" && v.length > 0 ? (v as T) : undefined;
}

export const Route = createFileRoute("/_authenticated/incidents")({
	validateSearch: (search: Record<string, unknown>): IncidentsSearch => ({
		status: str<IncidentStatus>(search.status),
		severity: str<Severity>(search.severity),
		priority: str<Priority>(search.priority),
		open: search.open === "1" ? "1" : undefined,
		from: str(search.from),
		to: str(search.to),
		view:
			search.view === "analytics" || search.view === "all"
				? search.view
				: undefined,
	}),
	component: IncidentsFrame,
});

function IncidentsFrame() {
	return (
		<div
			className="fixed inset-x-0 bottom-0 top-(--frame-top) bg-canvas md:left-(--sidebar-w)"
			data-testid="incidents-frame"
		>
			<div className="h-full min-h-0 min-w-0">
				<Outlet />
			</div>
		</div>
	);
}
