// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	INCIDENT_ATTENTION_LABEL,
	INCIDENT_STATUS_LABEL,
	type IncidentStatus,
	type IncidentWithRelations,
	type Priority,
	SEVERITY_LABEL,
	type Severity,
} from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { BarChart3, Plus, SlidersHorizontal } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { SetupNextStepHint } from "@/components/setup";
import { Mono } from "@/components/shared/Mono";
import { StateWord } from "@/components/shared/StateChip";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useListKeyboard } from "@/hooks/use-list-keyboard";
import { ago, useNow } from "@/hooks/use-now";
import { orpc } from "@/lib/api/orpc-client";
import { attentionFor, attentionTone } from "@/lib/incident-attention";
import { incidentStatusTone } from "@/lib/state-tone";
import { cn } from "@/lib/utils";
import { CreateIncidentDialog } from "./CreateIncidentDialog";
import { IncidentFilters } from "./IncidentFilters";

export interface IncidentListPaneProps {
	selectedId: string | null;
	className?: string;
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

/** The ones that want a human first, then the rest in the API's order. */
export function orderIncidents(incidents: IncidentWithRelations[]) {
	const needsYou = incidents.filter((i) => attentionFor(i) !== null);
	const rest = incidents.filter((i) => attentionFor(i) === null);
	return [...needsYou, ...rest];
}

/**
 * The queue as a pane: every incident in the window, the ones that want a
 * human first, one row each, always on screen beside the record. j / k move,
 * Enter opens; the selected row is the one the centre shows.
 */
export function IncidentListPane({
	selectedId,
	className,
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

	const { data, isLoading, error } = useQuery(
		orpc.incidents.list.queryOptions({ input: listInput }),
	);
	const incidents = data?.data ?? [];

	const ordered = useMemo(() => {
		const needsYou = incidents.filter((i) => attentionFor(i) !== null);
		const rest = incidents.filter((i) => attentionFor(i) === null);
		return { needsYou, rest, rows: [...needsYou, ...rest] };
	}, [incidents]);

	const open = (incident: IncidentWithRelations) =>
		navigate({
			to: "/incidents/$id",
			params: { id: incident.id },
			search: keep,
		});
	const { cursor, setCursor } = useListKeyboard(ordered.rows.length, (i) => {
		const row = ordered.rows[i];
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
				{!isLoading && !error && incidents.length === 0 && (
					<div className="p-3" data-testid="incidents-empty-state">
						<div className="rounded-md border border-dashed p-3 text-record text-muted-foreground">
							No incidents in this window. They appear when alerts correlate, or
							you can create one by hand.
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
						<SetupNextStepHint className="mt-3" />
					</div>
				)}
				{ordered.rows.map((incident, index) => {
					const why = attentionFor(incident);
					const selected = incident.id === selectedId;
					return (
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
							<Link
								to="/incidents/$id"
								params={{ id: incident.id }}
								search={keep}
								onMouseEnter={() => setCursor(index)}
								aria-current={selected ? "page" : undefined}
								data-testid="incident-row"
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
										aria-label={SEVERITY_LABEL[incident.severity]}
										title={SEVERITY_LABEL[incident.severity]}
										className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
										style={{
											background: `var(--sev-${incident.severity})`,
										}}
									/>
									<div className="min-w-0 flex-1">
										<p className="line-clamp-2 text-record font-medium leading-snug">
											<Mono className="mr-1.5 text-meta font-normal text-muted-foreground">
												INC-{incident.number}
											</Mono>
											{incident.title}
										</p>
										<div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-meta text-muted-foreground">
											{why ? (
												<StateWord
													tone={attentionTone[why]}
													data-testid="incident-attention"
												>
													{INCIDENT_ATTENTION_LABEL[why]}
												</StateWord>
											) : (
												<StateWord tone={incidentStatusTone(incident.status)}>
													{INCIDENT_STATUS_LABEL[
														incident.status as IncidentStatus
													] ?? incident.status}
												</StateWord>
											)}
											{incident.service && (
												<span className="truncate">
													{incident.service.displayName ||
														incident.service.name}
												</span>
											)}
											<span className="ml-auto tabular-nums">
												{ago(incident.triggeredAt, now)}
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
