/**
 * The incidents frame (#523): a fixed viewport under the nav with the queue as
 * a left pane and the selected record (or the window's numbers) to its right.
 * Nothing here scrolls the window; each pane scrolls itself. The filters live
 * in this route's search so the list and the record share one window.
 */
import type { IncidentStatus, Priority, Severity } from "@prismalens/contracts";
import { createFileRoute, Outlet, useMatch } from "@tanstack/react-router";
import { IncidentListPane } from "@/components/incidents/IncidentListPane";
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
		from: "/_authenticated/incidents/$id/",
		shouldThrow: false,
	});
	const recordOpen = !!record;

	return (
		<div
			className="fixed inset-y-0 left-0 right-0 top-10 grid grid-cols-1 bg-background md:top-0 md:left-(--sidebar-w) lg:grid-cols-[19rem_minmax(0,1fr)]"
			data-testid="incidents-frame"
		>
			<IncidentListPane
				selectedId={record?.params.id ?? null}
				className={cn("min-h-0 border-r", recordOpen && "hidden lg:flex")}
			/>
			<div className={cn("min-h-0 min-w-0", !recordOpen && "hidden lg:block")}>
				<Outlet />
			</div>
		</div>
	);
}
