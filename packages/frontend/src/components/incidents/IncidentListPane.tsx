// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	INCIDENT_ATTENTION_LABEL,
	INCIDENT_STATUS_LABEL,
	type IncidentAttention,
	type IncidentStatus,
	type IncidentWithRelations,
	SEVERITY_LABEL,
} from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { BarChart3, Plus, Search, SlidersHorizontal } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { Mono } from "@/components/shared/Mono";
import {
	GroupBySelect,
	LaneHeader,
	useLaneFolded,
} from "@/components/shared/ServiceLanes";
import { StateWord } from "@/components/shared/StateChip";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLayoutPrefs } from "@/hooks/use-layout-prefs";
import { useListKeyboard } from "@/hooks/use-list-keyboard";
import { ago, useNow } from "@/hooks/use-now";
import { orpc } from "@/lib/api/orpc-client";
import { attentionFor, attentionTone } from "@/lib/incident-attention";
import {
	headlineAddsInfo,
	incidentHeadline,
	runWord,
} from "@/lib/incident-board";
import { alsoIn, incidentLanes } from "@/lib/service-lanes";
import { incidentStatusTone, runStateTone } from "@/lib/state-tone";
import { cn } from "@/lib/utils";
import { CreateIncidentDialog } from "./CreateIncidentDialog";
import { IncidentFilters } from "./IncidentFilters";

export interface IncidentListPaneProps {
	selectedId: string | null;
	className?: string;
	/** Beside the board: titles only, the board carries the rest (#743). */
	compact?: boolean;
}

