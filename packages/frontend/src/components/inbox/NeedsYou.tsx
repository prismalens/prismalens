// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type CloseIncidentInput,
	canIncidentAction,
	type IncidentWithRelations,
	SEVERITY_LABEL,
	type Severity,
} from "@prismalens/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { MoreHorizontal } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { MergeDialog } from "@/components/incidents/MergeDialog";
import { ResolveDialog } from "@/components/incidents/ResolveDialog";
import { DestructiveConfirm } from "@/components/shared/DestructiveConfirm";
import { Hint } from "@/components/shared/Hint";
import { Mono } from "@/components/shared/Mono";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useInvestigationReadiness } from "@/lib/api/hooks";
import { incidentKeys } from "@/lib/api/hooks/use-incidents-orpc";
import { investigationKeys } from "@/lib/api/hooks/use-investigations-orpc";
import { orpc } from "@/lib/api/orpc-client";
import { getErrorMessage } from "@/lib/get-error-message";
import { incidentServices } from "@/lib/service-lanes";
import { cn } from "@/lib/utils";
import {
	actionsOf,
	ago,
	FIRING_LABEL,
	type Firing,
	firingOf,
	firingSeries,
	type Grouped,
	liveOf,
	NEED_GROUPS,
	type NeedKey,
	type RowAction,
	reasonOf,
	sparkPoints,
	type Tone,
} from "./inbox-model";

const CAP = 5;

const TONE_TEXT: Record<Tone, string> = {
	accent: "text-accent",
	danger: "text-danger",
	warn: "text-warn",
	ok: "text-ok",
	live: "text-live",
	plain: "text-text-2",
};

const FIRING_TEXT: Record<Firing, string> = {
	worse: "text-danger",
	steady: "text-warn",
	clear: "text-text-3",
	none: "text-text-3",
};

type Prompt =
	| { kind: "resolve"; incident: IncidentWithRelations }
	| { kind: "merge"; incident: IncidentWithRelations; targetId: string }
	| { kind: "merge-pick"; incident: IncidentWithRelations };

