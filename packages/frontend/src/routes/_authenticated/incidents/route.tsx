/**
 * The incidents frame (#523, #743): a fixed viewport beside the sidebar, which
 * carries the incident list from 1280; the board or the open incident fills
 * it. On the phone the board's columns stack and are the list (study-v3 §3.1).
 * Nothing here scrolls the window; each pane scrolls itself. The filters live
 * in this route's search so the list, the board and the record share one window.
 */
import type { IncidentStatus, Priority, Severity } from "@prismalens/contracts";
import { createFileRoute, Outlet, useMatch } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export interface IncidentsSearch {
	status?: IncidentStatus;
	severity?: Severity;
	priority?: Priority;
	/** `1` narrows the list to open incidents (the "Open" slot). */
	open?: "1";
	from?: string;
	to?: string;
	view?: "analytics";
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
		view: search.view === "analytics" ? "analytics" : undefined,
	}),
	component: IncidentsFrame,
});

function IncidentsFrame() {
	const record = useMatch({
		from: "/_authenticated/incidents/$id",
		shouldThrow: false,
	});
	return (
		<div
			className={cn(
				"fixed inset-x-0 bottom-0 top-(--frame-top) bg-canvas md:left-(--sidebar-w)",
				// In the desktop window an open record's band is the title strip (#752).
				!!record && "desktop:top-0 desktop:z-40",
			)}
			data-testid="incidents-frame"
		>
			<div className="h-full min-h-0 min-w-0">
				<Outlet />
			</div>
		</div>
	);
}