/** Builds the list query from the frame's search, the same window the stats use. */
export function useIncidentWindow() {
	const search = useSearch({ from: "/_authenticated/incidents" });
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
	compact,
}: IncidentListPaneProps) {
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
	const [createOpen, setCreateOpen] = useState(false);
	const [q, setQ] = useState("");

	const { data, isLoading, error } = useQuery(
		orpc.incidents.list.queryOptions({ input: listInput }),
	);
	const { data: stats } = useQuery(
		orpc.incidents.getStats.queryOptions({ input: {} }),
	);
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
		const rest = visible.filter((i) => attentionFor(i) === null);
		return { needsYou, rest, rows: [...needsYou, ...rest] };
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
	const { groupBy } = useLayoutPrefs();
	const grouped = groupBy.list === "service";
	const laneFolded = useLaneFolded("list");
	const lanes = useMemo(
		() => (grouped ? incidentLanes(ordered.rows) : []),
		[grouped, ordered.rows],
	);
	// The rows j / k walk: every shown row, an incident once per open lane.
	const flat = useMemo(
		() =>
			grouped
				? lanes.flatMap((l) =>
						laneFolded(l.id)
							? []
							: l.items.map((incident) => ({ incident, lane: l.id })),
					)
				: ordered.rows.map((incident) => ({ incident, lane: "" })),
		[grouped, lanes, laneFolded, ordered.rows],
	);
	const { cursor, pointAt } = useListKeyboard(flat.length, (i) => {
		const row = flat[i];
		if (row) open(row.incident);
	});
	const row = (incident: IncidentWithRelations, index: number, lane = "") => {
		const selected = incident.id === selectedId;
		const also = lane ? alsoIn(incident, lane) : [];
		return (
			<Link
				key={`${lane}-${incident.id}`}
				to="/incidents/$id"
				params={{ id: incident.id }}
				search={keep}
				onMouseEnter={() => pointAt(index)}
				aria-current={selected ? "page" : undefined}
				data-testid="incident-row"
				data-cursor={cursor === index ? "true" : undefined}
				className={cn(
					"block px-3 outline-none hover:bg-muted/60",
					compact ? "py-1.5" : "py-2.5",
					cursor === index && "bg-muted/60",
					selected &&
						"bg-primary/8 hover:bg-primary/8 shadow-[inset_2px_0_0_var(--primary)]",
				)}
			>
				<IncidentRowBody
					incident={incident}
					why={attentionFor(incident)}
					now={now}
					selected={selected}
					compact={compact}
				/>
				{!compact && also.length > 0 && (
					<p className="mt-0.5 truncate pl-4 text-meta text-muted-foreground">
						Also in {also.join(", ")}
					</p>
				)}
			</Link>
		);
	};

	const setFilter = (patch: Partial<typeof search>) =>
		navigate({
			to: ".",
			search: (prev) => ({ ...prev, ...patch }),
			replace: true,
		});

	return (
		<aside
			className={cn("flex flex-col bg-background", className)}
			data-testid="incident-list-pane"
		>
			<div className="flex items-center justify-between gap-2 border-b px-3 py-2">
				<h1 className="text-sm font-semibold">Incidents</h1>
				<div className="flex items-center gap-1">
					<Button
						variant="ghost"
						size="sm"
						className="h-7 w-7 p-0"
						aria-label="Filters"
						aria-pressed={filtersOpen}
						onClick={() => setFiltersOpen((v) => !v)}
						data-testid="incident-list-filters-toggle"
					>
						<SlidersHorizontal className="h-3.5 w-3.5" />
					</Button>
					<Button
						asChild
						variant={search.view === "analytics" ? "secondary" : "ghost"}
						size="sm"
						className="h-7 w-7 p-0"
					>
						<Link
							to="/incidents"
							search={{ ...keep, view: "analytics" }}
							aria-label="Overview and analytics"
							data-testid="incidents-view-analytics"
						>
							<BarChart3 className="h-3.5 w-3.5" />
						</Link>
					</Button>
					<Button
						size="sm"
						className="h-7"
						onClick={() => setCreateOpen(true)}
						data-testid="create-incident-button"
					>
						<Plus className="mr-1 h-3.5 w-3.5" />
						New
					</Button>
				</div>
			</div>

			<div className="flex items-center gap-1 border-b px-2 py-1.5">
				<label className="flex min-w-0 flex-1 items-center gap-1.5 rounded border bg-background px-2">
					<Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
					<input
						value={q}
						onChange={(e) => setQ(e.target.value)}
						placeholder="Filter"
						aria-label="Filter incidents"
						className="h-6 min-w-0 flex-1 bg-transparent text-meta outline-none placeholder:text-muted-foreground"
						data-testid="incident-list-search"
					/>
				</label>
				<select
					value={windowValue}
					onChange={(e) => setWindow(e.target.value)}
					aria-label="Window"
					className="h-6 rounded border bg-background px-1 text-meta text-muted-foreground outline-none"
					data-testid="incident-list-window"
				>
					<option value="all">All time</option>
					<option value="1d">24 hours</option>
					<option value="7d">7 days</option>
					<option value="30d">30 days</option>
				</select>
				<GroupBySelect view="list" />
			</div>

			{filtersOpen && (
				<div className="border-b px-3 py-2" data-testid="incident-list-filters">
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
					<div className="space-y-2 p-3">
						{[1, 2, 3, 4, 5].map((k) => (
							<Skeleton key={k} className="h-12" />
						))}
					</div>
				)}
				{error && (
					<p className="p-3 text-record text-run-failed">
						The list did not load: {error.message}
					</p>
				)}
				{!isLoading && !error && incidents.length === 0 && nothingYet && (
					<p
						className="p-3 text-record text-muted-foreground"
						data-testid="incidents-none"
					>
						No incidents yet.
					</p>
				)}
				{!isLoading && !error && incidents.length === 0 && !nothingYet && (
					<div className="p-3" data-testid="incidents-empty-state">
						<div className="rounded-md border border-dashed p-3 text-record text-muted-foreground">
							Nothing in this window.
							<Button
								size="sm"
								className="mt-2 w-full"
								onClick={() => setCreateOpen(true)}
								data-testid="incidents-empty-create"
							>
								<Plus className="mr-1 h-3.5 w-3.5" />
								Create incident
							</Button>
						</div>
					</div>
				)}
				{grouped
					? (() => {
							let index = 0;
							return lanes.map((lane) => (
								<Fragment key={lane.id}>
									<LaneHeader
										view="list"
										id={lane.id}
										name={lane.name}
										count={lane.items.length}
										className="sticky top-0 z-10 bg-background"
									/>
									{!laneFolded(lane.id) &&
										lane.items.map((incident) =>
											row(incident, index++, lane.id),
										)}
								</Fragment>
							));
						})()
					: ordered.rows.map((incident, index) => (
							<Fragment key={incident.id}>
								{index === 0 && ordered.needsYou.length > 0 && (
									<GroupLabel
										label="Needs you"
										count={ordered.needsYou.length}
										testId="group-needs-you"
									/>
								)}
								{ordered.needsYou.length > 0 &&
									index === ordered.needsYou.length && (
										<GroupLabel
											label="Everything else"
											count={ordered.rest.length}
											testId="group-rest"
										/>
									)}
								{row(incident, index)}
							</Fragment>
						))}
			</div>

			<div className="flex items-center justify-between border-t px-3 py-1.5 text-meta text-muted-foreground">
				<span>
					{incidents.length} in window
					{data?.pagination.hasMore ? " · more not shown" : ""}
				</span>
				<span>j k ↵</span>
			</div>

			<CreateIncidentDialog
				open={createOpen}
				onOpenChange={setCreateOpen}
				onCreated={(id) =>
					navigate({
						to: "/incidents/$id",
						params: { id },
						search: keep,
					})
				}
			/>
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
			{label} <Mono>{count}</Mono>
		</div>
	);
}

