/**
 * The Alerts door. From 1280 the sidebar holds the list, so this page holds
 * the numbers; narrower, the list is the page. Either way the header carries
 * the window's controls, and opening an alert keeps them (study-v3 §8).
 */
import {
	AlertStatusSchema,
	firingCount,
	SEVERITY_LABEL,
	SeveritySchema,
} from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChartColumn, Plug, RefreshCw, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { AlertFilters } from "@/components/alerts/AlertFilters";
import {
	AlertListPane,
	alertWord,
	useAlertWindow,
	usePullAlerts,
} from "@/components/alerts/AlertListPane";
import { AlertsBlank } from "@/components/alerts/AlertsBlank";
import { WebhookCopy } from "@/components/alerts/WebhookCopy";
import { Mark } from "@/components/kit/Mark";
import { Tabs } from "@/components/kit/Tabs";
import { Hint } from "@/components/shared/Hint";
import { GroupBySelect } from "@/components/shared/ServiceLanes";
import { Empty, Loading, Problem } from "@/components/shared/State";
import { PageHeader } from "@/components/shell/PageHeader";
import { HelperThread } from "@/components/thread/HelperThread";
import { Button } from "@/components/ui/button";
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
	// The list lives on this page at every width; the sidebar keeps the threads (#1020 D1).
	const showNumbers = search.view === "stats";
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
	const firing = stats.data ? firingCount(stats.data.byStatus) : 0;

	if (stats.data?.total === 0)
		return (
			<>
				<PageHeader
					title="Alerts"
					primary={
						<Button
							variant="text"
							onClick={() => pull.mutate({})}
							disabled={pull.isPending}
							data-testid="alerts-pull"
						>
							Pull now
						</Button>
					}
				/>
				<div className="min-h-0 flex-1 overflow-y-auto">
					<AlertsBlank />
					<HelperThread
						place="alerts"
						className="mx-auto max-w-(--reading-w) px-4 pb-8"
					/>
				</div>
			</>
		);
	return (
		<>
			<PageHeader
				title={
					<>
						Alerts
						{stats.data && (
							<span className="ml-2 text-meta font-normal text-text-3 tabular-nums">
								{firing} firing of{" "}
								<span data-testid="alerts-total-count">{stats.data.total}</span>
							</span>
						)}
					</>
				}
			>
				<Tabs
					label="Alerts"
					value={search.tab ?? "all"}
					onValueChange={(v) =>
						setFilter({ tab: v === "unmapped" ? "unmapped" : undefined })
					}
					items={[
						{ value: "all", label: "All alerts" },
						{ value: "unmapped", label: "Unmapped" },
					]}
				/>
				<div className="ml-auto flex items-center gap-1">
					<GroupBySelect className="max-sm:hidden" />
					<Hint label="Filters" when={!filtersOpen}>
						<Button
							variant="text"
							size="icon"
							aria-label="Filters"
							aria-pressed={filtersOpen}
							onClick={() => setFiltersOpen((v) => !v)}
							className={filtersOpen ? "bg-surface-3 text-text-1" : undefined}
							data-testid="alert-list-filters-toggle"
						>
							<SlidersHorizontal />
						</Button>
					</Hint>
					<Hint label={showNumbers ? "List" : "Numbers"}>
						<Button
							variant="text"
							size="icon"
							aria-label="Numbers"
							onClick={() =>
								setFilter({ view: showNumbers ? undefined : "stats" })
							}
							aria-pressed={showNumbers}
							className={showNumbers ? "bg-surface-3 text-text-1" : undefined}
							data-testid="alerts-view-numbers"
						>
							<ChartColumn />
						</Button>
					</Hint>
					<Hint label="Pull now">
						<Button
							variant="text"
							size="icon"
							aria-label="Pull now"
							onClick={() => pull.mutate({})}
							disabled={pull.isPending}
							data-testid="alerts-pull"
						>
							<RefreshCw />
						</Button>
					</Hint>
					{/* Where sources are configured, reachable from the list as well as from Settings. */}
					<Hint label="Connect a source">
						<Button variant="text" size="icon" asChild>
							<Link
								to="/settings"
								search={{ tab: "alert-intake" }}
								aria-label="Connect a source"
								data-testid="alerts-connect"
							>
								<Plug />
							</Link>
						</Button>
					</Hint>
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
			{showNumbers ? (
				<AlertNumbers />
			) : (
				<AlertListPane
					selectedId={null}
					className="min-h-0 flex-1 pt-1"
					whenEmpty={
						<HelperThread place="alerts" className="mx-auto mt-4 px-4" />
					}
				/>
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
	const firing = s ? firingCount(s.byStatus) : 0;
	return (
		<div
			className="min-h-0 flex-1 overflow-y-auto"
			data-testid="alerts-overview"
		>
			<div className="mx-auto w-full max-w-(--reading-w) px-6 pt-4 pb-12">
				{stats.error && !s ? (
					<Problem
						text="The numbers did not load."
						onRetry={() => void stats.refetch()}
					/>
				) : !s ? (
					<Loading rows={3} />
				) : s.total === 0 ? (
					<>
						<Empty
							text="Nothing has fired yet."
							testId="alerts-none"
							action={
								<>
									<Button variant="text" size="sm" asChild>
										<Link to="/settings" search={{ tab: "sources" }}>
											Add an alert source
										</Link>
									</Button>
									<WebhookCopy testIdPrefix="alerts" />
								</>
							}
						/>
						<HelperThread place="alerts" className="mt-4" />
					</>
				) : (
					<>
						<p
							className="text-title font-normal text-text-2"
							data-testid="alerts-stat-firing"
						>
							<span className="font-semibold text-text-1 tabular-nums">
								{firing}
							</span>{" "}
							firing of <span className="tabular-nums">{s.total}</span>,{" "}
							<span className="tabular-nums">{s.byStatus.resolved ?? 0}</span>{" "}
							cleared.
						</p>
						<dl className="mt-8 grid grid-cols-[8rem_1fr] gap-x-6 gap-y-2 text-body">
							<dt className="text-text-3">By severity</dt>
							<dd className="flex flex-wrap gap-x-4 gap-y-1">
								{SeveritySchema.options.map((sev) =>
									s.bySeverity[sev] ? (
										<span
											key={sev}
											className="inline-flex items-center gap-1.5"
										>
											<Mark
												id="severity"
												state={sev}
												word={SEVERITY_LABEL[sev]}
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
										<span key={st} className="inline-flex items-center gap-1.5">
											<Mark id="alert" state={st} word={alertWord(st)} />
											{alertWord(st)}
											<span className="text-text-3 tabular-nums">
												{s.byStatus[st]}
											</span>
										</span>
									) : null,
								)}
							</dd>
						</dl>
					</>
				)}
			</div>
		</div>
	);
}