/** Needs you (spec §1): the filter, then one card per group, five rows each until "Show N more". */
export function NeedsYou({ groups, now }: { groups: Grouped[]; now: number }) {
	const [filter, setFilter] = useState<NeedKey | "all">("all");
	const [more, setMore] = useState<Partial<Record<NeedKey, boolean>>>({});
	const [prompt, setPrompt] = useState<Prompt | null>(null);
	const [busy, setBusy] = useState<Record<string, string>>({});
	const arrived = useArrivals(groups);
	const act = useRowActions(setBusy);
	const total = groups.reduce((n, g) => n + g.rows.length, 0);
	const shown =
		filter === "all" || !groups.some((g) => g.key === filter)
			? groups
			: groups.filter((g) => g.key === filter);

	const run = (incident: IncidentWithRelations, action: RowAction) => {
		if (action.kind === "investigate") act.investigate(incident);
		else if (action.kind === "resolve")
			setPrompt({ kind: "resolve", incident });
		else if (action.kind === "merge")
			setPrompt({ kind: "merge", incident, targetId: action.targetId });
		else act.open(incident, action.runId);
	};

	return (
		<section
			aria-labelledby="needs-heading"
			className="flex shrink-0 flex-col gap-2"
			data-testid="needs-you"
		>
			<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
				<h2 id="needs-heading" className="text-title">
					Needs you
				</h2>
				{total > 0 && (
					<span className="text-text-3" data-testid="needs-count">
						{total === 1 ? "1 incident" : `${total} incidents`}
					</span>
				)}
				<span className="flex-1" />
				{groups.length > 1 && (
					<fieldset
						aria-label="Show"
						className="flex flex-wrap gap-0.5 rounded-control bg-surface-1 p-0.5"
						data-testid="needs-filter"
					>
						{[
							{ key: "all" as const, label: "All", count: total },
							...groups.map((g) => ({
								key: g.key,
								label: label(g.key),
								count: g.rows.length,
							})),
						].map((f) => {
							const on = f.key === filter;
							return (
								<button
									key={f.key}
									type="button"
									aria-pressed={on}
									onClick={() => setFilter(f.key)}
									className={cn(
										"h-6 rounded-[4px] px-2.5 text-body text-text-2 transition-colors duration-(--dur-instant) hover:text-text-1",
										on && "bg-surface-3 text-text-1",
									)}
									data-testid={`needs-filter-${f.key}`}
								>
									{f.label}{" "}
									<span className="text-text-3 tabular-nums">{f.count}</span>
								</button>
							);
						})}
					</fieldset>
				)}
			</div>
			{shown.map((g) => {
				const meta = NEED_GROUPS.find((x) => x.key === g.key);
				const open = !!more[g.key];
				const rows = open ? g.rows : g.rows.slice(0, CAP);
				const hidden = g.rows.length - rows.length;
				return (
					<section
						key={g.key}
						aria-labelledby={`need-${g.key}`}
						className="pool flex flex-col gap-0.5 p-1.5"
						data-testid="needs-group"
						data-need={g.key}
					>
						<div className="flex min-w-0 items-center gap-2.5 px-2.5 pt-1 pb-1.5 whitespace-nowrap">
							<h3 id={`need-${g.key}`} className="text-heading">
								{meta?.label}
							</h3>
							<span className="truncate text-text-3">{meta?.hint}</span>
						</div>
						{rows.map((incident) => (
							<InboxRow
								key={incident.id}
								incident={incident}
								need={g.key}
								now={now}
								fresh={arrived.has(incident.id)}
								busy={busy[incident.id]}
								onAction={(a) => run(incident, a)}
								onMergePick={() => setPrompt({ kind: "merge-pick", incident })}
							/>
						))}
						{hidden > 0 && (
							<Button
								variant="text"
								size="default"
								className="my-0.5 self-start text-accent md:ml-[130px]"
								onClick={() => setMore((m) => ({ ...m, [g.key]: true }))}
								data-testid="needs-more"
							>
								Show {hidden.toLocaleString("en-US")} more
							</Button>
						)}
					</section>
				);
			})}
			{prompt?.kind === "resolve" && (
				<ResolveDialog
					open
					incident={prompt.incident}
					onOpenChange={(o) => !o && setPrompt(null)}
					isPending={act.closing}
					onConfirm={(cause) => {
						const { incident } = prompt;
						setPrompt(null);
						act.resolve(incident, cause);
					}}
				/>
			)}
			{prompt?.kind === "merge" && (
				<DestructiveConfirm
					open
					onOpenChange={(o) => !o && setPrompt(null)}
					title={`Merge INC-${prompt.incident.number}?`}
					description={`Its alerts move to the newer incident and INC-${prompt.incident.number} ends as merged. Its runs stay where they are.`}
					confirmLabel="Merge"
					onConfirm={() =>
						act
							.merge(prompt.incident, prompt.targetId)
							.then(() => setPrompt(null))
					}
				/>
			)}
			{prompt?.kind === "merge-pick" && (
				<MergeDialog
					open
					incident={prompt.incident}
					onOpenChange={(o) => !o && setPrompt(null)}
				/>
			)}
		</section>
	);
}

function label(key: NeedKey) {
	return NEED_GROUPS.find((g) => g.key === key)?.label ?? key;
}

