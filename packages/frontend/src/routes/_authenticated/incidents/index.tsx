/**
 * The incidents landing (#743 §3c, layer 0): the board, four columns in the
 * order an SRE asks. `?view=analytics` keeps the window's numbers, severity
 * mix and charts. Below `lg` the frame shows the list instead, which is the
 * board folded.
 */
import {
	type IncidentWithRelations,
	isIncidentOpen,
} from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import {
	CreateIncidentDialog,
	DateRangeFilter,
	FirstRunPanel,
	IncidentAnalytics,
	QueueStats,
} from "@/components/incidents";
import { IncidentBoard } from "@/components/incidents/IncidentBoard";
import { useIncidentWindow } from "@/components/incidents/IncidentListPane";
import { Mono } from "@/components/shared/Mono";
import { Segmented } from "@/components/shared/Segmented";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/hooks/use-page-title";
import { LIVE_REFRESH_MS } from "@/lib/api/live-refresh";
import { orpc } from "@/lib/api/orpc-client";
import { attentionFor } from "@/lib/incident-attention";
import type { IncidentsSearch } from "./route";

export const Route = createFileRoute("/_authenticated/incidents/")({
	component: IncidentsLanding,
});

function matches(incident: IncidentWithRelations, needle: string) {
	return (
		incident.title.toLowerCase().includes(needle) ||
		`inc-${incident.number}`.includes(needle) ||
		(incident.service?.name ?? "").toLowerCase().includes(needle)
	);
}

function IncidentsLanding() {
	usePageTitle("Incidents");
	const navigate = useNavigate();
	const { search, from, to, listInput, statsInput, windowLabel } =
		useIncidentWindow();
	const analytics = search.view === "analytics";
	const [q, setQ] = useState("");
	const [createOpen, setCreateOpen] = useState(false);
	const workspace = useQuery(
		orpc.incidents.getStats.queryOptions({ input: {} }),
	);
	const {
		data: list,
		isLoading,
		error: listError,
	} = useQuery({
		...orpc.incidents.list.queryOptions({ input: listInput }),
		refetchInterval: LIVE_REFRESH_MS,
	});
	const keep = {
		status: search.status,
		severity: search.severity,
		priority: search.priority,
		open: search.open,
		from: search.from,
		to: search.to,
	};
	const setSearch = (patch: Partial<typeof search>) =>
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
	const numbers = useMemo(() => {
		const open = incidents.filter((i) => isIncidentOpen(i.status));
		return {
			open: open.length,
			critical: open.filter((i) => i.severity === "critical").length,
			needsYou: incidents.filter((i) => attentionFor(i) !== null).length,
		};
	}, [incidents]);
	const firstRun = workspace.data?.total === 0;
	const windowValue = search.from
		? Math.round((Date.now() - new Date(search.from).getTime()) / 86_400_000) <=
			1
			? "1d"
			: Math.round(
						(Date.now() - new Date(search.from).getTime()) / 86_400_000,
					) <= 7
				? "7d"
				: "30d"
		: "all";
	const setWindow = (v: string) => {
		const days = v === "1d" ? 1 : v === "7d" ? 7 : v === "30d" ? 30 : 0;
		setSearch({
			from: days
				? new Date(Date.now() - days * 86_400_000).toISOString()
				: undefined,
			to: undefined,
		});
	};

	return (
		<div
			className="flex h-full min-h-0 flex-col"
			data-testid="incidents-overview"
		>
			<div className="flex h-10 shrink-0 items-center gap-3 border-b px-4">
				<h1 className="text-sm font-semibold">Incidents</h1>
				<Segmented
					label="View"
					value={analytics ? "analytics" : "board"}
					onChange={(v) =>
						setSearch({ view: v === "analytics" ? "analytics" : undefined })
					}
					options={[
						{ value: "board", label: "Board" },
						{ value: "analytics", label: "Analytics" },
					]}
					testId="incidents-view"
				/>
				{!analytics && !firstRun && (
					<span
						className="hidden items-center gap-3 whitespace-nowrap text-meta text-muted-foreground tabular-nums 2xl:flex"
						data-testid="board-numbers"
					>
						<span>{numbers.open} open</span>
						<span>{numbers.critical} critical</span>
						<span>
							{numbers.needsYou} {numbers.needsYou === 1 ? "needs" : "need"} you
						</span>
					</span>
				)}
				<div className="ml-auto flex items-center gap-1">
					{!analytics && (
						<>
							<label className="flex w-44 items-center gap-1.5 rounded border bg-background px-2">
								<Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
								<input
									value={q}
									onChange={(e) => setQ(e.target.value)}
									placeholder="Filter"
									aria-label="Filter incidents"
									className="h-6 min-w-0 flex-1 bg-transparent text-meta outline-none placeholder:text-muted-foreground"
									data-testid="board-search"
								/>
							</label>
							<select
								value={windowValue}
								onChange={(e) => setWindow(e.target.value)}
								aria-label="Window"
								className="h-6 rounded border bg-background px-1 text-meta text-muted-foreground outline-none"
								data-testid="board-window"
							>
								<option value="all">All time</option>
								<option value="1d">24 hours</option>
								<option value="7d">7 days</option>
								<option value="30d">30 days</option>
							</select>
						</>
					)}
					<Button
						size="sm"
						className="h-7"
						onClick={() => setCreateOpen(true)}
						data-testid="board-create-incident"
					>
						<Plus className="h-3.5 w-3.5" />
						New
					</Button>
				</div>
			</div>

			{analytics ? (
				<AnalyticsView
					search={search}
					setSearch={setSearch}
					listed={!!list}
					from={from}
					to={to}
					statsInput={statsInput}
					windowLabel={windowLabel}
					loaded={list?.data ?? []}
					limit={listInput.limit}
				/>
			) : isLoading ? null : listError ? (
				<p className="p-4 text-record text-run-failed">
					The board did not load: {listError.message}
				</p>
			) : (
				<>
					<IncidentBoard
						incidents={incidents}
						search={keep}
						empty={
							firstRun ? (
								<FirstRunPanel />
							) : incidents.length === 0 ? (
								<p
									className="p-3 text-record text-muted-foreground"
									data-testid="incidents-window-empty"
								>
									Nothing in this window.{" "}
									<button
										type="button"
										className="text-primary hover:underline"
										onClick={() => {
											setQ("");
											setSearch({ from: undefined, to: undefined });
										}}
									>
										Show all time
									</button>
								</p>
							) : undefined
						}
					/>
					<div className="flex h-7 shrink-0 items-center gap-3 px-4 text-meta text-muted-foreground">
						<span className="tabular-nums">
							{incidents.length} in window
							{list?.pagination.hasMore ? ", more not shown" : ""}
						</span>
						<span className="ml-auto flex items-center gap-1">
							<Mono>1</Mono>
							<span>to</span>
							<Mono>4</Mono>
							<span>jump to a column</span>
						</span>
					</div>
				</>
			)}

			<CreateIncidentDialog
				open={createOpen}
				onOpenChange={setCreateOpen}
				onCreated={(id) =>
					navigate({ to: "/incidents/$id", params: { id }, search: keep })
				}
			/>
		</div>
	);
}

