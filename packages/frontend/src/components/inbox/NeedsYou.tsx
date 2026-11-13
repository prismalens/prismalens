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
import { ExternalLink, GitMerge, RotateCw, SquareCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MergeDialog } from "@/components/incidents/MergeDialog";
import { ResolveDialog } from "@/components/incidents/ResolveDialog";
import { ListCard, ListGrid } from "@/components/kit/ListCard";
import { Mark } from "@/components/kit/Mark";
import type { MenuEntry } from "@/components/kit/Menu";
import { Tabs } from "@/components/kit/Tabs";
import { DestructiveConfirm } from "@/components/shared/DestructiveConfirm";
import { Mono } from "@/components/shared/Mono";
import { Ring } from "@/components/shared/Ring";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
	useInvestigationReadiness,
	useResumeInvestigation,
} from "@/lib/api/hooks";
import { incidentKeys } from "@/lib/api/hooks/use-incidents-orpc";
import { investigationKeys } from "@/lib/api/hooks/use-investigations-orpc";
import { orpc } from "@/lib/api/orpc-client";
import { getErrorMessage } from "@/lib/get-error-message";
import { incidentServices } from "@/lib/service-lanes";
import { readableTitle } from "@/lib/title";
import { cn } from "@/lib/utils";
import {
	actionsOf,
	ago,
	FIRING_LABEL,
	firingOf,
	type Grouped,
	liveOf,
	NEED_GROUPS,
	type NeedKey,
	type RowAction,
	reasonOf,
	type Tone,
} from "./inbox-model";

const CAP = 6;

const TONE_TEXT: Record<Tone, string> = {
	accent: "text-accent",
	danger: "text-danger",
	warn: "text-warn",
	ok: "text-ok",
	live: "text-live",
	plain: "text-text-2",
};

const SEVERITY_RANK: Record<string, number> = {
	critical: 0,
	high: 1,
	medium: 2,
	low: 3,
	info: 4,
};

type Prompt =
	| { kind: "resolve"; incident: IncidentWithRelations }
	| { kind: "merge"; incident: IncidentWithRelations; targetId: string }
	| { kind: "merge-pick"; incident: IncidentWithRelations };

/** One subject: an incident and the open repeats of it (same title, same service), newest first. */
export interface Folded {
	incident: IncidentWithRelations;
	repeats: IncidentWithRelations[];
}

/**
 * Triage order inside a band: severity, then newest; repeats of one subject
 * fold into its newest row as ×N (#1101).
 */
export function triage(rows: readonly IncidentWithRelations[]): Folded[] {
	const sorted = [...rows].sort(
		(a, b) =>
			(SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) ||
			Date.parse(String(b.triggeredAt)) - Date.parse(String(a.triggeredAt)),
	);
	const by = new Map<string, Folded>();
	for (const i of sorted) {
		const key = `${readableTitle(i.title).replace(/\s*#\d+\b/g, "")}|${incidentServices(i)[0]?.name ?? ""}`;
		const hit = by.get(key);
		if (hit) hit.repeats.push(i);
		else by.set(key, { incident: i, repeats: [] });
	}
	return Array.from(by.values());
}

