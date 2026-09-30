// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	INCIDENT_ATTENTION_LABEL,
	INCIDENT_STATUS_LABEL,
	type IncidentStatus,
	type IncidentWithRelations,
	SEVERITY_LABEL,
} from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import {
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
} from "react";
import { Mono } from "@/components/shared/Mono";
import { type ChipTone, StateWord } from "@/components/shared/StateChip";
import { ago, useNow } from "@/hooks/use-now";
import { attentionFor, attentionTone } from "@/lib/incident-attention";
import {
	BOARD_COLUMNS,
	type BoardColumn,
	boardColumn,
	incidentHeadline,
	runWord,
} from "@/lib/incident-board";
import { incidentStatusTone, runStateTone } from "@/lib/state-tone";
import type { IncidentsSearch } from "@/routes/_authenticated/incidents/route";

const COLUMN_TONE: Record<BoardColumn, ChipTone> = {
	needs_you: "critical",
	working: "active",
	concluded: "done",
	resolved: "neutral",
};

/** Incidents per column, each column in the list's order. */
export function groupByColumn(
	incidents: IncidentWithRelations[],
): Record<BoardColumn, IncidentWithRelations[]> {
	const out: Record<BoardColumn, IncidentWithRelations[]> = {
		needs_you: [],
		working: [],
		concluded: [],
		resolved: [],
	};
	for (const i of incidents) out[boardColumn(i)].push(i);
	return out;
}

function isTyping(target: EventTarget | null): boolean {
	const el = target as HTMLElement | null;
	const tag = el?.tagName;
	return (
		tag === "INPUT" ||
		tag === "TEXTAREA" ||
		tag === "SELECT" ||
		!!el?.isContentEditable
	);
}

/**
 * A card that moves column travels there instead of blinking out and in
 * (#743 motion item 14). Skipped under reduced motion.
 */
function useFlip(deps: unknown) {
	const container = useRef<HTMLDivElement>(null);
	const rects = useRef(new Map<string, DOMRect>());
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the cards change.
	useLayoutEffect(() => {
		const root = container.current;
		if (!root) return;
		const reduce = window.matchMedia(
			"(prefers-reduced-motion: reduce)",
		).matches;
		const next = new Map<string, DOMRect>();
		for (const el of Array.from(
			root.querySelectorAll<HTMLElement>("[data-flip]"),
		)) {
			const id = el.dataset.flip ?? "";
			const rect = el.getBoundingClientRect();
			next.set(id, rect);
			const prev = rects.current.get(id);
			if (reduce || !prev) continue;
			const dx = prev.left - rect.left;
			const dy = prev.top - rect.top;
			if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
			el.style.transition = "none";
			el.style.transform = `translate(${dx}px, ${dy}px)`;
			requestAnimationFrame(() => {
				el.style.transition = `transform ${Math.abs(dx) > 1 ? 300 : 150}ms cubic-bezier(0.4, 0, 0.2, 1)`;
				el.style.transform = "";
			});
		}
		rects.current = next;
	}, [deps]);
	return container;
}

/**
 * The board (#743 §3c, layer 0): the landing beside the list. Four columns in
 * the order an SRE asks, from the same query and predicates as the list pane,
 * so a card and its row never disagree. The board scrolls as one region; 1 to
 * 4 put focus on a column's first card. j, k and Enter stay with the list.
 */
