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
import {
	AlertTriangle,
	Circle,
	CircleCheck,
	Plus,
	Search,
	SlidersHorizontal,
} from "lucide-react";
import { useMemo, useState } from "react";
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
	NO_SERVICE_LANE,
	otherServices,
	SETTLED_LANE,
} from "@/lib/service-lanes";
import { cn } from "@/lib/utils";
import type { IncidentsSearch } from "@/routes/_authenticated/incidents/route";
import { CreateIncidentDialog } from "./CreateIncidentDialog";
import { IncidentFilters } from "./IncidentFilters";

export interface IncidentListPaneProps {
	selectedId: string | null;
	className?: string;
	/** j / k walk this list; off where another list owns the keys. */
	keyboard?: boolean;
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
	const [createService, setCreateService] = useState<string | undefined>();
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
					"mx-1.5 flex items-center gap-2 rounded-md px-2 py-1 outline-none hover:bg-muted/60",
					cursor === index && "bg-muted/60",
					selected && "bg-muted hover:bg-muted",
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
			<div className="flex items-center gap-1 px-2 pb-1">
				<Button
					variant="ghost"
					size="sm"
					className="h-7 flex-1 justify-start gap-2 px-2 font-normal"
					onClick={() => setCreateOpen(true)}
					data-testid="create-incident-button"
				>
					<Plus className="h-3.5 w-3.5" />
					New incident
				</Button>
				<div className="flex items-center gap-0.5">
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
				</div>
			</div>

			<div className="flex items-center gap-1 px-2 pb-2">
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
					className="h-6 rounded border md:hidden bg-background px-1 text-meta text-muted-foreground outline-none"
					data-testid="incident-list-window"
				>
					<option value="all">All time</option>
					<option value="1d">24 hours</option>
					<option value="7d">7 days</option>
					<option value="30d">30 days</option>
				</select>
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
				{(() => {
					let index = 0;
					return groups.map((group) => (
						<section
							key={group.id}
							className="pb-2"
							data-testid="sidebar-group"
						>
							<div className="group/header flex items-center pr-2">
								<LaneHeader
									view="list"
									id={group.id}
									name={group.name}
									count={group.items.length}
									foldedByDefault={group.id === SETTLED_LANE}
									className="min-w-0 flex-1 font-normal"
								/>
								{group.id !== NO_SERVICE_LANE && group.id !== SETTLED_LANE && (
									<Button
										variant="ghost"
										size="icon-xs"
										className="opacity-0 group-hover/header:opacity-100 focus-visible:opacity-100"
										aria-label={`New incident in ${group.name}`}
										onClick={() => {
											setCreateService(group.id);
											setCreateOpen(true);
										}}
										data-testid="sidebar-group-new"
									>
										<Plus />
									</Button>
								)}
							</div>
							{!isFolded(group.id) &&
								group.items.map((incident) => row(incident, index++))}
						</section>
					));
				})()}
				{incidents.length > 0 && (
					<p className="px-3 pb-3 text-meta text-muted-foreground">
						{incidents.length} in window
						{data?.pagination.hasMore ? " · more not shown" : ""}
					</p>
				)}
			</div>

			<CreateIncidentDialog
				open={createOpen}
				onOpenChange={(next) => {
					setCreateOpen(next);
					if (!next) setCreateService(undefined);
				}}
				defaultServiceId={createService}
				onCreated={(id) =>
					navigate({
						to: "/incidents/$id",
						params: { id },
						search: keep,
					})
				}
			/>
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

const GLYPH_CLASS = "h-3.5 w-3.5 shrink-0";

/**
 * One sidebar row (#743): a glyph for where the incident stands and the
 * title. The state, the age and the headline are in the row's hover title
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
			{glyph === "live" ? (
				<span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
					<span className="h-2 w-2 rounded-full bg-run-active motion-safe:animate-pulse" />
				</span>
			) : glyph === "attention" ? (
				<AlertTriangle
					className={cn(
						GLYPH_CLASS,
						why === "failed_run" ? "text-run-failed" : "text-sev-critical",
					)}
				/>
			) : glyph === "open" ? (
				<Circle className={cn(GLYPH_CLASS, "text-muted-foreground")} />
			) : (
				<CircleCheck className={cn(GLYPH_CLASS, "text-muted-foreground/60")} />
			)}
			<span
				className={cn(
					"min-w-0 truncate text-record",
					glyph === "ended" && !selected && "text-muted-foreground",
				)}
			>
				{incident.title}
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