/** Needs you (spec §1): one tab per band, then each band's cards in triage order. */
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
		else if (action.kind === "resume") act.resume(incident, action.runId);
		else if (action.kind === "resolve")
			setPrompt({ kind: "resolve", incident });
		else if (action.kind === "merge")
			setPrompt({ kind: "merge", incident, targetId: action.targetId });
		else act.open(incident, action.runId);
	};

	return (
		<section
			aria-labelledby="needs-heading"
			className="flex shrink-0 flex-col gap-3"
			data-testid="needs-you"
		>
			<div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
				<h2 id="needs-heading" className="text-title">
					To look at
				</h2>
				<span className="text-text-3 tabular-nums" data-testid="needs-count">
					{total}
				</span>
				{groups.length > 1 && (
					<div className="ml-auto min-w-0" data-testid="needs-filter">
						<Tabs
							label="Show"
							value={filter}
							onValueChange={(v) => setFilter(v as NeedKey | "all")}
							items={[
								{
									value: "all",
									label: "All",
									count: total,
									testId: "needs-filter-all",
								},
								...groups.map((g) => ({
									value: g.key,
									label: label(g.key),
									count: g.rows.length,
									testId: `needs-filter-${g.key}`,
								})),
							]}
						/>
					</div>
				)}
			</div>
			{shown.map((g) => {
				const open = !!more[g.key];
				const folded = open
					? g.rows.map((incident) => ({ incident, repeats: [] }))
					: triage(g.rows);
				const cards = open ? folded : folded.slice(0, CAP);
				const hidden = g.rows.length - cards.length;
				return (
					<section
						key={g.key}
						aria-labelledby={`need-${g.key}`}
						className="flex flex-col gap-1.5"
						data-testid="needs-group"
						data-need={g.key}
					>
						<h3
							id={`need-${g.key}`}
							className="flex items-center gap-2 text-heading"
						>
							{label(g.key)}
							<span className="text-meta font-normal text-text-3 tabular-nums">
								{g.rows.length}
							</span>
						</h3>
						<ListGrid label={label(g.key)} wide>
							{cards.map((f) => (
								<IncidentCard
									key={f.incident.id}
									incident={f.incident}
									repeats={f.repeats.length}
									need={g.key}
									now={now}
									fresh={arrived.has(f.incident.id)}
									busy={busy[f.incident.id]}
									onAction={(a) => run(f.incident, a)}
									onMergePick={() =>
										setPrompt({ kind: "merge-pick", incident: f.incident })
									}
								/>
							))}
						</ListGrid>
						{hidden > 0 && (
							<Button
								variant="text"
								size="default"
								className="self-start text-accent"
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

/**
 * One incident as a list card (sheet §6): severity mark and title, then
 * marks for its ID, alerts, a live run, repeats and age; the reason under them.
 */
export function IncidentCard({
	incident,
	repeats = 0,
	need,
	now,
	fresh = false,
	busy,
	onAction,
	onMergePick,
}: {
	incident: IncidentWithRelations;
	repeats?: number;
	need: NeedKey;
	now: number;
	fresh?: boolean;
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
	const canClose = canIncidentAction("close", incident.status);
	const used = new Set([primary.kind, secondary?.kind]);
	const menu: MenuEntry[] = [
		{
			id: "open",
			label: "Open overview",
			icon: ExternalLink,
			onSelect: () => onAction({ kind: "open", label: "Open" }),
		},
		...(secondary
			? [
					{
						id: `secondary-${secondary.kind}`,
						label: secondary.label,
						onSelect: () => onAction(secondary),
					},
				]
			: []),
		...(!used.has("investigate")
			? [
					{
						id: "investigate",
						label: "Investigate again",
						icon: RotateCw,
						onSelect: () =>
							onAction({ kind: "investigate", label: "Investigate again" }),
					},
				]
			: []),
		...(canClose && !used.has("resolve")
			? [
					{
						id: "resolve",
						label: "Resolve",
						icon: SquareCheck,
						onSelect: () => onAction({ kind: "resolve", label: "Resolve" }),
					},
				]
			: []),
		{
			id: "merge",
			label: "Merge into another",
			icon: GitMerge,
			onSelect: onMergePick,
		},
	];
	return (
		<ListCard
			testId="inbox-row"
			title={readableTitle(incident.title)}
			icon={
				<Mark
					id="severity"
					state={severity}
					word={SEVERITY_LABEL[severity] ?? incident.severity}
				/>
			}
			link={(title) => (
				<Link
					to="/incidents/$id"
					params={{ id: incident.id }}
					dir="auto"
					data-testid="inbox-row-title"
					data-new={fresh ? "" : undefined}
				>
					{title}
				</Link>
			)}
			meta={
				<span className="flex min-w-0 items-center gap-2.5">
					<Mono className="shrink-0 text-text-3">INC-{incident.number}</Mono>
					<Mark
						id="firing"
						state={firing}
						word={FIRING_LABEL[firing]}
						testId="inbox-row-firing"
					/>
					{live && (
						<span
							role="img"
							aria-label="A run is working"
							className="flex shrink-0"
							data-testid="inbox-row-live"
						>
							<Ring className="size-3.5 text-accent" />
						</span>
					)}
					{repeats > 0 && (
						<Mark
							id="repeats"
							word={`${repeats + 1} like this`}
							className="text-text-2"
							testId="inbox-row-repeats"
						>
							×{repeats + 1}
						</Mark>
					)}
					<span className="shrink-0 text-text-3 tabular-nums">
						{ago(incident.triggeredAt, now)}
					</span>
					{service && (
						<span dir="auto" className="min-w-0 truncate text-text-3">
							{service}
						</span>
					)}
				</span>
			}
			detail={
				<span dir="auto" data-testid="inbox-row-reason">
					{reason.tag && (
						<span
							className={cn(
								"font-medium",
								TONE_TEXT[live ? "live" : reason.tagTone],
							)}
						>
							{reason.tag}{" "}
						</span>
					)}
					{reason.text}
				</span>
			}
			footer={
				primary.kind !== "open" || busy ? (
					<Button
						variant="secondary"
						size="sm"
						onClick={() => onAction(primary)}
						disabled={!!busy}
						data-testid="inbox-row-action"
						data-action={primary.kind}
					>
						{busy ?? primary.label}
					</Button>
				) : undefined
			}
			menu={menu}
		/>
	);
}

/** Rows that appear after the first paint settle in with the arrival glow, once. */
function useArrivals(groups: Grouped[]): Set<string> {
	const seen = useRef<Set<string> | null>(null);
	const [fresh, setFresh] = useState<Set<string>>(new Set());
	const timers = useRef<number[]>([]);
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
		// Each batch ends its own glow: a later arrival must not cancel an earlier timer.
		timers.current.push(
			window.setTimeout(
				() =>
					setFresh(
						(f) => new Set(Array.from(f).filter((id) => !added.includes(id))),
					),
				3000,
			),
		);
	}, [ids]);
	useEffect(() => () => timers.current.forEach(window.clearTimeout), []);
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
	const cancel = useMutation(orpc.investigations.cancel.mutationOptions());
	const resume = useResumeInvestigation();
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
		/** Takes up the run a restart cut off, by its own id; never a new investigation (#1010). */
		resume: (incident: IncidentWithRelations, runId: string) => {
			setBusy((b) => ({ ...b, [incident.id]: "Resuming" }));
			resume.mutate(
				{ id: runId },
				{
					onSuccess: done(incident.id),
					onError: fail(incident.id, "Run not resumed"),
				},
			);
		},
		resolve: (
			incident: IncidentWithRelations,
			cause: Omit<CloseIncidentInput, "id">,
		) => {
			setBusy((b) => ({ ...b, [incident.id]: "Resolving" }));
			const closeIt = () =>
				close.mutate(
					{ id: incident.id, ...cause },
					{
						onSuccess: done(incident.id),
						onError: fail(incident.id, "Not resolved"),
					},
				);
			// Stop whichever turn is live first, an older resumed run or a chat (#673 w59).
			const live = liveOf(incident);
			if (!live) return closeIt();
			cancel.mutate(
				{ id: live.id },
				{
					onSuccess: closeIt,
					onError: fail(incident.id, "Stop did not reach the investigation"),
				},
			);
		},
		merge: (incident: IncidentWithRelations, targetId: string) =>
			merge.mutateAsync({ id: incident.id, targetId }).then(done(incident.id)),
	};
}
