// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	ALERT_STATUS_LABEL,
	ALERT_STATUS_PHASE,
	type AlertStatus,
	type AlertWithRelations,
	SEVERITY_LABEL,
	type StatePhase,
} from "@prismalens/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { BarChart3, CloudDownload, SlidersHorizontal } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { Mono } from "@/components/shared/Mono";
import { StateWord } from "@/components/shared/StateChip";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useListKeyboard } from "@/hooks/use-list-keyboard";
import { ago, useNow } from "@/hooks/use-now";
import { useToast } from "@/hooks/use-toast";
import { alertKeys } from "@/lib/api/hooks/use-alerts-orpc";
import { orpc } from "@/lib/api/orpc-client";
import { alertStatusTone } from "@/lib/state-tone";
import { cn } from "@/lib/utils";
import { AlertFilters } from "./AlertFilters";

export interface AlertListPaneProps {
	selectedId: string | null;
	className?: string;
}

/** The list query from the frame's search. `unassigned` filters server-side (limit caps at 100). */
export function useAlertWindow() {
	const search = useSearch({ from: "/_authenticated/alerts" });
	return {
		search,
		listInput: {
			...(search.status && { status: search.status }),
			...(search.severity && { severity: search.severity }),
			...(search.tab === "unmapped" && { unassigned: true }),
			limit: 100,
		},
	};
}

const PHASE_ORDER: Record<StatePhase, number> = {
	new: 0,
	live: 1,
	watch: 2,
	done: 3,
	failed: 3,
	closed: 4,
};

/** Firing first, then in play, then ended; the API's order inside each group. */
export function orderAlerts(alerts: AlertWithRelations[]) {
	return [...alerts].sort(
		(a, b) =>
			PHASE_ORDER[ALERT_STATUS_PHASE[a.status]] -
			PHASE_ORDER[ALERT_STATUS_PHASE[b.status]],
	);
}

/**
 * The intake queue as a pane: every alert in the window, the ones still firing
 * first, one row each, beside the selected alert's record.
 */
