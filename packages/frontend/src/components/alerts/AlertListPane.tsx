// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	ALERT_STATUS_PHASE,
	type AlertStatus,
	type AlertWithRelations,
	SEVERITY_LABEL,
	type StatePhase,
} from "@prismalens/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Fragment, useMemo } from "react";
import { Mono } from "@/components/shared/Mono";
import { LaneHeader, useLaneFolded } from "@/components/shared/ServiceLanes";
import { Skeleton } from "@/components/ui/skeleton";
import { useLayoutPrefs } from "@/hooks/use-layout-prefs";
import { useListKeyboard } from "@/hooks/use-list-keyboard";
import { ago, useNow } from "@/hooks/use-now";
import { useToast } from "@/hooks/use-toast";
import { alertKeys } from "@/lib/api/hooks/use-alerts-orpc";
import { useLiveRefreshInterval } from "@/lib/api/live-refresh";
import { orpc } from "@/lib/api/orpc-client";
import { alertLanes } from "@/lib/service-lanes";
import { cn } from "@/lib/utils";
import type { AlertsSearch } from "@/routes/_authenticated/alerts/route";

export interface AlertListPaneProps {
	selectedId: string | null;
	className?: string;
	/** In the sidebar one line a row; as a page, the state, incident and age under it. */
	variant?: "sidebar" | "page";
}

/** The list query from the frame's search. `unassigned` filters server-side (limit caps at 100). */
export function useAlertWindow() {
	// The sidebar renders the list before the alerts route matches.
	const search: AlertsSearch =
		useSearch({ from: "/_authenticated/alerts", shouldThrow: false }) ?? {};
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

/** Pulls the firing alerts from every configured source now. */
export function usePullAlerts() {
	const queryClient = useQueryClient();
	const { toast } = useToast();
	return useMutation({
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
}

const GROUPS: {
	phase: (s: AlertStatus) => boolean;
	label: string;
	testId: string;
}[] = [
	{ phase: (s) => s === "triggered", label: "Firing", testId: "group-firing" },
	{
		phase: (s) => s !== "triggered" && PHASE_ORDER[ALERT_STATUS_PHASE[s]] < 3,
		label: "In play",
		testId: "group-in-play",
	},
	{
		phase: (s) => PHASE_ORDER[ALERT_STATUS_PHASE[s]] >= 3,
		label: "Ended",
		testId: "group-ended",
	},
];

/**
 * The alert list: firing first, one row each. The sidebar's list from 1280,
 * and the page itself on narrower screens, never both (study-v3 §8).
 */
export function AlertListPane({
	selectedId,
	className,
	variant = "page",
}: AlertListPaneProps) {
	const navigate = useNavigate();
	const now = useNow();
	const sidebar = variant === "sidebar";
	const { search, listInput } = useAlertWindow();
	const keep = {
		tab: search.tab,
		status: search.status,
		severity: search.severity,
	};
	const interval = useLiveRefreshInterval();
	const { data, isLoading, error } = useQuery({
		...orpc.alerts.list.queryOptions({ input: listInput }),
		refetchInterval: interval,
	});
	const alerts = data?.data ?? [];
	const rows = useMemo(() => orderAlerts(alerts), [alerts]);

	const open = (alert: AlertWithRelations) =>
		navigate({ to: "/alerts/$id", params: { id: alert.id }, search: keep });
	const { alertsGroupBy } = useLayoutPrefs();
	const grouped = alertsGroupBy === "service";
	const laneFolded = useLaneFolded("alerts");
	const lanes = useMemo(
		() =>
			grouped
				? alertLanes(rows).map((l) => ({ ...l, testId: "service-group" }))
				: GROUPS.map((g) => ({
						id: g.label,
						name: g.label,
						testId: g.testId,
						items: rows.filter((a) => g.phase(a.status as AlertStatus)),
					})).filter((g) => g.items.length > 0),
		[grouped, rows],
	);
	const flat = useMemo(
		() => lanes.flatMap((l) => (laneFolded(l.id) ? [] : l.items)),
		[lanes, laneFolded],
	);
	const { cursor, pointAt } = useListKeyboard(flat.length, (i) => {
		const row = flat[i];
		if (row) open(row);
	});

	const alertRow = (alert: AlertWithRelations, index: number) => {
		const selected = alert.id === selectedId;
		const service = alert.service
			? alert.service.displayName || alert.service.name
			: null;
		return (
			<Link
				key={alert.id}
				to="/alerts/$id"
				params={{ id: alert.id }}
				search={keep}
				onMouseEnter={() => pointAt(index)}
				aria-current={selected ? "page" : undefined}
				data-testid="alert-row-link"
				data-cursor={cursor === index ? "true" : undefined}
				title={alert.title}
				className={cn(
					"flex min-w-0 items-start gap-2.5 rounded-control px-2.5 text-body text-text-2 outline-none hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-accent",
					sidebar ? "mx-2 py-1.5" : "mx-2 py-2",
					cursor === index && "bg-surface-3",
					selected && "bg-surface-3 text-text-1",
				)}
			>
				<span
					role="img"
					aria-label={SEVERITY_LABEL[alert.severity]}
					className="mt-1.5 size-2 shrink-0 rounded-full"
					style={{ background: `var(--sev-${alert.severity})` }}
				/>
				<span className="min-w-0 flex-1">
					<span className="flex min-w-0 items-baseline gap-1.5">
						<span className="min-w-0 truncate">{alert.title}</span>
						{sidebar && service && (
							<span className="min-w-8 shrink-[3] truncate text-meta text-text-3">
								{service}
							</span>
						)}
					</span>
					{!sidebar && (
						<span className="mt-0.5 flex min-w-0 items-center gap-2.5 text-meta">
							{alert.incident && (
								<Mono className="shrink-0 text-text-3">
									INC-{alert.incident.number}
								</Mono>
							)}
							{service && (
								<span className="truncate text-text-2">{service}</span>
							)}
							<span className="ml-auto shrink-0 text-text-3 tabular-nums">
								{ago(alert.triggeredAt, now)}
							</span>
						</span>
					)}
				</span>
			</Link>
		);
	};

	let index = 0;
	return (
		<section
			className={cn("flex min-h-0 flex-col", className)}
			data-testid="alert-list-pane"
			aria-label="Alerts"
		>
			<div
				className={cn("min-h-0 flex-1", !sidebar && "overflow-y-auto pb-6")}
				data-testid="alert-list"
			>
				{isLoading && (
					<div className="space-y-3 px-4 py-2">
						{[1, 2, 3, 4].map((k) => (
							<Skeleton key={k} className="h-3" />
						))}
					</div>
				)}
				{error && (
					<p className="px-4 py-2 text-body text-text-1">
						The list did not load: {error.message}
					</p>
				)}
				{!isLoading && !error && rows.length === 0 && (
					<p
						className="px-4 py-2 text-body text-text-2"
						data-testid="alerts-empty-state"
					>
						No alerts found. Sources are under Settings, Integrations.
					</p>
				)}
				{lanes.map((lane) => (
					<Fragment key={lane.id}>
						<div className="px-2" data-testid={lane.testId}>
							<LaneHeader
								view="alerts"
								id={lane.id}
								name={lane.name}
								count={lane.items.length}
							/>
						</div>
						{!laneFolded(lane.id) &&
							lane.items.map((alert) => alertRow(alert, index++))}
					</Fragment>
				))}
				{data?.pagination.hasMore && (
					<p className="px-4 py-2 text-meta text-text-3">
						The 100 newest in this window
					</p>
				)}
			</div>
		</section>
	);
}
