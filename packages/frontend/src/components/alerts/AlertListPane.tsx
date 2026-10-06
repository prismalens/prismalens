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
import { useMemo } from "react";
import { Mono } from "@/components/shared/Mono";
import { LaneHeader, useLaneFolded } from "@/components/shared/ServiceLanes";
import { Empty, Loading, Problem } from "@/components/shared/State";
import { Button } from "@/components/ui/button";
import { useLayoutPrefs } from "@/hooks/use-layout-prefs";
import { useListKeyboard } from "@/hooks/use-list-keyboard";

import { useToast } from "@/hooks/use-toast";
import { alertKeys } from "@/lib/api/hooks/use-alerts-orpc";
import { useLiveRefreshInterval } from "@/lib/api/live-refresh";
import { orpc } from "@/lib/api/orpc-client";
import { formatClock, formatDate } from "@/lib/format-time";
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
					description: "Add one under Settings, Alert sources.",
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
	const sidebar = variant === "sidebar";
	const { search, listInput } = useAlertWindow();
	const keep = {
		tab: search.tab,
		status: search.status,
		severity: search.severity,
	};
	const interval = useLiveRefreshInterval();
	const { data, isLoading, error, refetch } = useQuery({
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
			: "No service";
		const ended = alert.status === "resolved" && alert.resolvedAt;
		const when = ended
			? `cleared ${dayOrClock(alert.resolvedAt ?? alert.triggeredAt)}`
			: dayOrClock(alert.triggeredAt);
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
				ref={selected ? scrollIntoView : undefined}
				className={cn(
					"group/row flex min-w-0 items-start gap-2.5 rounded-control px-2 py-1.5 text-body text-text-2 transition-colors duration-(--dur-instant) hover:bg-surface-3 hover:text-text-1",
					cursor === index && "bg-surface-3 text-text-1",
					selected && "bg-surface-4 text-text-1 hover:bg-surface-4",
				)}
			>
				<span
					role="img"
					aria-label={SEVERITY_LABEL[alert.severity]}
					className="mt-1.5 size-2 shrink-0 rounded-full"
					style={{ background: `var(--sev-${alert.severity})` }}
				/>
				<span className="min-w-0 flex-1">
					<span className="block truncate" data-testid="alert-row-title">
						{alert.title}
					</span>
					<span
						className={cn(
							"flex min-w-0 items-center gap-2 text-meta text-text-3 group-hover/row:text-text-2",
							(selected || cursor === index) && "text-text-2",
						)}
					>
						{!sidebar && alert.incident && (
							<Mono className="shrink-0">INC-{alert.incident.number}</Mono>
						)}
						<span className="min-w-0 truncate" data-testid="alert-row-meta">
							{service}, {when}
						</span>
					</span>
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
				className={cn(
					"min-h-0 flex-1",
					!sidebar && "overflow-y-auto px-2 pb-6 md:px-4",
				)}
				data-testid="alert-list"
			>
				{isLoading && <Loading className="px-4" />}
				{error && (
					<Problem
						className="px-4"
						text="The alert list did not load."
						onRetry={() => void refetch()}
					/>
				)}
				{!isLoading && !error && rows.length === 0 && (
					<Empty
						className="px-4"
						text="No alerts found."
						testId="alerts-empty-state"
						action={
							sidebar ? undefined : (
								<Button variant="text" size="sm" asChild>
									<Link to="/settings" search={{ tab: "sources" }}>
										Add an alert source
									</Link>
								</Button>
							)
						}
					/>
				)}
				{lanes.map((lane) => (
					<section
						key={lane.id}
						className={cn(
							"mt-2 rounded-surface p-1",
							sidebar ? "mx-2 bg-surface-2 shadow-raised" : "pool",
						)}
						data-testid={lane.testId}
					>
						<LaneHeader
							view="alerts"
							id={lane.id}
							name={lane.name}
							count={lane.items.length}
							className="h-6 px-2 pt-0 pb-0"
						/>
						{!laneFolded(lane.id) &&
							lane.items.map((alert) => alertRow(alert, index++))}
					</section>
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

/** Today an alert reads its clock time; older, its date. */
function dayOrClock(at: string): string {
	const d = new Date(at);
	return d.toDateString() === new Date().toDateString()
		? formatClock(d)
		: formatDate(d);
}

/** The open row stays in view when the record changes under it (L31). */
function scrollIntoView(el: HTMLElement | null) {
	el?.scrollIntoView({ block: "nearest" });
}

/** The word an alert's state reads (look ruling §1.3): Triggered is Firing. */
export function alertWord(status: AlertStatus): string {
	return status === "triggered" ? "Firing" : ALERT_STATUS_LABEL[status];
}