export function AlertListPane({ selectedId, className }: AlertListPaneProps) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const now = useNow();
	const { search, listInput } = useAlertWindow();
	const keep = {
		tab: search.tab,
		status: search.status,
		severity: search.severity,
		view: search.view,
	};
	const [filtersOpen, setFiltersOpen] = useState(
		!!(search.status || search.severity),
	);

	const { data, isLoading, error } = useQuery(
		orpc.alerts.list.queryOptions({ input: listInput }),
	);
	const { data: stats } = useQuery(
		orpc.alerts.getStats.queryOptions({ input: {} }),
	);
	const alerts = data?.data ?? [];
	const rows = useMemo(() => orderAlerts(alerts), [alerts]);
	const firing = rows.filter((a) => a.status === "triggered").length;

	const pull = useMutation({
		...orpc.alerts.pull.mutationOptions(),
		onSuccess: (result) => {
			if (result.errors.length > 0 && result.sources === 0) {
				toast({
					title: "Pull failed",
					description: result.errors.join("; "),
					variant: "destructive",
				});
				return;
			}
			if (result.sources === 0) {
				toast({
					title: "No Alertmanager or Prometheus connection is configured",
					description: "Add a connection under Settings → Integrations.",
				});
				return;
			}
			toast({
				title: `Pulled ${result.received + result.caughtUp} alerts, ${result.processed} new, ${result.caughtUp} caught up`,
				description:
					result.errors.length > 0 ? result.errors.join("; ") : undefined,
				variant: result.errors.length > 0 ? "destructive" : undefined,
			});
			queryClient.invalidateQueries({ queryKey: alertKeys.all() });
		},
		onError: (e) =>
			toast({
				title: "Pull failed",
				description: e.message,
				variant: "destructive",
			}),
	});

	const open = (alert: AlertWithRelations) =>
		navigate({ to: "/alerts/$id", params: { id: alert.id }, search: keep });
	const { cursor, setCursor } = useListKeyboard(rows.length, (i) => {
		const row = rows[i];
		if (row) open(row);
	});

	const setFilter = (patch: Partial<typeof search>) =>
		navigate({
			to: ".",
			search: (prev) => ({ ...prev, ...patch }),
			replace: true,
		});

	return (
		<aside
			className={cn("flex flex-col bg-background", className)}
			data-testid="alert-list-pane"
		>
			<div className="flex items-center justify-between gap-2 border-b px-3 py-2">
				<h1 className="text-sm font-semibold">Alerts</h1>
				<div className="flex items-center gap-1">
					<Button
						variant="ghost"
						size="sm"
						className="h-7 w-7 p-0"
						aria-label="Filters"
						aria-pressed={filtersOpen}
						onClick={() => setFiltersOpen((v) => !v)}
						data-testid="alert-list-filters-toggle"
					>
						<SlidersHorizontal className="h-3.5 w-3.5" />
					</Button>
					<Button
						asChild
						variant={search.view === "stats" ? "secondary" : "ghost"}
						size="sm"
						className="h-7 w-7 p-0"
					>
						<Link
							to="/alerts"
							search={{ ...keep, view: "stats" }}
							aria-label="Numbers"
							data-testid="alerts-view-stats"
						>
							<BarChart3 className="h-3.5 w-3.5" />
						</Link>
					</Button>
					<Button
						variant="outline"
						size="sm"
						className="h-7"
						onClick={() => pull.mutate({})}
						disabled={pull.isPending}
						data-testid="alerts-pull"
					>
						<CloudDownload
							className={cn(
								"mr-1 h-3.5 w-3.5",
								pull.isPending && "animate-pulse",
							)}
						/>
						Pull
					</Button>
				</div>
			</div>

			<div className="border-b px-3 py-1.5">
				<Tabs
					value={search.tab ?? "all"}
					onValueChange={(v) =>
						setFilter({ tab: v === "unmapped" ? "unmapped" : undefined })
					}
				>
					<TabsList className="h-7">
						<TabsTrigger value="all" className="h-6 text-meta">
							All Alerts
						</TabsTrigger>
						<TabsTrigger value="unmapped" className="h-6 text-meta">
							Unmapped
						</TabsTrigger>
					</TabsList>
				</Tabs>
			</div>

			{filtersOpen && (
				<div className="border-b px-3 py-2" data-testid="alert-list-filters">
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

			<div className="min-h-0 flex-1 overflow-y-auto" data-testid="alert-list">
				{isLoading && (
					<div className="space-y-2 p-3">
						{[1, 2, 3, 4, 5].map((k) => (
							<Skeleton key={k} className="h-11" />
						))}
					</div>
				)}
				{error && (
					<p className="p-3 text-record text-run-failed">
						The list did not load: {error.message}
					</p>
				)}
				{!isLoading && !error && rows.length === 0 && (
					<div className="p-3" data-testid="alerts-empty-state">
						<p className="rounded-md border border-dashed p-3 text-record text-muted-foreground">
							No alerts found. Point an alert source at the webhook, or pull
							from Alertmanager.
						</p>
					</div>
				)}
				{rows.map((alert, index) => {
					const selected = alert.id === selectedId;
					const firstEnded =
						index > 0 &&
						PHASE_ORDER[ALERT_STATUS_PHASE[alert.status]] >= 3 &&
						PHASE_ORDER[ALERT_STATUS_PHASE[rows[index - 1].status]] < 3;
					return (
						<Fragment key={alert.id}>
							{index === 0 && firing > 0 && (
								<GroupLabel
									label="Firing"
									count={firing}
									testId="group-firing"
								/>
							)}
							{index === firing &&
								firing > 0 &&
								index < rows.length &&
								PHASE_ORDER[ALERT_STATUS_PHASE[alert.status]] < 3 && (
									<GroupLabel
										label="In play"
										count={
											rows.filter(
												(a) =>
													a.status !== "triggered" &&
													PHASE_ORDER[ALERT_STATUS_PHASE[a.status]] < 3,
											).length
										}
										testId="group-in-play"
									/>
								)}
							{firstEnded && (
								<GroupLabel
									label="Ended"
									count={
										rows.filter(
											(a) => PHASE_ORDER[ALERT_STATUS_PHASE[a.status]] >= 3,
										).length
									}
									testId="group-ended"
								/>
							)}
							<Link
								to="/alerts/$id"
								params={{ id: alert.id }}
								search={keep}
								onMouseEnter={() => setCursor(index)}
								aria-current={selected ? "page" : undefined}
								data-testid="alert-row-link"
								data-cursor={cursor === index ? "true" : undefined}
								className={cn(
									"block border-b px-3 py-2 outline-none",
									cursor === index && "bg-muted/60",
									selected &&
										"bg-primary/8 shadow-[inset_2px_0_0_var(--primary)]",
								)}
							>
								<div className="flex items-start gap-2">
									<span
										role="img"
										aria-label={SEVERITY_LABEL[alert.severity]}
										title={SEVERITY_LABEL[alert.severity]}
										className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
										style={{ background: `var(--sev-${alert.severity})` }}
									/>
									<div className="min-w-0 flex-1">
										<p
											className="truncate text-record font-medium leading-snug"
											title={alert.title}
										>
											{alert.title}
										</p>
										<div className="mt-0.5 flex items-center gap-x-2 text-meta text-muted-foreground">
											<StateWord tone={alertStatusTone(alert.status)}>
												{ALERT_STATUS_LABEL[alert.status as AlertStatus] ??
													alert.status}
											</StateWord>
											{alert.incident && (
												<Mono className="shrink-0">
													INC-{alert.incident.number}
												</Mono>
											)}
											{alert.service && (
												<span className="truncate">
													{alert.service.displayName || alert.service.name}
												</span>
											)}
											<span className="ml-auto shrink-0 tabular-nums">
												{ago(alert.triggeredAt, now)}
											</span>
										</div>
									</div>
								</div>
							</Link>
						</Fragment>
					);
				})}
			</div>

			<div className="flex items-center justify-between border-t px-3 py-1.5 text-meta text-muted-foreground">
				<span>
					<span data-testid="alerts-total-count">
						{stats?.total ?? rows.length}
					</span>{" "}
					total
					{data?.pagination.hasMore ? " · more not shown" : ""}
				</span>
				<span>j k ↵</span>
			</div>
		</aside>
	);
}

function GroupLabel({
	label,
	count,
	testId,
}: {
	label: string;
	count: number;
	testId: string;
}) {
	return (
		<div
			className="sticky top-0 z-10 border-b bg-muted/40 px-3 py-1 text-meta font-medium text-muted-foreground backdrop-blur"
			data-testid={testId}
		>
			{label} <span className="tabular-nums">{count}</span>
		</div>
	);
}
