/**
 * The centre of the alerts frame with nothing selected: land on the alert
 * that is firing first; with `?view=stats` (or an empty window) show the
 * numbers instead.
 */
import {
	ALERT_STATUS_LABEL,
	AlertStatusSchema,
	SEVERITY_LABEL,
	SeveritySchema,
} from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { orderAlerts, useAlertWindow } from "@/components/alerts/AlertListPane";
import { LiveSlot } from "@/components/shared/LiveSlot";
import { StateChip } from "@/components/shared/StateChip";
import { SPLIT_PANES, useMediaQuery } from "@/hooks/use-media-query";
import { usePageTitle } from "@/hooks/use-page-title";
import { orpc } from "@/lib/api/orpc-client";
import { alertStatusTone, severityTone } from "@/lib/state-tone";

export const Route = createFileRoute("/_authenticated/alerts/")({
	component: AlertsOverview,
});

function AlertsOverview() {
	usePageTitle("Alerts");
	const { search, listInput } = useAlertWindow();
	const stats = useQuery({
		...orpc.alerts.getStats.queryOptions({ input: {} }),
		refetchInterval: 30_000,
	});
	const { data: list, isLoading } = useQuery(
		orpc.alerts.list.queryOptions({ input: listInput }),
	);
	const showStats = search.view === "stats";
	// Below `lg` the list is the page, so there is nothing to land on.
	const split = useMediaQuery(SPLIT_PANES);
	const top =
		split && !showStats && list ? orderAlerts(list.data)[0] : undefined;
	if (top) {
		return (
			<Navigate
				to="/alerts/$id"
				params={{ id: top.id }}
				search={{
					tab: search.tab,
					status: search.status,
					severity: search.severity,
				}}
				replace
			/>
		);
	}
	if (!showStats && isLoading) return null;

	const s = stats.data;
	const slot = (label: string, value: string, note?: string) =>
		stats.error
			? ({
					label,
					state: "failed",
					source: "alerts",
					reason: stats.error.message,
					onRetry: () => stats.refetch(),
				} as const)
			: !s
				? ({ label, state: "fetching", source: "alerts" } as const)
				: ({
						label,
						state: "live",
						value,
						note,
						source: "alerts",
						window: "all time",
						updatedAt: new Date(stats.dataUpdatedAt),
					} as const);

	return (
		<div className="h-full overflow-y-auto" data-testid="alerts-overview">
			<div className="mx-auto max-w-4xl space-y-4 px-4 py-4 sm:px-6">
				<div className="grid gap-2 sm:grid-cols-3">
					<LiveSlot
						{...slot(
							"Firing",
							String(s?.byStatus.triggered ?? 0),
							s ? `of ${s.total}` : undefined,
						)}
						data-testid="alerts-stat-firing"
					/>
					<LiveSlot
						{...slot("Acknowledged", String(s?.byStatus.acknowledged ?? 0))}
					/>
					<LiveSlot {...slot("Resolved", String(s?.byStatus.resolved ?? 0))} />
				</div>
				{s && (
					<div className="flex flex-wrap items-center gap-1.5 px-1">
						<span className="mr-1 text-meta text-muted-foreground">
							By severity
						</span>
						{SeveritySchema.options.map((sev) =>
							s.bySeverity[sev] ? (
								<StateChip key={sev} tone={severityTone(sev)}>
									{SEVERITY_LABEL[sev]}{" "}
									<span className="tabular-nums">{s.bySeverity[sev]}</span>
								</StateChip>
							) : null,
						)}
						<span className="ml-3 mr-1 text-meta text-muted-foreground">
							By status
						</span>
						{AlertStatusSchema.options.map((st) =>
							s.byStatus[st] ? (
								<StateChip key={st} tone={alertStatusTone(st)}>
									{ALERT_STATUS_LABEL[st]}{" "}
									<span className="tabular-nums">{s.byStatus[st]}</span>
								</StateChip>
							) : null,
						)}
					</div>
				)}
				{!top && list && list.data.length === 0 && (
					<p className="rounded-md border border-dashed p-4 text-record text-muted-foreground">
						Nothing in this window. Alerts land here from the webhook, or pull
						them from Alertmanager with the button in the pane.
					</p>
				)}
			</div>
		</div>
	);
}
