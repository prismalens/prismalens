/**
 * The incidents frame (#523, #743): a fixed viewport under the nav, the list
 * always on the left as the navigator, and the board (or the open incident)
 * to its right. Below `lg` the list is the board folded. Nothing here scrolls
 * the window; each pane scrolls itself. The filters live in this route's
 * search so the list, the board and the record share one window.
 */
import type { IncidentStatus, Priority, Severity } from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet, useMatch } from "@tanstack/react-router";
import { IncidentListPane } from "@/components/incidents/IncidentListPane";
import { SIDEBAR_BESIDE, useMediaQuery } from "@/hooks/use-media-query";
import { orpc } from "@/lib/api/orpc-client";
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
	const recordOpen = !!record;
	// From `md` the list lives in the sidebar; below it, it is the landing and
	// the board hides behind it.
	const beside = useMediaQuery(SIDEBAR_BESIDE);
	// Unfiltered: a date window with no incidents is not a new workspace.
	const stats = useQuery(orpc.incidents.getStats.queryOptions({ input: {} }));
	const firstRun = !recordOpen && stats.data?.total === 0;
	const listHere = !beside && !firstRun && !recordOpen;
	return (
		<div
			className={cn(
				"fixed inset-y-0 left-0 right-0 top-10 bg-background md:top-(--titlebar-h) md:left-(--sidebar-w)",
				// In the desktop window an open record's band is the title strip (#752).
				recordOpen && "desktop:top-0 desktop:z-40",
			)}
			data-testid="incidents-frame"
		>
			{listHere ? (
				<IncidentListPane
					selectedId={null}
					className="h-full bg-background pt-2"
				/>
			) : (
				<div className="h-full min-h-0 min-w-0">
					<Outlet />
				</div>
			)}
		</div>
	);
}
