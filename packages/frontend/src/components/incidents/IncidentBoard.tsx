// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	INCIDENT_ATTENTION_LABEL,
	INCIDENT_STATUS_LABEL,
	type IncidentStatus,
	type IncidentWithRelations,
	SEVERITY_LABEL,
} from "@prismalens/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
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
import { cn } from "@/lib/utils";
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
 * The board (#743 §3c, layer 0): the landing when no incident is open. Four
 * columns in the order an SRE asks, from the same query and predicates as the
 * list pane, so a card and its row never disagree. 1 to 4 pick a column,
 * j and k move, Enter opens.
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
	const navigate = useNavigate();
	const now = useNow();
	const columns = useMemo(() => groupByColumn(incidents), [incidents]);
	const [cursor, setCursor] = useState<{ col: number; row: number } | null>(
		null,
	);
	const flipRef = useFlip(incidents);

	const open = useCallback(
		(incident: IncidentWithRelations) =>
			navigate({
				to: "/incidents/$id",
				params: { id: incident.id },
				search,
			}),
		[navigate, search],
	);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
			const n = Number(e.key);
			if (n >= 1 && n <= 4) {
				e.preventDefault();
				setCursor({ col: n - 1, row: 0 });
				return;
			}
			if (!cursor) {
				if (e.key === "j" || e.key === "ArrowDown") {
					e.preventDefault();
					const first = BOARD_COLUMNS.findIndex(
						(c) => columns[c.id].length > 0,
					);
					if (first >= 0) setCursor({ col: first, row: 0 });
				}
				return;
			}
			const list = columns[BOARD_COLUMNS[cursor.col]?.id ?? "needs_you"];
			if (e.key === "j" || e.key === "ArrowDown") {
				e.preventDefault();
				setCursor({
					...cursor,
					row: Math.min(list.length - 1, cursor.row + 1),
				});
			} else if (e.key === "k" || e.key === "ArrowUp") {
				e.preventDefault();
				setCursor({ ...cursor, row: Math.max(0, cursor.row - 1) });
			} else if (e.key === "ArrowRight" || e.key === "l") {
				e.preventDefault();
				setCursor({ col: Math.min(3, cursor.col + 1), row: 0 });
			} else if (e.key === "ArrowLeft" || e.key === "h") {
				e.preventDefault();
				setCursor({ col: Math.max(0, cursor.col - 1), row: 0 });
			} else if (e.key === "Enter") {
				const hit = list[cursor.row];
				if (hit) {
					e.preventDefault();
					open(hit);
				}
			} else if (e.key === "Escape") {
				setCursor(null);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [columns, cursor, open]);

	return (
		<div className="relative flex min-h-0 flex-1">
			<div
				ref={flipRef}
				className="hidden min-h-0 flex-1 grid-cols-4 lg:grid"
				data-testid="incident-board"
			>
				{BOARD_COLUMNS.map((column, ci) => {
					const cards = columns[column.id];
					return (
						<section
							key={column.id}
							aria-label={column.label}
							className="flex min-h-0 min-w-0 flex-col border-r last:border-r-0"
							data-testid={`board-column-${column.id}`}
						>
							<div className="flex h-8 shrink-0 items-center gap-2 border-b px-3">
								<StateWord tone={COLUMN_TONE[column.id]}>
									{column.label}
								</StateWord>
								<Mono className="ml-auto text-meta text-muted-foreground">
									{cards.length}
								</Mono>
							</div>
							<ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
								{cards.map((incident, ri) => (
									<li key={incident.id} data-flip={incident.id}>
										<BoardCard
											incident={incident}
											column={column.id}
											now={now}
											search={search}
											cursor={cursor?.col === ci && cursor.row === ri}
										/>
									</li>
								))}
							</ul>
						</section>
					);
				})}
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
	cursor,
}: {
	incident: IncidentWithRelations;
	column: BoardColumn;
	now: number | null;
	search: IncidentsSearch;
	cursor: boolean;
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
			data-cursor={cursor ? "true" : undefined}
			className={cn(
				"block space-y-1 rounded-md border bg-background px-3 py-2 outline-none hover:bg-muted/60",
				cursor && "bg-muted/60 ring-1 ring-primary/50",
			)}
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
						tone={runStateTone(word.state)}
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
