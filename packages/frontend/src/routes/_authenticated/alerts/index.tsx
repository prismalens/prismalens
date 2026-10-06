/**
 * The Alerts door. From 1280 the sidebar holds the list, so this page holds
 * the numbers; narrower, the list is the page. Either way the header carries
 * the window's controls, and opening an alert keeps them (study-v3 §8).
 */
import {
	AlertStatusSchema,
	SEVERITY_LABEL,
	SeveritySchema,
} from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { AlertFilters } from "@/components/alerts/AlertFilters";
import {
	AlertListPane,
	alertWord,
	useAlertWindow,
	usePullAlerts,
} from "@/components/alerts/AlertListPane";
import { Hint } from "@/components/shared/Hint";
import { GroupBySelect } from "@/components/shared/ServiceLanes";
import { Empty, Loading, Problem } from "@/components/shared/State";
import { StateWord } from "@/components/shared/StateWord";
import { PageHeader } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { markFirstOpened, useFirstOpen } from "@/hooks/use-first-open";
import { useLayoutPrefs } from "@/hooks/use-layout-prefs";
import { SIDEBAR_FULL, useMediaQuery } from "@/hooks/use-media-query";
import { usePageTitle } from "@/hooks/use-page-title";
import { useLiveRefreshInterval } from "@/lib/api/live-refresh";
import { orpc } from "@/lib/api/orpc-client";
import { alertStatusTone } from "@/lib/state-tone";
import type { AlertsSearch } from "./route";

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
	useOpenFirstFiring(search);
	const [filtersOpen, setFiltersOpen] = useState(
		!!(search.status || search.severity),
	);
	const setFilter = (patch: Partial<typeof search>) =>
		navigate({
			to: ".",
			search: (prev) => ({ ...prev, ...patch }),
			replace: true,
		});
	const firing = stats.data?.byStatus.triggered ?? 0;

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
					value={search.tab ?? "all"}
					onValueChange={(v) =>
						setFilter({ tab: v === "unmapped" ? "unmapped" : undefined })
					}
				>
					<TabsList>
						<TabsTrigger value="all">All alerts</TabsTrigger>
						<TabsTrigger value="unmapped">Unmapped</TabsTrigger>
					</TabsList>
				</Tabs>
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
					<Button
						variant="text"
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

/** From the door at ≥ 1024, the first firing alert opens in place of a bare page (L26). */
function useOpenFirstFiring(search: AlertsSearch) {
	const navigate = useNavigate();
	const want = useFirstOpen(
		"/alerts",
		!search.tab && !search.status && !search.severity && !search.view,
	);
	const first = useQuery({
		...orpc.alerts.list.queryOptions({
			input: { status: "triggered", limit: 1 },
		}),
		enabled: want,
	});
	const id = first.data?.data[0]?.id;
	useEffect(() => {
		if (!want || !id) return;
		markFirstOpened("/alerts");
		void navigate({
			to: "/alerts/$id",
			params: { id },
			search: {},
			replace: true,
		});
	}, [want, id, navigate]);
}

function AlertNumbers() {
	const stats = useQuery({
		...orpc.alerts.getStats.queryOptions({ input: {} }),
		refetchInterval: useLiveRefreshInterval(),
	});
	const s = stats.data;
	// Firing is Triggered alone (look ruling §1.3): the Alerts door counts the same.
	const firing = s?.byStatus.triggered ?? 0;
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
					<Empty
						text="Nothing has fired yet."
						testId="alerts-none"
						action={
							<Button variant="text" size="sm" asChild>
								<Link to="/settings" search={{ tab: "sources" }}>
									Add an alert source
								</Link>
							</Button>
						}
					/>
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
							<span className="tabular-nums">
								{s.byStatus.acknowledged ?? 0}
							</span>{" "}
							acknowledged,{" "}
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
											<StateWord tone={alertStatusTone(st)}>
												{alertWord(st)}
											</StateWord>{" "}
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