/** One incident's row (spec §1): severity, ID, title and service over the reason, signal, firing, age, actions. */
function InboxRow({
	incident,
	need,
	now,
	fresh,
	busy,
	onAction,
	onMergePick,
}: {
	incident: IncidentWithRelations;
	need: NeedKey;
	now: number;
	fresh: boolean;
	busy?: string;
	onAction: (a: RowAction) => void;
	onMergePick: () => void;
}) {
	const firing = firingOf(incident, now);
	const reason = reasonOf(incident, need, now);
	const { primary, secondary } = actionsOf(incident, need, firing);
	const live = liveOf(incident);
	const service = incidentServices(incident)[0]?.name;
	const severity = incident.severity as Severity;
	const series = firing === "none" ? null : firingSeries(incident, now);
	const canClose = canIncidentAction("close", incident.status);
	const used = new Set([primary.kind, secondary?.kind]);
	return (
		<div
			className="flex min-h-[52px] min-w-0 items-center gap-3.5 rounded-surface px-2.5 whitespace-nowrap transition-colors duration-(--dur-instant) hover:bg-surface-2 max-md:flex-wrap max-md:gap-y-1.5 max-md:py-2"
			data-testid="inbox-row"
			data-incident={incident.id}
			data-new={fresh ? "" : undefined}
		>
			<span
				className="w-14 shrink-0 text-meta font-medium"
				style={{ color: `var(--sev-${severity})` }}
			>
				{SEVERITY_LABEL[severity] ?? incident.severity}
			</span>
			<Mono className="w-[52px] shrink-0 text-text-3">
				INC-{incident.number}
			</Mono>
			<div className="flex min-w-0 flex-1 flex-col max-md:basis-full">
				<span className="flex min-w-0 items-baseline gap-2.5">
					<Hint label={incident.title}>
						<Link
							to="/incidents/$id"
							params={{ id: incident.id }}
							dir="auto"
							className="min-w-0 truncate font-medium text-text-1 hover:underline hover:underline-offset-3"
							data-testid="inbox-row-title"
						>
							{incident.title}
						</Link>
					</Hint>
					{service && (
						<span
							dir="auto"
							className="max-w-[180px] min-w-0 shrink truncate text-meta text-text-3"
						>
							{service}
						</span>
					)}
				</span>
				<span
					dir="auto"
					className="flex min-w-0 items-center gap-1.5 text-meta text-text-2"
					data-testid="inbox-row-reason"
				>
					{live && (
						<span
							className="breathe size-1.5 shrink-0 rounded-full bg-live"
							data-testid="inbox-row-live"
						>
							<span className="sr-only">A run is working.</span>
						</span>
					)}
					{reason.tag && (
						<span
							className={cn(
								"shrink-0 font-medium",
								TONE_TEXT[live ? "live" : reason.tagTone],
							)}
						>
							{reason.tag}
						</span>
					)}
					<span className="truncate">{reason.text}</span>
				</span>
			</div>
			<span className="flex w-[72px] shrink-0 items-center max-xl:hidden">
				{series && (
					<svg
						width="72"
						height="24"
						viewBox="0 0 72 24"
						role="img"
						aria-label={`Firing alerts, last 24 hours: ${FIRING_LABEL[firing].toLowerCase()}`}
					>
						<polyline
							points={sparkPoints(series)}
							fill="none"
							strokeWidth="1.5"
							strokeLinejoin="round"
							strokeLinecap="round"
							className={cn(
								"stroke-text-3",
								firing === "worse" && "stroke-danger",
								firing === "steady" && "stroke-warn",
							)}
						/>
					</svg>
				)}
			</span>
			<span
				className={cn(
					"w-[100px] shrink-0 text-meta font-medium",
					FIRING_TEXT[firing],
				)}
				data-testid="inbox-row-firing"
			>
				{FIRING_LABEL[firing]}
			</span>
			<span className="w-[52px] shrink-0 text-right text-meta text-text-3 tabular-nums">
				{ago(incident.triggeredAt, now)} ago
			</span>
			<span className="flex w-[240px] shrink-0 items-center justify-end gap-1 max-md:ml-auto max-md:w-auto">
				{secondary && (
					<Button
						variant="text"
						onClick={() => onAction(secondary)}
						disabled={!!busy}
						data-testid="inbox-row-secondary"
					>
						{secondary.label}
					</Button>
				)}
				<Button
					variant="secondary"
					className="min-w-24"
					onClick={() => onAction(primary)}
					disabled={!!busy}
					data-testid="inbox-row-action"
					data-action={primary.kind}
				>
					{busy ?? primary.label}
				</Button>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="text"
							size="icon"
							aria-label={`More actions for INC-${incident.number}`}
							data-testid="inbox-row-menu"
						>
							<MoreHorizontal className="size-4" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<MenuLink to={incident.id}>Open overview</MenuLink>
						{!used.has("investigate") && (
							<DropdownMenuItem
								onSelect={() =>
									onAction({ kind: "investigate", label: "Investigate again" })
								}
							>
								Investigate again
							</DropdownMenuItem>
						)}
						{canClose && !used.has("resolve") && (
							<DropdownMenuItem
								onSelect={() => onAction({ kind: "resolve", label: "Resolve" })}
							>
								Resolve
							</DropdownMenuItem>
						)}
						<DropdownMenuItem onSelect={onMergePick}>
							Merge into another incident
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</span>
		</div>
	);
}

