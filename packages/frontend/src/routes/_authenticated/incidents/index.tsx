/**
 * The centre of the incidents frame when no record is selected: the window's
 * numbers, its severity mix, and the analytics over the same window. Picking
 * a row in the left pane replaces this with the record.
 */
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { BarChart3, List } from "lucide-react";
import {
	DateRangeFilter,
	FirstRunPanel,
	IncidentAnalytics,
	QueueStats,
} from "@/components/incidents";
import {
	orderIncidents,
	useIncidentWindow,
} from "@/components/incidents/IncidentListPane";
import { Button } from "@/components/ui/button";
import { SPLIT_PANES, useMediaQuery } from "@/hooks/use-media-query";
import { usePageTitle } from "@/hooks/use-page-title";
import { orpc } from "@/lib/api/orpc-client";

export const Route = createFileRoute("/_authenticated/incidents/")({
	component: IncidentsOverview,
});

function IncidentsOverview() {
	usePageTitle("Incidents");
	const navigate = useNavigate();
	const { search, from, to, listInput, statsInput, windowLabel } =
		useIncidentWindow();
	const stats = useQuery({
		...orpc.incidents.getStats.queryOptions({ input: statsInput }),
		refetchInterval: 30_000,
	});
	const workspace = useQuery(
		orpc.incidents.getStats.queryOptions({ input: {} }),
	);
	const analytics = search.view === "analytics";
	const { data: list, isLoading: listLoading } = useQuery(
		orpc.incidents.list.queryOptions({ input: listInput }),
	);

	const setSearch = (patch: Partial<typeof search>) =>
		navigate({
			to: ".",
			search: (prev) => ({ ...prev, ...patch }),
			replace: true,
		});

	// With nothing chosen, land on the row that needs a human most; the numbers
	// stay one click away behind the overview. An empty window shows the numbers.
	// Below `lg` the list is the page, so there is nothing to land on.
	const split = useMediaQuery(SPLIT_PANES);
	const top =
		split && !analytics && list ? orderIncidents(list.data)[0] : undefined;
	if (top) {
		return (
			<Navigate
				to="/incidents/$id"
				params={{ id: top.id }}
				search={{
					status: search.status,
					severity: search.severity,
					priority: search.priority,
					open: search.open,
					from: search.from,
					to: search.to,
				}}
				replace
			/>
		);
	}
	if (!analytics && listLoading) return null;

	// Nothing exists yet, in any window: the on-ramp, not numbers.
	if (workspace.data && workspace.data.total === 0) {
		return (
			<div className="h-full overflow-y-auto">
				<FirstRunPanel />
			</div>
		);
	}
	const windowEmpty = !!list && list.data.length === 0;
	const loaded = list?.data ?? [];
	const chartDays =
		from && to
			? Math.ceil((to.getTime() - from.getTime()) / 86_400_000)
			: spanDays(loaded);
	// The charts stop at `chartDays`; the totals count the same incidents.
	const charted =
		from && to
			? loaded
			: loaded.filter(
					(i) =>
						Date.now() - new Date(i.triggeredAt).getTime() <
						chartDays * 86_400_000,
				);

	return (
		<div className="h-full overflow-y-auto" data-testid="incidents-overview">
			<div className="mx-auto max-w-4xl space-y-4 px-4 py-4 sm:px-6">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<DateRangeFilter
						value={{ from, to }}
						onChange={(v) =>
							setSearch({
								from: v.from?.toISOString(),
								to: v.to?.toISOString(),
							})
						}
					/>
					<div className="flex items-center gap-1 rounded-md border p-0.5">
						<Button
							variant={analytics ? "ghost" : "secondary"}
							size="sm"
							className="h-7"
							onClick={() => setSearch({ view: undefined })}
						>
							<List className="mr-1 h-3.5 w-3.5" />
							Window
						</Button>
						<Button
							variant={analytics ? "secondary" : "ghost"}
							size="sm"
							className="h-7"
							onClick={() => setSearch({ view: "analytics" })}
							data-testid="incidents-view-analytics"
						>
							<BarChart3 className="mr-1 h-3.5 w-3.5" />
							Analytics
						</Button>
					</div>
				</div>

				{!windowEmpty && (
					<QueueStats
						stats={stats.data}
						isLoading={stats.isLoading}
						error={stats.error}
						updatedAt={stats.dataUpdatedAt}
						onRetry={() => stats.refetch()}
						window={windowLabel}
						openFilter={search.open === "1"}
						onToggleOpen={() =>
							setSearch({
								open: search.open === "1" ? undefined : "1",
								status: undefined,
							})
						}
						severityFilter={search.severity}
						onSeverity={(severity) =>
							setSearch({ severity: severity as typeof search.severity })
						}
					/>
				)}

				{windowEmpty && (
					<p
						className="rounded-md border border-dashed p-3 text-record text-muted-foreground"
						data-testid="incidents-window-empty"
					>
						Nothing in this window.{" "}
						<button
							type="button"
							className="text-primary hover:underline"
							onClick={() => setSearch({ from: undefined, to: undefined })}
						>
							Show all time
						</button>
					</p>
				)}
				{analytics && !windowEmpty && (
					<IncidentAnalytics
						incidents={charted}
						days={chartDays}
						onSeverityFilter={(severity) =>
							setSearch({
								severity: severity as typeof search.severity,
								view: undefined,
							})
						}
						onServiceFilter={(serviceId) =>
							navigate({
								to: "/services/$id",
								params: { id: serviceId },
								search: { tab: "overview" },
							})
						}
					/>
				)}
			</div>
		</div>
	);
}

/** "All time" charts from the oldest incident, so the chart and the totals agree. */
function spanDays(incidents: { triggeredAt: string | Date }[]): number {
	const oldest = Math.min(
		...incidents.map((i) => new Date(i.triggeredAt).getTime()),
	);
	if (!Number.isFinite(oldest)) return 30;
	return Math.min(
		365,
		Math.max(30, Math.ceil((Date.now() - oldest) / 86_400_000) + 1),
	);
}
