/**
 * The centre of the incidents frame when no record is selected: the window's
 * numbers, its severity mix, and the analytics over the same window. Picking
 * a row in the left pane replaces this with the record.
 */
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { BarChart3, List } from "lucide-react";
import {
	DateRangeFilter,
	IncidentAnalytics,
	QueueStats,
} from "@/components/incidents";
import { useIncidentWindow } from "@/components/incidents/IncidentListPane";
import { TelemetryConsent } from "@/components/settings";
import { Mono } from "@/components/shared/Mono";
import { Button } from "@/components/ui/button";
import { orpc } from "@/lib/api/orpc-client";

export const Route = createFileRoute("/_authenticated/incidents/")({
	component: IncidentsOverview,
});

function IncidentsOverview() {
	const navigate = useNavigate();
	const { search, from, to, listInput, statsInput, windowLabel } =
		useIncidentWindow();
	const stats = useQuery({
		...orpc.incidents.getStats.queryOptions({ input: statsInput }),
		refetchInterval: 30_000,
	});
	const analytics = search.view === "analytics";
	const { data: list } = useQuery({
		...orpc.incidents.list.queryOptions({ input: listInput }),
		enabled: analytics,
	});

	const setSearch = (patch: Partial<typeof search>) =>
		navigate({
			to: ".",
			search: (prev) => ({ ...prev, ...patch }),
			replace: true,
		});

	return (
		<div className="h-full overflow-y-auto" data-testid="incidents-overview">
			<div className="mx-auto max-w-4xl space-y-6 px-4 py-4 sm:px-6">
				<TelemetryConsent />

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

				{analytics ? (
					<IncidentAnalytics
						incidents={list?.data ?? []}
						days={
							from && to
								? Math.ceil((to.getTime() - from.getTime()) / 86_400_000)
								: 30
						}
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
				) : (
					<p
						className="rounded-md border border-dashed p-4 text-record text-muted-foreground"
						data-testid="incidents-pick-hint"
					>
						Pick an incident on the left, or press <Mono>j</Mono> then{" "}
						<Mono>↵</Mono>. The ones that need you are at the top.
					</p>
				)}
			</div>
		</div>
	);
}
