/**
 * The incidents landing (#811): the inbox, All incidents with `?view=all`, or
 * Analytics with `?view=analytics`. A workspace with no incidents shows only
 * the first-run steps. The text filter narrows what is loaded, on the client.
 */
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { AllIncidents } from "@/components/inbox/AllIncidents";
import { InboxTiles } from "@/components/inbox/InboxTiles";
import { groupNeeds, matches } from "@/components/inbox/inbox-model";
import { NeedsYou } from "@/components/inbox/NeedsYou";
import {
	RecentlyResolved,
	SetupCard,
} from "@/components/inbox/RecentlyResolved";
import {
	useActiveIncidents,
	useRecentlyResolved,
} from "@/components/inbox/use-inbox-data";
import { IncidentAnalytics } from "@/components/incidents/analytics/IncidentAnalytics";
import {
	FirstRunPanel,
	SetupLine,
	useSetupProgress,
} from "@/components/incidents/FirstRunPanel";
import { TelemetryConsent } from "@/components/settings/TelemetrySettings";
import { Segmented } from "@/components/shared/Segmented";
import { Empty, Problem } from "@/components/shared/State";
import { PageHeader } from "@/components/shell/PageHeader";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useNow } from "@/hooks/use-now";
import { usePageTitle } from "@/hooks/use-page-title";
import { useLiveRefreshInterval } from "@/lib/api/live-refresh";
import { orpc } from "@/lib/api/orpc-client";
import type { IncidentsSearch } from "./route";

export const Route = createFileRoute("/_authenticated/incidents/")({
	component: IncidentsLanding,
});

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

type View = "inbox" | "all" | "analytics";

function IncidentsLanding() {
	const navigate = useNavigate();
	const search = Route.useSearch() as IncidentsSearch;
	const view: View = search.view ?? "inbox";
	usePageTitle(
		view === "analytics"
			? "Analytics, Incidents"
			: view === "all"
				? "All incidents"
				: "Incidents",
	);
	const [q, setQ] = useState("");
	const now = useNow(30_000);
	const workspace = useQuery({
		...orpc.incidents.getStats.queryOptions({ input: {} }),
		refetchInterval: useLiveRefreshInterval(),
	});
	const setSearch = (patch: Partial<IncidentsSearch>) =>
		navigate({
			to: ".",
			search: (prev) => ({ ...prev, ...patch }),
			replace: true,
		});
	const firstRun = workspace.data?.total === 0;
	const windowKey = windowOf(search.from);
	const setWindow = (key: WindowKey) => {
		const days = WINDOWS[key].days;
		setSearch({
			from: days ? new Date(Date.now() - days * DAY).toISOString() : undefined,
			to: undefined,
		});
	};
	const windows: WindowKey[] =
		view === "analytics" ? ["7d", "30d", "90d"] : ["all", "1d", "7d", "30d"];
	// All time on All incidents reads as Analytics' 30 days, label and figures alike.
	const viewKey: WindowKey = windows.includes(windowKey)
		? windowKey
		: windows[1];

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
							value={view}
							onChange={(v) =>
								setSearch({
									view: v === "inbox" ? undefined : v,
									...(v === "analytics" && !search.from
										? {
												from: new Date(Date.now() - 30 * DAY).toISOString(),
											}
										: {}),
								})
							}
							options={[
								{ value: "inbox", label: "Inbox" },
								{ value: "all", label: "All incidents" },
								{ value: "analytics", label: "Analytics" },
							]}
							testId="incidents-view"
						/>
						<div className="flex basis-full items-center gap-2 md:grow-[999] md:basis-auto md:justify-end">
							<label className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-control bg-surface-2 px-2.5 md:w-40 md:flex-none">
								<Search className="size-3.5 shrink-0 text-text-3" />
								<input
									type="search"
									value={q}
									onChange={(e) => setQ(e.target.value)}
									placeholder="Filter"
									aria-label="Filter incidents"
									className="h-6 min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-text-3 md:text-body"
									data-testid="incidents-filter"
								/>
							</label>
							{view !== "inbox" && (
								<Select
									value={viewKey}
									onValueChange={(v) => setWindow(v as WindowKey)}
								>
									<SelectTrigger aria-label="Window" data-testid="board-window">
										<SelectValue />
									</SelectTrigger>
									<SelectContent align="end">
										{windows.map((w) => (
											<SelectItem key={w} value={w}>
												{view === "analytics"
													? `Last ${WINDOWS[w].label}`
													: WINDOWS[w].label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							)}
						</div>
					</>
				)}
			</PageHeader>
			{view === "inbox" && (
				<div className="px-4">
					<TelemetryConsent />
				</div>
			)}
			<div className="min-h-0 flex-1 overflow-y-auto">
				{firstRun ? (
					<FirstRunPanel />
				) : view === "analytics" ? (
					<IncidentAnalytics
						filter={q}
						days={WINDOWS[viewKey].days}
						onWiden={() => setWindow("90d")}
					/>
				) : view === "all" ? (
					<div className="px-4 pt-3 pb-6">
						<AllIncidents
							search={search}
							setSearch={setSearch}
							filter={q.trim().toLowerCase()}
							now={now ?? Date.now()}
						/>
					</div>
				) : (
					<Inbox filter={q.trim().toLowerCase()} now={now} />
				)}
			</div>
		</div>
	);
}

/** The inbox (spec §1): tiles, Needs you, Recently resolved. */
function Inbox({ filter, now }: { filter: string; now: number | null }) {
	const active = useActiveIncidents();
	const recent = useRecentlyResolved();
	const setup = useSetupProgress();
	const loading = active.isLoading || !setup.loaded || now === null;
	const groups = useMemo(
		() => groupNeeds(active.incidents.filter((i) => matches(i, filter))),
		[active.incidents, filter],
	);
	return (
		<div
			className="flex flex-col gap-5 px-4 pt-3 pb-6"
			aria-busy={loading || undefined}
			data-testid="inbox"
		>
			<InboxTiles
				incidents={active.incidents}
				now={now ?? 0}
				agentReady={setup.steps.agent}
				loading={loading}
			/>
			{loading ? (
				<section className="flex flex-col gap-2" aria-label="Needs you">
					<h2 className="text-title">Needs you</h2>
					<div className="pool flex flex-col gap-2.5 px-4 py-3.5">
						<div className="shimmer h-3.5 w-[30%] rounded-[4px]" />
						{[0, 1, 2].map((i) => (
							<div key={i} className="shimmer h-9 rounded-control" />
						))}
					</div>
				</section>
			) : active.error && active.incidents.length === 0 ? (
				<Problem
					text="The inbox did not load."
					onRetry={() => active.refetch()}
				/>
			) : !setup.steps.agent ? (
				<section className="flex flex-col gap-2" aria-label="Needs you">
					<h2 className="text-title">Needs you</h2>
					<SetupCard done={setup.done} />
				</section>
			) : (
				<>
					<SetupLine />
					{groups.length > 0 ? (
						<NeedsYou groups={groups} now={now ?? 0} />
					) : (
						<section className="flex flex-col gap-2" aria-label="Needs you">
							<h2 className="text-title">Needs you</h2>
							<Empty
								text={filter ? "Nothing matches." : "Nothing needs you."}
								testId="needs-empty"
							/>
						</section>
					)}
				</>
			)}
			{now !== null && (
				<RecentlyResolved
					rows={recent.rows.filter((i) => matches(i, filter))}
					now={now}
				/>
			)}
		</div>
	);
}
