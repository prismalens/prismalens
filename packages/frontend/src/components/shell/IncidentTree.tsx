// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type IncidentWithRelations,
	isWorkflowLive,
} from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";
import {
	ChevronRight,
	Cloud,
	Database,
	Globe,
	Layers,
	MemoryStick,
	Network,
	Server,
} from "lucide-react";
import { useState } from "react";
import { firingOf } from "@/components/inbox/inbox-model";
import { useActiveIncidents } from "@/components/inbox/use-inbox-data";
import { DRAFT } from "@/components/incidents/record-context";
import { Hint } from "@/components/shared/Hint";
import { Mono } from "@/components/shared/Mono";
import { useNow } from "@/hooks/use-now";
import { useServices } from "@/lib/api/hooks";
import { useLiveRefreshInterval } from "@/lib/api/live-refresh";
import { orpc } from "@/lib/api/orpc-client";
import { shortAge } from "@/lib/incident-board";
import { incidentGroups } from "@/lib/service-lanes";
import { cn } from "@/lib/utils";

const PER_SERVICE = 8;
const TITLE_CHARS = 20;

const TYPE_ICON = {
	database: Database,
	cache: MemoryStick,
	queue: Layers,
	gateway: Network,
	external: Globe,
	infrastructure: Cloud,
} as const;

/** `BooklogrA…ncyP99High`: both ends stay, the full title is in the hint. */
export function middle(text: string, n = TITLE_CHARS): string {
	if (text.length <= n) return text;
	return `${text.slice(0, Math.ceil(n / 2) - 1)}…${text.slice(text.length - Math.floor(n / 2))}`;
}

type Health = "worse" | "degraded" | "healthy";
const HEALTH_TEXT: Record<Health, string> = {
	worse: "Degraded, getting worse",
	degraded: "Degraded",
	healthy: "Healthy",
};

function healthOf(items: IncidentWithRelations[], now: number): Health {
	let h: Health = "healthy";
	for (const i of items) {
		const f = firingOf(i, now);
		if (f === "worse") return "worse";
		if (f === "steady") h = "degraded";
	}
	return h;
}

/** Where the route puts you: the incident, and the run when on a transcript. */
function useHere(): { incidentId: string | null; runId: string | null } {
	const { pathname } = useLocation();
	const incident = /^\/incidents\/([^/]+)/.exec(pathname)?.[1] ?? null;
	const runId = /^\/investigations\/([^/]+)/.exec(pathname)?.[1] ?? null;
	const run = useQuery({
		...orpc.investigations.get.queryOptions({ input: { id: runId ?? "" } }),
		enabled: !!runId,
	});
	return { incidentId: incident ?? run.data?.incidentId ?? null, runId };
}

/**
 * The sidebar's incidents (spec §1, #811): every incident not yet resolved,
 * under its service with the service's type and health; a chevron lists the
 * runs and questions, the name opens the overview.
 */
export function IncidentTree() {
	const { incidents, isLoading } = useActiveIncidents();
	const services = useServices();
	const now = useNow(30_000) ?? 0;
	const here = useHere();
	const [open, setOpen] = useState<Record<string, boolean>>({});
	const [all, setAll] = useState<Record<string, boolean>>({});

	if (isLoading)
		return (
			<div className="flex flex-col gap-1 px-4 pt-2.5" aria-busy>
				<div className="shimmer mb-1 h-3 w-1/2 rounded-[4px]" />
				<div className="shimmer h-5 rounded-[4px]" />
				<div className="shimmer h-5 rounded-[4px]" />
			</div>
		);
	if (incidents.length === 0)
		return (
			<p className="px-4 py-2 text-meta text-text-3" data-testid="tree-empty">
				No open incidents
			</p>
		);
	const typeOf = (id: string) =>
		services.data?.data.find((s) => s.id === id)?.type ?? "service";

	return (
		<div className="flex flex-col gap-px px-2" data-testid="incident-tree">
			{incidentGroups(incidents).map((g) => {
				const health = healthOf(g.items, now);
				const Icon =
					TYPE_ICON[typeOf(g.id) as keyof typeof TYPE_ICON] ?? Server;
				const items = all[g.id] ? g.items : g.items.slice(0, PER_SERVICE);
				const more = g.items.length - items.length;
				return (
					<section
						key={g.id}
						aria-label={g.name}
						className="flex flex-col gap-px"
						data-testid="tree-service"
					>
						<div className="flex items-center gap-1.5 px-2.5 pt-2 pb-1 text-meta text-text-3">
							<Icon aria-hidden className="size-3 shrink-0 stroke-[1.75]" />
							<span dir="auto" className="min-w-0 flex-1 truncate">
								{g.name}
							</span>
							<span
								aria-hidden
								className={cn(
									"size-1.5 shrink-0 rounded-full",
									health === "worse" && "bg-danger",
									health === "degraded" && "bg-warn",
									health === "healthy" && "bg-ok",
								)}
								data-health={health}
							/>
							<span className="sr-only">{HEALTH_TEXT[health]}</span>
						</div>
						{items.map((incident) => {
							const expanded =
								open[incident.id] ?? incident.id === here.incidentId;
							const on = incident.id === here.incidentId && !here.runId;
							return (
								<div key={incident.id} className="flex flex-col gap-px">
									<div
										className={cn(
											"group/row flex h-7 min-w-0 items-center gap-1.5 rounded-control pr-2.5 pl-1 text-body text-text-2 transition-colors duration-(--dur-instant) hover:bg-surface-3 hover:text-text-1",
											on && "bg-surface-3 text-text-1",
										)}
										data-testid="tree-incident"
									>
										<button
											type="button"
											aria-label={`Runs and questions in INC-${incident.number}`}
											aria-expanded={expanded}
											onClick={() =>
												setOpen((o) => ({ ...o, [incident.id]: !expanded }))
											}
											className="flex size-5 shrink-0 items-center justify-center rounded-[4px] text-text-3 hover:text-text-1"
											data-testid="tree-toggle"
										>
											<ChevronRight
												aria-hidden
												className={cn(
													"size-3 stroke-2 transition-transform duration-150 ease-(--ease-out)",
													expanded && "rotate-90",
												)}
											/>
										</button>
										<Hint
											label={incident.title}
											side="right"
											when={incident.title.length > TITLE_CHARS}
										>
											<Link
												to="/incidents/$id"
												params={{ id: incident.id }}
												aria-current={on ? "page" : undefined}
												className="flex min-w-0 flex-1 gap-1.5"
												data-testid="tree-incident-link"
											>
												<Mono className="shrink-0 leading-5 text-text-3 group-hover/row:text-text-2">
													INC-{incident.number}
												</Mono>
												<span dir="auto" className="min-w-0 truncate">
													{middle(incident.title)}
												</span>
											</Link>
										</Hint>
									</div>
									{expanded && (
										<RunList
											incidentId={incident.id}
											runId={here.runId}
											now={now}
										/>
									)}
								</div>
							);
						})}
						{more > 0 && (
							<button
								type="button"
								onClick={() => setAll((a) => ({ ...a, [g.id]: true }))}
								className="flex h-6 items-center rounded-control pl-6 text-left text-meta text-text-3 transition-colors duration-(--dur-instant) hover:bg-surface-3 hover:text-text-1"
								data-testid="tree-more"
							>
								{more.toLocaleString("en-US")} more
							</button>
						)}
					</section>
				);
			})}
		</div>
	);
}