/** Board | Analytics: the window's numbers, severity mix and charts as before #743. */
function AnalyticsView({
	search,
	setSearch,
	from: fromDate,
	to: toDate,
	statsInput: input,
	windowLabel: label,
	loaded,
	listed,
	limit,
}: {
	search: IncidentsSearch;
	setSearch: (patch: Partial<IncidentsSearch>) => void;
	from?: Date;
	to?: Date;
	statsInput: { fromDate?: Date; toDate?: Date };
	windowLabel: string;
	loaded: IncidentWithRelations[];
	listed: boolean;
	limit: number;
}) {
	const navigate = useNavigate();
	const stats = useQuery({
		...orpc.incidents.getStats.queryOptions({ input }),
		refetchInterval: LIVE_REFRESH_MS,
	});
	const windowEmpty = listed && loaded.length === 0;
	const chartDays =
		fromDate && toDate
			? Math.ceil((toDate.getTime() - fromDate.getTime()) / 86_400_000)
			: spanDays(loaded);
	// The charts stop at `chartDays`; the totals count the same incidents.
	const charted =
		fromDate && toDate
			? loaded
			: loaded.filter(
					(i) =>
						Date.now() - new Date(i.triggeredAt).getTime() <
						chartDays * 86_400_000,
				);
	return (
		<div className="min-h-0 flex-1 overflow-y-auto">
			<div className="mx-auto max-w-4xl space-y-4 px-4 py-4 sm:px-6">
				<DateRangeFilter
					value={{ from: fromDate, to: toDate }}
					onChange={(v) =>
						setSearch({
							from: v.from?.toISOString(),
							to: v.to?.toISOString(),
						})
					}
				/>
				{!windowEmpty && (
					<QueueStats
						stats={stats.data}
						isLoading={stats.isLoading}
						error={stats.error}
						updatedAt={stats.dataUpdatedAt}
						onRetry={() => stats.refetch()}
						window={label}
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
					<p className="rounded-md border border-dashed p-3 text-record text-muted-foreground">
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
				{!windowEmpty && !(fromDate && toDate) && (
					<p
						className="text-meta text-muted-foreground"
						data-testid="analytics-scope"
					>
						Last {chartDays} days
						{loaded.length >= limit && `, the ${limit} most recent incidents`}
					</p>
				)}
				{!windowEmpty && (
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

/** With no window, the charts start at the oldest incident loaded, capped at a year. */
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
