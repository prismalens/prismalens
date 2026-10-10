// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	enumOptions,
	type IncidentWithRelations,
	SEVERITY_LABEL,
	type Severity,
	SeveritySchema,
} from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { Mono } from "@/components/shared/Mono";
import { Segmented } from "@/components/shared/Segmented";
import { Empty, Loading, Problem } from "@/components/shared/State";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useLiveRefreshInterval } from "@/lib/api/live-refresh";
import { orpc } from "@/lib/api/orpc-client";
import { incidentServices } from "@/lib/service-lanes";
import type { IncidentsSearch } from "@/routes/_authenticated/incidents/route";
import { ago, liveOf, matches, NEED_GROUPS, needOf } from "./inbox-model";

const SEVERITIES = [
	{ value: "all" as const, label: "Every severity" },
	...enumOptions(SeveritySchema, SEVERITY_LABEL),
];

type Status = "all" | "open" | "resolved" | "closed";

function statusOf(search: IncidentsSearch): Status {
	if (search.open === "1") return "open";
	if (search.status === "resolved" || search.status === "closed")
		return search.status;
	return "all";
}

/** Where an incident stands, in the inbox's words. */
function standing(incident: IncidentWithRelations): string {
	if (incident.status === "closed")
		return incident.mergedInto
			? `Merged into INC-${incident.mergedInto.number}`
			: "Resolved";
	const need = needOf(incident);
	if (need) return NEED_GROUPS.find((g) => g.key === need)?.label ?? need;
	return liveOf(incident) ? "Run working" : "Open";
}

/** All incidents (the header's second view): every incident in the window, newest first. */
export function AllIncidents({
	search,
	setSearch,
	filter,
	now,
}: {
	search: IncidentsSearch;
	setSearch: (patch: Partial<IncidentsSearch>) => void;
	filter: string;
	now: number;
}) {
	const status = statusOf(search);
	const input = {
		...(status === "open" && { open: true }),
		...((status === "resolved" || status === "closed") && { status }),
		...(search.severity && { severity: search.severity }),
		...(search.from && { fromDate: new Date(search.from) }),
		limit: 100,
	};
	const { data, isLoading, error, refetch } = useQuery({
		...orpc.incidents.list.queryOptions({ input }),
		refetchInterval: useLiveRefreshInterval(),
	});
	const rows = useMemo(
		() =>
			[...(data?.data ?? [])]
				.filter((i) => matches(i, filter))
				.sort(
					(a, b) =>
						new Date(b.triggeredAt).getTime() -
						new Date(a.triggeredAt).getTime(),
				),
		[data, filter],
	);

	return (
		<div className="flex flex-col gap-3" data-testid="all-incidents">
			<div className="flex flex-wrap items-center gap-2">
				<Segmented
					label="Status"
					value={status}
					onChange={(v) =>
						setSearch({
							open: v === "open" ? "1" : undefined,
							status: v === "resolved" || v === "closed" ? v : undefined,
						})
					}
					options={[
						{ value: "all", label: "All" },
						{ value: "open", label: "Open" },
						{ value: "resolved", label: "Alerts cleared" },
						{ value: "closed", label: "Resolved" },
					]}
					testId="all-status"
				/>
				<Select
					value={search.severity ?? "all"}
					onValueChange={(v) =>
						setSearch({ severity: v === "all" ? undefined : (v as Severity) })
					}
				>
					<SelectTrigger aria-label="Severity" data-testid="all-severity">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{SEVERITIES.map((s) => (
							<SelectItem key={s.value} value={s.value}>
								{s.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			{isLoading ? (
				<Loading rows={6} />
			) : error && !data ? (
				<Problem
					text="The incidents did not load."
					onRetry={() => void refetch()}
				/>
			) : rows.length === 0 ? (
				<Empty text="No incidents match." testId="all-empty" />
			) : (
				<div className="flex flex-col">
					{rows.map((i) => (
						<Link
							key={i.id}
							to="/incidents/$id"
							params={{ id: i.id }}
							className="flex h-10 min-w-0 items-center gap-3.5 rounded-surface px-2.5 whitespace-nowrap transition-colors duration-(--dur-instant) hover:bg-surface-2"
							data-testid="all-row"
						>
							<span
								className="w-14 shrink-0 text-meta font-medium"
								style={{ color: `var(--sev-${i.severity})` }}
							>
								{SEVERITY_LABEL[i.severity as Severity] ?? i.severity}
							</span>
							<Mono className="w-[52px] shrink-0 text-text-3">
								INC-{i.number}
							</Mono>
							<span dir="auto" className="min-w-0 flex-1 truncate text-text-1">
								{i.title}
							</span>
							<span
								dir="auto"
								className="max-w-[180px] min-w-0 truncate text-meta text-text-3 max-md:hidden"
							>
								{incidentServices(i)[0]?.name}
							</span>
							<span className="w-[150px] shrink-0 truncate text-meta text-text-2 max-md:hidden">
								{standing(i)}
							</span>
							<span className="w-[52px] shrink-0 text-right text-meta text-text-3 tabular-nums">
								{ago(i.triggeredAt, now)} ago
							</span>
						</Link>
					))}
					{data?.pagination.hasMore && (
						<p className="px-2.5 pt-2 text-meta text-text-3">
							The 100 newest in this window
						</p>
					)}
				</div>
			)}
		</div>
	);
}
