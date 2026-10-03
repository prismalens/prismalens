// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	INCIDENT_ATTENTION_LABEL,
	INCIDENT_STATUS_LABEL,
	type IncidentStatus,
	type IncidentWithRelations,
} from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Search, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { Mono } from "@/components/shared/Mono";
import { LaneHeader, useLaneFolded } from "@/components/shared/ServiceLanes";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useListKeyboard } from "@/hooks/use-list-keyboard";
import { ago, useNow } from "@/hooks/use-now";
import { useLiveRefreshInterval } from "@/lib/api/live-refresh";
import { orpc } from "@/lib/api/orpc-client";
import { attentionFor } from "@/lib/incident-attention";
import {
	headlineAddsInfo,
	incidentHeadline,
	rowGlyph,
	runWord,
} from "@/lib/incident-board";
import {
	incidentGroups,
	otherServices,
	SETTLED_LANE,
} from "@/lib/service-lanes";
import { cn } from "@/lib/utils";
import type { IncidentsSearch } from "@/routes/_authenticated/incidents/route";
import { IncidentFilters } from "./IncidentFilters";

export interface IncidentListPaneProps {
	selectedId: string | null;
	className?: string;
	/** j / k walk this list; off where another list owns the keys. */
	keyboard?: boolean;
	/** In the sidebar the rows alone; as the phone's page, the filters above them. */
	variant?: "sidebar" | "page";
}

/** Builds the list query from the frame's search, the same window the stats use. */
export function useIncidentWindow() {
	// The sidebar renders the list on every route, so the window may be unset.
	const search: IncidentsSearch =
		useSearch({ from: "/_authenticated/incidents", shouldThrow: false }) ?? {};
	const from = search.from ? new Date(search.from) : undefined;
	const to = search.to ? new Date(search.to) : undefined;
	return {
		search,
		from,
		to,
		listInput: {
			...(search.status && { status: search.status }),
			...(!search.status && search.open === "1" && { open: true }),
			...(search.severity && { severity: search.severity }),
			...(search.priority && { priority: search.priority }),
			...(from && { fromDate: from }),
			...(to && { toDate: to }),
			limit: 100,
		},
		statsInput: {
			...(from && { fromDate: from }),
			...(to && { toDate: to }),
		},
		windowLabel:
			from && to
				? `${from.toLocaleDateString()} – ${to.toLocaleDateString()}`
				: from
					? `since ${from.toLocaleDateString()}`
					: "all time",
	};
}

/**
 * The queue as a pane: every incident in the window, the ones that want a
 * human first, one row each, always on screen beside the record. j / k move,
 * Enter opens; the selected row is the one the centre shows.
 */
