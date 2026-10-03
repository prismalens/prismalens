/**
 * The incidents landing (study-v3 §3.1, §3.6): the board, or Analytics with
 * `?view=analytics`. A workspace with no incidents shows only the first-run
 * steps. The text filter narrows the loaded window on the client.
 */
import type { IncidentWithRelations } from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { IncidentAnalytics } from "@/components/incidents/analytics/IncidentAnalytics";
import { FirstRunPanel, SetupLine } from "@/components/incidents/FirstRunPanel";
import { IncidentBoard } from "@/components/incidents/IncidentBoard";
import { useIncidentWindow } from "@/components/incidents/IncidentListPane";
import { Segmented } from "@/components/shared/Segmented";
import { PageHeader } from "@/components/shell/PageHeader";
import { usePageTitle } from "@/hooks/use-page-title";
import { useLiveRefreshInterval } from "@/lib/api/live-refresh";
import { orpc } from "@/lib/api/orpc-client";
import type { IncidentsSearch } from "./route";

export const Route = createFileRoute("/_authenticated/incidents/")({
	component: IncidentsLanding,
});

function matches(incident: IncidentWithRelations, needle: string) {
	return (
		incident.title.toLowerCase().includes(needle) ||
		`inc-${incident.number}`.includes(needle) ||
		(incident.service?.name ?? "").toLowerCase().includes(needle) ||
		(incident.service?.displayName ?? "").toLowerCase().includes(needle)
	);
}

const DAY = 86_400_000;
const WINDOWS = {
	all: { label: "All time", days: 0 },
	"1d": { label: "24 hours", days: 1 },
	"7d": { label: "7 days", days: 7 },
	"30d": { label: "30 days", days: 30 },
	"90d": { label: "90 days", days: 90 },
} as const;
type WindowKey = keyof typeof WINDOWS;

function windowOf(from: string | undefined): WindowKey {
	if (!from) return "all";
	const days = Math.round((Date.now() - new Date(from).getTime()) / DAY);
	return days <= 1 ? "1d" : days <= 7 ? "7d" : days <= 30 ? "30d" : "90d";
}

function IncidentsLanding() {
	const navigate = useNavigate();
	const { search, listInput } = useIncidentWindow();
	const analytics = search.view === "analytics";
	usePageTitle(analytics ? "Analytics, Incidents" : "Incidents");
	const [q, setQ] = useState("");
	const workspace = useQuery({
		...orpc.incidents.getStats.queryOptions({ input: {} }),
		refetchInterval: useLiveRefreshInterval(),
	});
	const {
		data: list,
		isLoading,
		error: listError,
	} = useQuery({
		...orpc.incidents.list.queryOptions({ input: listInput }),
		refetchInterval: useLiveRefreshInterval(),
		enabled: !analytics,
	});
	const keep: IncidentsSearch = {
		status: search.status,
		severity: search.severity,
		priority: search.priority,
		open: search.open,
		from: search.from,
		to: search.to,
	};
	const setSearch = (patch: Partial<IncidentsSearch>) =>
		navigate({
			to: ".",
			search: (prev) => ({ ...prev, ...patch }),
			replace: true,
		});

	const incidents = useMemo(() => {
		const all = list?.data ?? [];
		const needle = q.trim().toLowerCase();
		return needle ? all.filter((i) => matches(i, needle)) : all;
	}, [list, q]);
	const firstRun = workspace.data?.total === 0;
	const windowKey = windowOf(search.from);
	const setWindow = (key: WindowKey) => {
		const days = WINDOWS[key].days;
		setSearch({
			from: days ? new Date(Date.now() - days * DAY).toISOString() : undefined,
			to: undefined,
		});
	};
	const windows: WindowKey[] = analytics
		? ["7d", "30d", "90d"]
		: ["all", "1d", "7d", "30d"];

	return (
		<div
			className="flex h-full min-h-0 flex-col"
			data-testid="incidents-overview"
		>
			<PageHeader title="Incidents">
				{!firstRun && (
					<>
						<Segmented
							label="View"
							value={analytics ? "analytics" : "board"}
							onChange={(v) =>
								setSearch({
									view: v === "analytics" ? "analytics" : undefined,
									...(v === "analytics" && !search.from
										? {
												from: new Date(Date.now() - 30 * DAY).toISOString(),
											}
										: {}),
								})
							}
							options={[
								{ value: "board", label: "Board" },
								{ value: "analytics", label: "Analytics" },
							]}
							testId="incidents-view"
						/>
						<div className="flex basis-full items-center gap-2 md:ml-auto md:basis-auto">
							<label className="raised flex h-7 min-w-0 flex-1 items-center gap-2 rounded-control px-2.5 md:w-44 md:flex-none">
								<Search className="size-3.5 shrink-0 text-text-3" />
								<input
									value={q}
									onChange={(e) => setQ(e.target.value)}
									placeholder="Filter"
									aria-label="Filter incidents"
									className="h-6 min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-text-3 md:text-body"
									data-testid="board-search"
								/>
							</label>
							<select
								value={windows.includes(windowKey) ? windowKey : windows[1]}
								onChange={(e) => setWindow(e.target.value as WindowKey)}
								aria-label="Window"
								className="raised h-7 rounded-control px-2 text-body text-text-2 outline-none"
								data-testid="board-window"
							>
								{windows.map((w) => (
									<option key={w} value={w}>
										{analytics ? `Last ${WINDOWS[w].label}` : WINDOWS[w].label}
									</option>
								))}
							</select>
						</div>
					</>
				)}
			</PageHeader>

			<div className="min-h-0 flex-1 overflow-y-auto">
				{firstRun ? (
					<FirstRunPanel />
				) : analytics ? (
					<IncidentAnalytics
						filter={q}
						days={WINDOWS[windowKey].days || 30}
						onWiden={() => setWindow("90d")}
					/>
				) : (
					<div className="px-4 pt-2 pb-12 md:px-6">
						<SetupLine />
						{isLoading ? null : listError ? (
							<p className="text-body text-danger">
								The board did not load: {listError.message}
							</p>
						) : (
							<>
								<IncidentBoard incidents={incidents} search={keep} />
								{incidents.length === 0 && (
									<p
										className="mt-2 text-body text-text-2"
										data-testid="incidents-window-empty"
									>
										Nothing in this window.{" "}
										<button
											type="button"
											className="text-accent hover:underline"
											onClick={() => {
												setQ("");
												setWindow("all");
											}}
										>
											Show all time
										</button>
									</p>
								)}
								{list?.pagination.hasMore && (
									<p className="mt-4 text-meta text-text-3">
										The 100 newest in this window
									</p>
								)}
							</>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
