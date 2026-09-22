/**
 * The alerts frame (#523): the same shape as incidents. The intake queue is a
 * left pane, firing first; the selected alert's record is the centre. Nothing
 * scrolls the window. The filters live in this route's search so the pane and
 * the numbers share one window.
 */
import type { AlertStatus, Severity } from "@prismalens/contracts";
import { createFileRoute, Outlet, useMatch } from "@tanstack/react-router";
import { AlertListPane } from "@/components/alerts/AlertListPane";
import { cn } from "@/lib/utils";

export type AlertsTab = "all" | "unmapped";

export interface AlertsSearch {
	tab?: AlertsTab;
	status?: AlertStatus;
	severity?: Severity;
	view?: "stats";
}

function str<T extends string>(v: unknown): T | undefined {
	return typeof v === "string" && v.length > 0 ? (v as T) : undefined;
}

export const Route = createFileRoute("/_authenticated/alerts")({
	validateSearch: (search: Record<string, unknown>): AlertsSearch => ({
		tab: search.tab === "unmapped" ? "unmapped" : undefined,
		status: str<AlertStatus>(search.status),
		severity: str<Severity>(search.severity),
		view: search.view === "stats" ? "stats" : undefined,
	}),
	component: AlertsFrame,
});

function AlertsFrame() {
	const record = useMatch({
		from: "/_authenticated/alerts/$id/",
		shouldThrow: false,
	});
	const recordOpen = !!record;

	return (
		<div
			className="fixed inset-y-0 left-0 right-0 top-10 grid grid-cols-1 bg-background md:top-0 md:left-(--sidebar-w) lg:grid-cols-[19rem_minmax(0,1fr)] 2xl:grid-cols-[22rem_minmax(0,1fr)]"
			data-testid="alerts-frame"
		>
			<AlertListPane
				selectedId={record?.params.id ?? null}
				className={cn("min-h-0 border-r", recordOpen && "hidden lg:flex")}
			/>
			<div className={cn("min-h-0 min-w-0", !recordOpen && "hidden lg:block")}>
				<Outlet />
			</div>
		</div>
	);
}