export function IncidentListPane({
	selectedId,
	className,
	keyboard = true,
	variant = "page",
}: IncidentListPaneProps) {
	const sidebar = variant === "sidebar";
	const navigate = useNavigate();
	const now = useNow();
	const { search, listInput } = useIncidentWindow();
	// The frame's own search, spelled out: the child route's search type is narrower than
	// the union `useNavigate` sees, so a bare `(prev) => prev` does not type.
	const keep = {
		status: search.status,
		severity: search.severity,
		priority: search.priority,
		open: search.open,
		from: search.from,
		to: search.to,
		view: search.view,
	};
	const [filtersOpen, setFiltersOpen] = useState(
		!!(search.status || search.severity || search.priority),
	);
	const [q, setQ] = useState("");

	const { data, isLoading, error } = useQuery({
		...orpc.incidents.list.queryOptions({ input: listInput }),
		refetchInterval: useLiveRefreshInterval(),
	});
	const { data: stats } = useQuery({
		...orpc.incidents.getStats.queryOptions({ input: {} }),
		refetchInterval: useLiveRefreshInterval(),
	});
	const nothingYet = stats?.total === 0;
	const incidents = data?.data ?? [];

	// The text filter narrows the loaded window client-side; the API has no text search.
	const ordered = useMemo(() => {
		const needle = q.trim().toLowerCase();
		const visible = needle
			? incidents.filter(
					(i) =>
						i.title.toLowerCase().includes(needle) ||
						`inc-${i.number}`.includes(needle) ||
						(i.service?.name ?? "").toLowerCase().includes(needle),
				)
			: incidents;
		const needsYou = visible.filter((i) => attentionFor(i) !== null);
		const rest = visible.filter(
			(i) => attentionFor(i) === null && i.status !== "closed",
		);
		const settled = visible.filter(
			(i) => attentionFor(i) === null && i.status === "closed",
		);
		return { rows: [...needsYou, ...rest], settled };
	}, [incidents, q]);
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
		setFilter({
			from: days
				? new Date(Date.now() - days * 86_400_000).toISOString()
				: undefined,
			to: undefined,
		});
	};

	const open = (incident: IncidentWithRelations) =>
		navigate({
			to: "/incidents/$id",
			params: { id: incident.id },
			search: keep,
		});
	const groupFolded = useLaneFolded("list");
	// Closed incidents sit in one Settled group at the foot, folded until opened.
	const groups = useMemo(() => {
		const byService = incidentGroups(ordered.rows);
		return ordered.settled.length > 0
			? [
					...byService,
					{ id: SETTLED_LANE, name: "Settled", items: ordered.settled },
				]
			: byService;
	}, [ordered]);
	const isFolded = (id: string) => groupFolded(id, id === SETTLED_LANE);
	// The rows j / k walk: every row in an open group, top to bottom.
	const flat = groups.flatMap((g) => (isFolded(g.id) ? [] : g.items));
	const { cursor, pointAt } = useListKeyboard(
		flat.length,
		(i) => {
			const incident = flat[i];
			if (incident) open(incident);
		},
		keyboard,
	);
	const row = (incident: IncidentWithRelations, index: number) => {
		const selected = incident.id === selectedId;
		return (
			<Link
				key={incident.id}
				to="/incidents/$id"
				params={{ id: incident.id }}
				search={keep}
				onMouseEnter={() => pointAt(index)}
				aria-current={selected ? "page" : undefined}
				data-testid="incident-row"
				data-cursor={cursor === index ? "true" : undefined}
				title={rowTitle(incident, now)}
				className={cn(
					"mx-2 flex items-center gap-2.5 rounded-control px-2.5 py-1.5 text-body text-text-2 outline-none hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-accent",
					cursor === index && "bg-surface-3",
					selected && "bg-surface-3 text-text-1",
				)}
			>
				<IncidentRowBody incident={incident} now={now} selected={selected} />
			</Link>
		);
	};

	// Off the incidents routes a filter change lands on the board it narrows.
	const setFilter = (patch: Partial<IncidentsSearch>) =>
		selectedId
			? navigate({
					to: "/incidents/$id",
					params: { id: selectedId },
					search: { ...keep, ...patch },
					replace: true,
				})
			: navigate({
					to: "/incidents",
					search: { ...keep, ...patch },
					replace: true,
				});

	return (
		<section
			className={cn("flex flex-col", className)}
			data-testid="incident-list-pane"
			aria-labelledby="incident-list-heading"
		>
			<h2 id="incident-list-heading" className="sr-only">
				Incidents
			</h2>
			{!sidebar && (
				<div className="flex items-center gap-1.5 px-4 pb-2">
					<label className="raised flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-control px-2.5">
						<Search className="size-3.5 shrink-0 text-text-3" />
						<input
							value={q}
							onChange={(e) => setQ(e.target.value)}
							placeholder="Filter"
							aria-label="Filter incidents"
							className="h-6 min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-text-3 md:text-body"
							data-testid="incident-list-search"
						/>
					</label>
					<select
						value={windowValue}
						onChange={(e) => setWindow(e.target.value)}
						aria-label="Window"
						className="raised h-8 rounded-control px-2 text-body text-text-2 outline-none"
						data-testid="incident-list-window"
					>
						<option value="all">All time</option>
						<option value="1d">24 hours</option>
						<option value="7d">7 days</option>
						<option value="30d">30 days</option>
					</select>
					<Button
						variant="ghost"
						size="icon"
						aria-label="Filters"
						aria-pressed={filtersOpen}
						onClick={() => setFiltersOpen((v) => !v)}
						data-testid="incident-list-filters-toggle"
					>
						<SlidersHorizontal />
					</Button>
				</div>
			)}

			{!sidebar && filtersOpen && (
				<div className="px-4 pb-2" data-testid="incident-list-filters">
					<IncidentFilters
						status={search.status ?? "all"}
						severity={search.severity ?? "all"}
						priority={search.priority ?? "all"}
						onStatusChange={(status) =>
							setFilter({ status: status === "all" ? undefined : status })
						}
						onSeverityChange={(severity) =>
							setFilter({ severity: severity === "all" ? undefined : severity })
						}
						onPriorityChange={(priority) =>
							setFilter({ priority: priority === "all" ? undefined : priority })
						}
						onClear={() =>
							setFilter({
								status: undefined,
								severity: undefined,
								priority: undefined,
							})
						}
					/>
				</div>
			)}

			<div
				className="min-h-0 flex-1 overflow-y-auto"
				data-testid="incident-list"
			>
				{isLoading && (
					<div className="space-y-3 px-4 py-2">
						{[1, 2, 3, 4, 5].map((k) => (
							<Skeleton key={k} className="h-3" />
						))}
					</div>
				)}
				{error && (
					<p className="px-4 py-2 text-body text-text-1">
						The list did not load: {error.message}
					</p>
				)}
				{!isLoading && !error && incidents.length === 0 && nothingYet && (
					<p
						className="px-4 py-2 text-body text-text-2"
						data-testid="incidents-none"
					>
						No incidents yet.
					</p>
				)}
				{!isLoading && !error && incidents.length === 0 && !nothingYet && (
					<p
						className="px-4 py-2 text-body text-text-2"
						data-testid="incidents-empty-state"
					>
						Nothing in this window.
					</p>
				)}
				{(() => {
					let index = 0;
					return groups.map((group) => (
						<section
							key={group.id}
							className="pb-2"
							data-testid="sidebar-group"
						>
							<div className="px-2">
								<LaneHeader
									view="list"
									id={group.id}
									name={group.name}
									count={group.items.length}
									foldedByDefault={group.id === SETTLED_LANE}
								/>
							</div>
							{!isFolded(group.id) &&
								group.items.map((incident) => row(incident, index++))}
						</section>
					));
				})()}
				{data?.pagination.hasMore && (
					<p className="px-4 pb-3 text-meta text-text-3">
						The 100 newest in this window
					</p>
				)}
			</div>
		</section>
	);
}