/**
 * One row (#743): the title, then one muted line with the one state word that
 * matters (the run's while it is live, else what wants a human, else the
 * incident's) and the age. The headline shows on the selected row only.
 * Compact rows (beside the board) are the title alone.
 */
function IncidentRowBody({
	incident,
	why,
	now,
	selected,
	compact,
}: {
	incident: IncidentWithRelations;
	why: IncidentAttention | null;
	now: number | null;
	selected: boolean;
	compact?: boolean;
}) {
	const word = runWord(incident, now);
	const headline = incidentHeadline(incident);
	const service = incident.service?.displayName || incident.service?.name;
	return (
		<div
			className="min-w-0"
			title={`INC-${incident.number}${service ? `, ${service}` : ""}`}
		>
			<div className="flex items-center gap-2">
				<span
					role="img"
					aria-label={SEVERITY_LABEL[incident.severity]}
					className="h-2 w-2 shrink-0 rounded-full"
					style={{ background: `var(--sev-${incident.severity})` }}
				/>
				<p className="min-w-0 truncate text-record leading-snug">
					{incident.title}
				</p>
			</div>
			{!compact && (
				<div className="mt-1 flex items-center gap-2 pl-4 text-meta text-muted-foreground">
					{word ? (
						<StateWord
							quiet
							tone={word.stale ? "stale" : runStateTone(word.state)}
							pulse
							className="tabular-nums"
							data-testid="incident-run-word"
						>
							{word.text}
						</StateWord>
					) : why ? (
						<StateWord
							quiet
							tone={attentionTone[why]}
							data-testid="incident-attention"
						>
							{INCIDENT_ATTENTION_LABEL[why]}
						</StateWord>
					) : (
						<StateWord quiet tone={incidentStatusTone(incident.status)}>
							{INCIDENT_STATUS_LABEL[incident.status as IncidentStatus] ??
								incident.status}
						</StateWord>
					)}
					<span className="ml-auto shrink-0 tabular-nums">
						{ago(incident.triggeredAt, now)}
					</span>
				</div>
			)}
			{!compact && selected && headlineAddsInfo(headline) && (
				<p
					className="mt-1 truncate pl-4 text-meta text-muted-foreground"
					data-testid="incident-headline"
				>
					{headline.lead && (
						<span className="text-foreground">{headline.lead} </span>
					)}
					{headline.text}
				</p>
			)}
		</div>
	);
}
