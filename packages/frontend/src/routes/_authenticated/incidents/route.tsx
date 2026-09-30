/**
 * The incidents frame (#523, #743): a fixed viewport under the nav. With no
 * incident open the board fills it; beside an open incident the list is its
 * navigator. Below `lg` the list is the board folded. Nothing here scrolls
 * the window; each pane scrolls itself. The filters live in this route's
 * search so the list, the board and the record share one window.
 */
import type { IncidentStatus, Priority, Severity } from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet, useMatch } from "@tanstack/react-router";
import { IncidentListPane } from "@/components/incidents/IncidentListPane";
import { SPLIT_PANES, useMediaQuery } from "@/hooks/use-media-query";
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
	// An empty workspace has no list to show; below `lg` the board's first-run
	// panel takes the list's place instead of hiding behind it.
	// Unfiltered: a date window with no incidents is not a new workspace.
	const stats = useQuery(orpc.incidents.getStats.queryOptions({ input: {} }));
	const firstRun = !recordOpen && stats.data?.total === 0;
	// On the landing only one of list and board is mounted, so j / k / Enter
	// have one owner: the board from `lg`, the list (the board folded) below.
	const split = useMediaQuery(SPLIT_PANES);
	const showList = recordOpen || (!split && !firstRun);
	const showOutlet = recordOpen || split || firstRun;

	return (
		<div
			className={cn(
				"fixed inset-y-0 left-0 right-0 top-10 grid grid-cols-1 bg-background md:top-(--titlebar-h) md:left-(--sidebar-w)",
				recordOpen &&
					"lg:grid-cols-[19rem_minmax(0,1fr)] 2xl:grid-cols-[22rem_minmax(0,1fr)]",
			)}
			data-testid="incidents-frame"
		>
			{showList && (
				<IncidentListPane
					selectedId={record?.params.id ?? null}
					className={cn("min-h-0 border-r", recordOpen && "hidden lg:flex")}
				/>
			)}
			{showOutlet && (
				<div className="min-h-0 min-w-0">
					<Outlet />
				</div>
			)}
		</div>
	);
}