export function IncidentBoard({
	incidents,
	search,
	empty,
}: {
	incidents: IncidentWithRelations[];
	search: IncidentsSearch;
	/** Shown over the empty columns: the first-run panel, or a window note. */
	empty?: ReactNode;
}) {
	const now = useNow();
	const columns = useMemo(() => groupByColumn(incidents), [incidents]);
	const flipRef = useFlip(incidents);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
			const n = Number(e.key);
			if (!(n >= 1 && n <= 4)) return;
			const first = flipRef.current?.querySelector<HTMLElement>(
				`[data-column="${BOARD_COLUMNS[n - 1]?.id}"] a`,
			);
			if (first) {
				e.preventDefault();
				first.focus();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [flipRef]);

	return (
		<div className="relative flex min-h-0 flex-1 flex-col">
			<div
				ref={flipRef}
				className="hidden min-h-0 flex-1 overflow-y-auto lg:block"
				data-testid="incident-board"
			>
				<div className="sticky top-0 z-10 grid grid-cols-4 gap-2 bg-background px-2">
					{BOARD_COLUMNS.map((column) => (
						<div key={column.id} className="flex h-8 items-center gap-2 px-3">
							<StateWord tone={COLUMN_TONE[column.id]}>
								{column.label}
							</StateWord>
							<Mono className="ml-auto text-meta text-muted-foreground">
								{columns[column.id].length}
							</Mono>
						</div>
					))}
				</div>
				<div className="grid grid-cols-4 gap-2 px-2">
					{BOARD_COLUMNS.map((column) => (
						<ul
							key={column.id}
							aria-label={column.label}
							data-column={column.id}
							className="flex min-w-0 flex-col gap-2 pb-2"
							data-testid={`board-column-${column.id}`}
						>
							{columns[column.id].map((incident) => (
								<li key={incident.id} data-flip={incident.id}>
									<BoardCard
										incident={incident}
										column={column.id}
										now={now}
										search={search}
									/>
								</li>
							))}
						</ul>
					))}
				</div>
			</div>
			{empty && (
				<div className="absolute inset-0 flex items-start justify-center overflow-y-auto p-4 lg:top-8 lg:pt-10">
					<div className="w-full max-w-2xl rounded-md border bg-background">
						{empty}
					</div>
				</div>
			)}
		</div>
	);
}

function BoardCard({
	incident,
	column,
	now,
	search,
}: {
	incident: IncidentWithRelations;
	column: BoardColumn;
	now: number | null;
	search: IncidentsSearch;
}) {
	const why = attentionFor(incident);
	const word = runWord(incident, now);
	const headline = incidentHeadline(incident);
	const service =
		incident.service?.displayName || incident.service?.name || "no service";

	return (
		<Link
			to="/incidents/$id"
			params={{ id: incident.id }}
			search={search}
			data-testid="board-card"
			className="block space-y-1 rounded-md bg-muted/40 px-3 py-2 outline-none hover:bg-muted/70 focus-visible:bg-muted/70 focus-visible:ring-1 focus-visible:ring-primary/50"
		>
			<div className="flex items-center gap-1.5 text-meta text-muted-foreground">
				<span
					role="img"
					aria-label={SEVERITY_LABEL[incident.severity]}
					title={SEVERITY_LABEL[incident.severity]}
					className="h-2 w-2 shrink-0 rounded-full"
					style={{ background: `var(--sev-${incident.severity})` }}
				/>
				<span className="truncate">{service}</span>
				<Mono className="ml-auto shrink-0">INC-{incident.number}</Mono>
			</div>
			<p
				className="line-clamp-2 text-record leading-snug font-medium"
				title={incident.title}
			>
				{incident.title}
			</p>
			<div className="flex items-center gap-2 text-meta">
				{column === "needs_you" && why ? (
					<StateWord tone={attentionTone[why]}>
						{INCIDENT_ATTENTION_LABEL[why]}
					</StateWord>
				) : word ? (
					<StateWord
						tone={word.stale ? "stale" : runStateTone(word.state)}
						pulse
						className="tabular-nums"
					>
						{word.text}
					</StateWord>
				) : (
					<StateWord tone={incidentStatusTone(incident.status)}>
						{INCIDENT_STATUS_LABEL[incident.status as IncidentStatus] ??
							incident.status}
					</StateWord>
				)}
				<span className="ml-auto shrink-0 text-muted-foreground tabular-nums">
					{ago(incident.triggeredAt, now)}
				</span>
			</div>
			<p className="truncate text-meta text-muted-foreground">
				{headline.lead && (
					<span className="font-medium text-foreground">{headline.lead} </span>
				)}
				{headline.text}
			</p>
		</Link>
	);
}
