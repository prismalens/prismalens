// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type IncidentWithRelations,
	isAlertFiring,
	OPEN_ALERT_STATUSES,
} from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link, type LinkProps } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { useServices } from "@/lib/api/hooks";
import { useLiveRefreshInterval } from "@/lib/api/live-refresh";
import { orpc } from "@/lib/api/orpc-client";
import { incidentServices } from "@/lib/service-lanes";
import { cn } from "@/lib/utils";
import { ago, firingOf, gettingWorse, newlyFiring } from "./inbox-model";

type Dot = "danger" | "warn" | "ok";

interface Tile {
	key: string;
	label: string;
	value: string;
	sub: string;
	dot: Dot;
	hot?: boolean;
	link: LinkProps;
}

const DAY = 86_400_000;
const plural = (n: number, one: string, many = `${one}s`) =>
	`${n} ${n === 1 ? one : many}`;

/** The three tiles above Needs you (spec §1); Agent replaces Getting worse until one is set up. */
export function InboxTiles({
	incidents,
	now,
	agentReady,
	loading,
}: {
	incidents: IncidentWithRelations[];
	now: number;
	agentReady: boolean;
	loading: boolean;
}) {
	const interval = useLiveRefreshInterval();
	const stats = useQuery({
		...orpc.alerts.getStats.queryOptions({ input: {} }),
		refetchInterval: interval,
	});
	const resolved = useQuery({
		...orpc.alerts.list.queryOptions({
			input: { status: "resolved", limit: 100 },
		}),
		refetchInterval: interval,
	});
	const services = useServices();

	const tiles = useMemo<Tile[] | null>(() => {
		if (loading || !stats.data || !services.data) return null;
		const firing = OPEN_ALERT_STATUSES.reduce(
			(n, s) => n + (stats.data.byStatus[s] ?? 0),
			0,
		);
		const cleared = (resolved.data?.data ?? []).filter(
			(a) => a.resolvedAt && now - new Date(a.resolvedAt).getTime() < DAY,
		);
		const lastCleared = (resolved.data?.data ?? [])
			.map((a) => a.resolvedAt)
			.filter((v): v is string => !!v)
			.sort()
			.at(-1);
		const alerts: Tile = {
			key: "alerts",
			label: "Alerts",
			value: firing > 0 ? `${firing} firing` : "Nothing firing",
			sub:
				cleared.length > 0
					? `${cleared.length} cleared in the last day`
					: lastCleared
						? `Last alert cleared ${ago(lastCleared, now)} ago`
						: "No alert has cleared yet",
			dot: firing > 0 ? "danger" : "ok",
			link: { to: "/alerts" },
		};

		const all = services.data.data;
		const state = new Map<string, "worse" | "degraded">();
		for (const i of incidents) {
			const f = firingOf(i, now);
			if (f !== "worse" && f !== "steady") continue;
			for (const s of incidentServices(i)) {
				if (state.get(s.id) !== "worse")
					state.set(s.id, f === "worse" ? "worse" : "degraded");
			}
		}
		const named = (id: string) => {
			const s = all.find((x) => x.id === id);
			return s ? s.displayName || s.name : null;
		};
		const degraded = Array.from(state.keys()).filter((id) => named(id));
		const worse = degraded.filter((id) => state.get(id) === "worse");
		const servicesTile: Tile = {
			key: "services",
			label: "Services",
			value:
				all.length === 0
					? "None yet"
					: degraded.length > 0
						? `${degraded.length} of ${all.length} degraded`
						: `${all.length} of ${all.length} healthy`,
			sub:
				all.length === 0
					? "Add the services your alerts come from"
					: worse.length > 0
						? `${worse.map(named).join(", ")} getting worse`
						: degraded.length > 0
							? degraded.map(named).join(", ")
							: all.map((s) => s.displayName || s.name).join(", "),
			dot: degraded.length > 0 ? "warn" : "ok",
			link: { to: "/services" },
		};

		if (!agentReady) {
			return [
				alerts,
				servicesTile,
				{
					key: "agent",
					label: "Agent",
					value: "Not set up",
					sub: "Investigations wait until one is",
					dot: "warn",
					link: { to: "/settings", search: { tab: "harness" } },
				},
			];
		}

		const top = gettingWorse(incidents, now);
		const worseTile: Tile = top
			? {
					key: "worse",
					label: "Getting worse",
					value: `INC-${top.number} ${top.title}`,
					sub: worseLine(top, now),
					dot: "danger",
					hot: true,
					link: { to: "/incidents/$id", params: { id: top.id } },
				}
			: {
					key: "worse",
					label: "Getting worse",
					value: "Nothing",
					sub:
						firing > 0
							? "Firing alerts are holding steady"
							: "Nothing is firing",
					dot: "ok",
					link: { to: "/incidents" },
				};
		return [worseTile, alerts, servicesTile];
	}, [
		loading,
		stats.data,
		services.data,
		resolved.data,
		incidents,
		now,
		agentReady,
	]);

	return (
		<section
			aria-label="Right now"
			className="grid shrink-0 grid-cols-1 gap-3 md:grid-cols-3"
			data-testid="inbox-tiles"
		>
			{tiles === null
				? [0, 1, 2].map((i) => (
						<div key={i} className="shimmer h-[72px] rounded-pool" />
					))
				: tiles.map((t) => (
						<Link
							key={t.key}
							{...t.link}
							className={cn(
								"flex min-w-0 items-center gap-3 rounded-pool px-3.5 py-3 transition-colors duration-(--dur-instant) hover:bg-surface-3",
								t.hot ? "bg-danger/8 dark:bg-danger/12" : "bg-surface-1",
							)}
							data-testid={`inbox-tile-${t.key}`}
						>
							<span className="flex min-w-0 flex-1 flex-col gap-0.5">
								<span className="flex items-center gap-2 text-meta text-text-3">
									<span
										aria-hidden
										className={cn(
											"size-[7px] shrink-0 rounded-full",
											t.dot === "danger" && "bg-danger",
											t.dot === "warn" && "bg-warn",
											t.dot === "ok" && "bg-ok",
										)}
									/>
									{t.label}
								</span>
								<span
									dir="auto"
									className="truncate text-title text-text-1"
									data-testid="inbox-tile-value"
								>
									{t.value}
								</span>
								<span className="truncate text-body text-text-2">{t.sub}</span>
							</span>
							<ChevronRight
								aria-hidden
								className="size-4 shrink-0 stroke-[1.75] text-text-3"
							/>
						</Link>
					))}
		</section>
	);
}

/** `booklogr-api, 3 alerts firing, 2 since an hour ago`. */
function worseLine(incident: IncidentWithRelations, now: number): string {
	const service = incidentServices(incident)[0]?.name;
	const firing = (incident.alerts ?? []).filter((a) =>
		isAlertFiring(a.status),
	).length;
	const fresh = newlyFiring(incident, now);
	return [
		service,
		`${plural(firing, "alert")} firing, ${fresh} in the last hour`,
	]
		.filter(Boolean)
		.join(", ");
}