function rowTitle(incident: IncidentWithRelations, now: number | null) {
	const word = runWord(incident, now);
	const why = attentionFor(incident);
	const state = word
		? word.text
		: why
			? INCIDENT_ATTENTION_LABEL[why]
			: (INCIDENT_STATUS_LABEL[incident.status as IncidentStatus] ??
				incident.status);
	const headline = incidentHeadline(incident);
	const others = otherServices(incident);
	return [
		`INC-${incident.number}  ${state}  ${ago(incident.triggeredAt, now)}`,
		headlineAddsInfo(headline)
			? `${headline.lead ? `${headline.lead} ` : ""}${headline.text}`
			: null,
		others.length > 0 ? `Also touches ${others.join(", ")}` : null,
	]
		.filter(Boolean)
		.join("\n");
}

/**
 * One sidebar row (#743): a bar for where the incident stands (study-v3 §2:
 * live teal, attention red, open grey, ended none), the id and the title. The state, the age and the headline are in the row's hover title
 * and in hidden text for assistive tech.
 */
function IncidentRowBody({
	incident,
	now,
	selected,
}: {
	incident: IncidentWithRelations;
	now: number | null;
	selected: boolean;
}) {
	const glyph = rowGlyph(incident);
	const why = attentionFor(incident);
	const word = runWord(incident, now);
	const headline = incidentHeadline(incident);
	return (
		<>
			<span
				aria-hidden
				data-glyph={glyph}
				className={cn(
					"h-3 w-[3px] shrink-0 rounded-full",
					glyph === "live" && "bg-live",
					glyph === "attention" && "bg-danger",
					glyph === "open" && "bg-text-3",
				)}
			/>
			<span className="min-w-0 truncate">
				<Mono className="mr-1.5 text-text-3">INC-{incident.number}</Mono>
				<span className={cn(glyph === "ended" && !selected && "text-text-3")}>
					{incident.title}
				</span>
			</span>
			<span className="sr-only">
				{word && <span data-testid="incident-run-word">{word.text}</span>}
				{why && !word && (
					<span data-testid="incident-attention">
						{INCIDENT_ATTENTION_LABEL[why]}
					</span>
				)}
				<span data-testid="incident-headline">
					{headline.lead ? `${headline.lead} ` : ""}
					{headline.text}
				</span>
			</span>
		</>
	);
}
