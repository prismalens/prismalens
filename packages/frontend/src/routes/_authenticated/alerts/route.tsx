/**
 * The alerts frame (#523, study-v3 §8): one area beside the sidebar, which
 * carries the alert list from 1280; there is no second list here. The
 * filters live in this route's search so the list and the numbers share one
 * window.
 */
import type { AlertStatus, Severity } from "@prismalens/contracts";
import { createFileRoute, Outlet } from "@tanstack/react-router";

export type AlertsTab = "all" | "unmapped";

export interface AlertsSearch {
	tab?: AlertsTab;
	/** The numbers page, kept when the landing would open the first firing alert. */
	view?: "stats";
	status?: AlertStatus;
	severity?: Severity;
}

function str<T extends string>(v: unknown): T | undefined {
	return typeof v === "string" && v.length > 0 ? (v as T) : undefined;
}

export const Route = createFileRoute("/_authenticated/alerts")({
	validateSearch: (search: Record<string, unknown>): AlertsSearch => ({
		tab: search.tab === "unmapped" ? "unmapped" : undefined,
		view: search.view === "stats" ? "stats" : undefined,
		status: str<AlertStatus>(search.status),
		severity: str<Severity>(search.severity),
	}),
	component: AlertsFrame,
});

function AlertsFrame() {
	return (
		<div
			className="fixed inset-x-0 bottom-0 top-(--frame-top) flex flex-col bg-canvas md:left-(--sidebar-w)"
			data-testid="alerts-frame"
		>
			<Outlet />
		</div>
	);
}