type Run = NonNullable<IncidentWithRelations["investigations"]>[number];

/** `Run 2, likely cause` or `Ask: did v1.41 …`; investigations are numbered on their own. */
export function runLabel(runs: Run[], run: Run): string {
	if (run.kind === "chat") return `Ask: ${run.title?.trim() || "question"}`;
	const investigations = runs
		.filter((r) => r.kind !== "chat")
		.sort(
			(a, b) =>
				new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
		);
	const n = investigations.findIndex((r) => r.id === run.id) + 1;
	const word = isWorkflowLive(run.status)
		? "working"
		: run.status === "completed"
			? run.rootCause?.trim()
				? "likely cause"
				: "no cause named"
			: run.status === "failed"
				? "failed"
				: run.status === "cancelled"
					? "stopped by you"
					: run.status;
	return `Run ${n}, ${word}`;
}

function RunList({
	incidentId,
	runId,
	now,
}: {
	incidentId: string;
	runId: string | null;
	now: number;
}) {
	const { data, isLoading } = useQuery({
		...orpc.incidents.get.queryOptions({ input: { id: incidentId } }),
		refetchInterval: useLiveRefreshInterval(),
	});
	const runs = [...(data?.investigations ?? [])].sort(
		(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
	);
	const row =
		"flex h-6 min-w-0 items-center gap-2 rounded-control pr-2.5 pl-[30px] text-meta text-text-2 transition-colors duration-(--dur-instant) hover:bg-surface-3 hover:text-text-1";
	return (
		<div className="flex flex-col gap-px" data-testid="tree-runs">
			{isLoading && (
				<div className="shimmer mx-2.5 ml-[30px] h-4 rounded-[4px]" />
			)}
			{runs.map((r) => {
				const live = isWorkflowLive(r.status);
				const on = r.id === runId;
				const label = runLabel(runs, r);
				return (
					<Link
						key={r.id}
						to="/investigations/$id"
						params={{ id: r.id }}
						aria-current={on ? "page" : undefined}
						className={cn(row, on && "bg-surface-3 text-text-1")}
						data-testid="tree-run"
						data-run={r.id}
					>
						<span
							aria-hidden
							className={cn(
								"size-1.5 shrink-0 rounded-full",
								r.kind === "chat"
									? "bg-text-3"
									: live
										? "breathe bg-live"
										: r.status === "completed"
											? "bg-ok"
											: r.status === "failed"
												? "bg-danger"
												: "bg-text-3",
							)}
						/>
						<span dir="auto" className="min-w-0 flex-1 truncate">
							{label}
						</span>
						<span className="shrink-0 text-text-3 tabular-nums">
							{live ? "now" : shortAge(r.createdAt, now)}
						</span>
					</Link>
				);
			})}
			<Link
				to="/incidents/$id/conversation"
				params={{ id: incidentId }}
				search={{ investigation: DRAFT }}
				className={cn(row, "text-text-3")}
				data-testid="tree-new-conversation"
			>
				New conversation
			</Link>
		</div>
	);
}