function MenuLink({ to, children }: { to: string; children: ReactNode }) {
	return (
		<DropdownMenuItem asChild>
			<Link to="/incidents/$id" params={{ id: to }}>
				{children}
			</Link>
		</DropdownMenuItem>
	);
}

/** Rows that appear after the first paint settle in with the arrival glow, once. */
function useArrivals(groups: Grouped[]): Set<string> {
	const seen = useRef<Set<string> | null>(null);
	const [fresh, setFresh] = useState<Set<string>>(new Set());
	const ids = groups.flatMap((g) => g.rows.map((r) => r.id)).join(",");
	useEffect(() => {
		const now = ids ? ids.split(",") : [];
		if (seen.current === null) {
			seen.current = new Set(now);
			return;
		}
		const added = now.filter((id) => !seen.current?.has(id));
		for (const id of now) seen.current.add(id);
		if (added.length === 0) return;
		setFresh((f) => new Set(Array.from(f).concat(added)));
		const t = window.setTimeout(
			() =>
				setFresh(
					(f) => new Set(Array.from(f).filter((id) => !added.includes(id))),
				),
			3000,
		);
		return () => window.clearTimeout(t);
	}, [ids]);
	return fresh;
}

/** The mutations a row's buttons call; a row shows its in-flight word until the list refreshes. */
function useRowActions(
	setBusy: (f: (b: Record<string, string>) => Record<string, string>) => void,
) {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const { toast } = useToast();
	const { isReady, blockedReason } = useInvestigationReadiness();
	const investigate = useMutation(orpc.incidents.investigate.mutationOptions());
	const close = useMutation(orpc.incidents.close.mutationOptions());
	const merge = useMutation(orpc.incidents.merge.mutationOptions());
	const done = (id: string) => async () => {
		await queryClient.invalidateQueries({ queryKey: incidentKeys.all() });
		await queryClient.invalidateQueries({ queryKey: investigationKeys.all() });
		setBusy(({ [id]: _, ...rest }) => rest);
	};
	const fail = (id: string, title: string) => (error: unknown) => {
		setBusy(({ [id]: _, ...rest }) => rest);
		toast({
			title,
			description: getErrorMessage(error),
			variant: "destructive",
		});
	};
	return {
		closing: close.isPending,
		open: (incident: IncidentWithRelations, runId?: string) =>
			runId
				? navigate({ to: "/investigations/$id", params: { id: runId } })
				: navigate({ to: "/incidents/$id", params: { id: incident.id } }),
		investigate: (incident: IncidentWithRelations) => {
			if (!isReady) {
				toast({
					title: "No run started",
					description: blockedReason,
					variant: "destructive",
				});
				return;
			}
			setBusy((b) => ({ ...b, [incident.id]: "Starting" }));
			investigate.mutate(
				{ id: incident.id },
				{
					onSuccess: done(incident.id),
					onError: fail(incident.id, "Investigation refused"),
				},
			);
		},
		resolve: (
			incident: IncidentWithRelations,
			cause: Omit<CloseIncidentInput, "id">,
		) => {
			setBusy((b) => ({ ...b, [incident.id]: "Resolving" }));
			close.mutate(
				{ id: incident.id, ...cause },
				{
					onSuccess: done(incident.id),
					onError: fail(incident.id, "Not resolved"),
				},
			);
		},
		merge: (incident: IncidentWithRelations, targetId: string) =>
			merge.mutateAsync({ id: incident.id, targetId }).then(done(incident.id)),
	};
}
