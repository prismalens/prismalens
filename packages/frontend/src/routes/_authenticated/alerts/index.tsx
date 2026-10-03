/**
 * The Alerts door. From 1280 the sidebar holds the list, so this page holds
 * the numbers; narrower, the list is the page. Either way the header carries
 * the window's controls, and opening an alert keeps them (study-v3 §8).
 */
import {
	ALERT_STATUS_LABEL,
	AlertStatusSchema,
	SEVERITY_LABEL,
	SeveritySchema,
} from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { AlertFilters } from "@/components/alerts/AlertFilters";
import {
	AlertListPane,
	useAlertWindow,
	usePullAlerts,
} from "@/components/alerts/AlertListPane";
import { LiveSlot } from "@/components/shared/LiveSlot";
import { GroupBySelect } from "@/components/shared/ServiceLanes";
import { PageHeader } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLayoutPrefs } from "@/hooks/use-layout-prefs";
import { SIDEBAR_FULL, useMediaQuery } from "@/hooks/use-media-query";
import { usePageTitle } from "@/hooks/use-page-title";
import { useLiveRefreshInterval } from "@/lib/api/live-refresh";
import { orpc } from "@/lib/api/orpc-client";

export const Route = createFileRoute("/_authenticated/alerts/")({
	component: AlertsPage,
});

function AlertsPage() {
	usePageTitle("Alerts");
	const navigate = useNavigate();
	const { search } = useAlertWindow();
	const pull = usePullAlerts();
	const { sidebarFolded } = useLayoutPrefs();
	const listInSidebar = useMediaQuery(SIDEBAR_FULL) && !sidebarFolded;
	const stats = useQuery({
		...orpc.alerts.getStats.queryOptions({ input: {} }),
		refetchInterval: useLiveRefreshInterval(),
	});
	const [filtersOpen, setFiltersOpen] = useState(
		!!(search.status || search.severity),
	);
	const setFilter = (patch: Partial<typeof search>) =>
		navigate({
			to: ".",
			search: (prev) => ({ ...prev, ...patch }),
			replace: true,
		});

	return (
		<>
			<PageHeader
				title={
					<>
						Alerts
						{stats.data && (
							<span
								className="ml-2 font-normal text-text-3 tabular-nums"
								data-testid="alerts-total-count"
							>
								{stats.data.total}
							</span>
						)}
					</>
				}
			>
				<Tabs
					value={search.tab ?? "all"}
					onValueChange={(v) =>
						setFilter({ tab: v === "unmapped" ? "unmapped" : undefined })
					}
				>
					<TabsList className="h-8 border-b-0">
						<TabsTrigger value="all" className="h-8">
							All alerts
						</TabsTrigger>
						<TabsTrigger value="unmapped" className="h-8">
							Unmapped
						</TabsTrigger>
					</TabsList>
				</Tabs>
				<div className="ml-auto flex items-center gap-1">
					<GroupBySelect className="max-sm:hidden" />
					<Button
						variant="ghost"
						size="icon"
						aria-label="Filters"
						aria-pressed={filtersOpen}
						onClick={() => setFiltersOpen((v) => !v)}
						data-testid="alert-list-filters-toggle"
					>
						<SlidersHorizontal />
					</Button>
					<Button
						variant="secondary"
						onClick={() => pull.mutate({})}
						disabled={pull.isPending}
						data-testid="alerts-pull"
					>
						Pull now
					</Button>
				</div>
			</PageHeader>
			{filtersOpen && (
				<div className="px-4 pb-2 md:px-6" data-testid="alert-list-filters">
					<AlertFilters
						status={search.status ?? "all"}
						severity={search.severity ?? "all"}
						onStatusChange={(status) =>
							setFilter({ status: status === "all" ? undefined : status })
						}
						onSeverityChange={(severity) =>
							setFilter({ severity: severity === "all" ? undefined : severity })
						}
						onClear={() =>
							setFilter({ status: undefined, severity: undefined })
						}
					/>
				</div>
			)}
			{listInSidebar ? (
				<AlertNumbers />
			) : (
				<AlertListPane selectedId={null} className="min-h-0 flex-1 pt-1" />
			)}
		</>
	);
}

function AlertNumbers() {
	const stats = useQuery({
		...orpc.alerts.getStats.queryOptions({ input: {} }),
		refetchInterval: useLiveRefreshInterval(),
	});
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
		<div
			className="min-h-0 flex-1 overflow-y-auto"
			data-testid="alerts-overview"
		>
			<div className="mx-auto w-full max-w-(--reading-w) px-6 pt-4 pb-12">
				{s && s.total === 0 ? (
					<p className="text-body text-text-2" data-testid="alerts-empty-state">
						No alerts found. Sources are under Settings, Integrations.
					</p>
				) : (
					<>
						<div className="grid gap-3 sm:grid-cols-3">
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
							<LiveSlot
								{...slot("Resolved", String(s?.byStatus.resolved ?? 0))}
							/>
						</div>
						{s && (
							<dl className="mt-8 grid grid-cols-[8rem_1fr] gap-x-6 gap-y-2 text-body">
								<dt className="text-text-3">By severity</dt>
								<dd className="flex flex-wrap gap-x-4 gap-y-1">
									{SeveritySchema.options.map((sev) =>
										s.bySeverity[sev] ? (
											<span
												key={sev}
												className="inline-flex items-center gap-1.5"
											>
												<span
													aria-hidden
													className="size-2 rounded-full"
													style={{ background: `var(--sev-${sev})` }}
												/>
												{SEVERITY_LABEL[sev]}
												<span className="text-text-3 tabular-nums">
													{s.bySeverity[sev]}
												</span>
											</span>
										) : null,
									)}
								</dd>
								<dt className="text-text-3">By status</dt>
								<dd className="flex flex-wrap gap-x-4 gap-y-1">
									{AlertStatusSchema.options.map((st) =>
										s.byStatus[st] ? (
											<span key={st}>
												{ALERT_STATUS_LABEL[st]}{" "}
												<span className="text-text-3 tabular-nums">
													{s.byStatus[st]}
												</span>
											</span>
										) : null,
									)}
								</dd>
							</dl>
						)}
					</>
				)}
			</div>
		</div>
	);
}
