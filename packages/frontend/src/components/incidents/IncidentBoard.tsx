// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type Announcements,
	DndContext,
	type DragEndEvent,
	DragOverlay,
	type DragStartEvent,
	type KeyboardCoordinateGetter,
	KeyboardSensor,
	PointerSensor,
	TouchSensor,
	useDraggable,
	useDroppable,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	canIncidentAction,
	type IncidentWithRelations,
	RUN_STATE_LABEL,
	SEVERITY_LABEL,
} from "@prismalens/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import {
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { AgentMark } from "@/components/agent/AgentMark";
import { Mono } from "@/components/shared/Mono";
import { WrapText } from "@/components/shared/WrapText";
import { Button } from "@/components/ui/button";
import { useNow } from "@/hooks/use-now";
import { useToast } from "@/hooks/use-toast";
import { useHarnesses, useInvestigationReadiness } from "@/lib/api/hooks";
import { incidentKeys } from "@/lib/api/hooks/use-incidents-orpc";
import {
	investigationKeys,
	useCancelInvestigation,
} from "@/lib/api/hooks/use-investigations-orpc";
import { useStreamStatus } from "@/lib/api/live-refresh";
import { orpc } from "@/lib/api/orpc-client";
import {
	acknowledgesFirst,
	columnBeside,
	type DropAction,
	dropAction,
	dropWord,
} from "@/lib/board-drop";
import { formatClock, formatElapsed } from "@/lib/format-time";
import { getErrorMessage } from "@/lib/get-error-message";
import {
	BOARD_COLUMNS,
	type BoardColumn,
	boardColumn,
	type CardTone,
	COLUMN_TONE,
	cardWord,
	headlineAddsInfo,
	incidentHeadline,
	incidentLineage,
	isSettled,
	isWrapUp,
	latestRun,
	liveThread,
	orderNeedsYou,
	runWord,
	shortAge,
	workingEmptyText,
} from "@/lib/incident-board";
import { cn } from "@/lib/utils";
import type { IncidentsSearch } from "@/routes/_authenticated/incidents/route";
import { ReopenDialog } from "./ReopenDialog";
import { ResolveDialog } from "./ResolveDialog";

/** Incidents per column; Needs you in its order (study-v3 §3.1). */
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
	out.needs_you = orderNeedsYou(out.needs_you);
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
				el.style.transition = `transform var(${Math.abs(dx) > 1 ? "--dur-slow" : "--dur-fast"}) var(--ease-standard)`;
				el.style.transform = "";
			});
		}
		rects.current = next;
	}, [deps]);
	return container;
}

/**
 * Cards that entered Needs you since the board first loaded (look ruling
 * §3.2): `data-new` for 3 s in every mode, a second arrival 300 ms behind.
 */
function useArrivals(needs: IncidentWithRelations[]): Map<string, number> {
	const seen = useRef<Set<string> | null>(null);
	const [fresh, setFresh] = useState<Map<string, number>>(new Map());
	const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
	useEffect(() => {
		const ids = needs.map((i) => i.id);
		if (seen.current === null) {
			seen.current = new Set(ids);
			return;
		}
		const known = seen.current;
		const arrived = ids.filter((id) => !known.has(id));
		for (const id of ids) known.add(id);
		if (arrived.length === 0) return;
		setFresh((m) => {
			const next = new Map(m);
			arrived.forEach((id, i) => {
				next.set(id, i * 300);
			});
			return next;
		});
		// Every refetch is a new `needs`; a batch's timer outlives it and ends only with the board.
		timers.current.push(
			setTimeout(
				() =>
					setFresh((m) => {
						const next = new Map(m);
						for (const id of arrived) next.delete(id);
						return next;
					}),
				3_000 + (arrived.length - 1) * 300,
			),
		);
	}, [needs]);
	useEffect(() => {
		const pending = timers.current;
		return () => {
			for (const t of pending) clearTimeout(t);
		};
	}, []);
	return fresh;
}

function prefersReducedMotion(): boolean {
	return (
		typeof window !== "undefined" &&
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
	);
}

/** A drop ends over a card now and then; its click must not open the incident. */
let lastDragEnd = 0;

interface Dragging {
	incident: IncidentWithRelations;
	from: BoardColumn;
}

/** A drop or a card action waiting on the operator. */
type Prompt = { incident: IncidentWithRelations } & (
	| { kind: "reopen-investigate" }
	| { kind: "reopen" }
	| { kind: "resolve"; stopFirst: boolean }
);

const COLUMN_ORDER = BOARD_COLUMNS.map((c) => c.id);
const columnLabel = (id: unknown) =>
	BOARD_COLUMNS.find((c) => c.id === id)?.label ?? String(id);

/** Left and Right carry a picked-up card a whole column, not 25 px (#673 walk 4). */
const columnCoordinates: KeyboardCoordinateGetter = (
	event,
	{ context, currentCoordinates },
) => {
	if (event.code !== "ArrowLeft" && event.code !== "ArrowRight") return;
	const from = context.over?.id as BoardColumn | undefined;
	const to = from && columnBeside(event.code, from, COLUMN_ORDER);
	const rect = to ? context.droppableRects.get(to) : undefined;
	return rect ? { x: rect.left + 4, y: rect.top + 4 } : currentCoordinates;
};

const KEYBOARD_HELP =
	"To move this card, press Space. Left and Right arrows carry it between columns, Space drops it, Escape puts it back.";

function actionFor(d: Dragging, to: BoardColumn): DropAction {
	return dropAction({
		from: d.from,
		to,
		live: !!liveThread(d.incident),
		canResolve: canIncidentAction("close", d.incident.status),
		canReopen: canIncidentAction("reopen", d.incident.status),
		canAcknowledge: canIncidentAction("acknowledge", d.incident.status),
		mergedInto: d.incident.mergedInto?.number ?? null,
	});
}

/** While the change stream is down, live marks go grey and their clocks stop (study-v3 §6). */
function useClock(): { now: number | null; offline: number | null } {
	const now = useNow(1_000);
	const stream = useStreamStatus();
	const offline =
		now !== null && !stream.connected && now - stream.lostAt > 10_000
			? stream.lostAt
			: null;
	return { now: offline ?? now, offline };
}

/**
 * The board (study-v3 §3.1): four columns in the order an SRE asks, from the
 * same predicates as the sidebar. Needs you is ordered and ends in a quiet
 * "To wrap up"; a Triggered card carries Acknowledge. A card dropped on a
 * column does that column's one action; a run starts at once, with no form.
 * Below `xl` the lanes sit two by two; below `md` they stack with their headings.
 */
export function IncidentBoard({
	incidents,
	search,
}: {
	incidents: IncidentWithRelations[];
	search: IncidentsSearch;
}) {
	const { now, offline } = useClock();
	const columns = useMemo(() => groupByColumn(incidents), [incidents]);
	const flipRef = useFlip(incidents);
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const { isReady, blockedReason } = useInvestigationReadiness();
	const [dragging, setDragging] = useState<Dragging | null>(null);
	const [prompt, setPrompt] = useState<Prompt | null>(null);
	// What a confirmed action is doing, on the card until the list confirms it.
	const [busy, setBusy] = useState<Record<string, string>>({});

	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
		useSensor(TouchSensor, {
			activationConstraint: { delay: 200, tolerance: 5 },
		}),
		useSensor(KeyboardSensor, {
			keyboardCodes: {
				start: ["Space"],
				cancel: ["Escape"],
				end: ["Space", "Enter"],
			},
			coordinateGetter: columnCoordinates,
		}),
	);
	// The pickup line stays until the card leaves its own column.
	const moved = useRef(false);
	const carried = (id: unknown): Dragging | null => {
		const incident = incidents.find((i) => i.id === id);
		return incident ? { incident, from: boardColumn(incident) } : null;
	};
	const cardName = (d: Dragging) =>
		`INC-${d.incident.number}, ${d.incident.title}`;
	const announcements: Announcements = {
		onDragStart: ({ active }) => {
			moved.current = false;
			const d = carried(active.id);
			return d
				? `Picked up ${cardName(d)}, in ${columnLabel(d.from)}. Left and Right arrows carry it between columns, Space drops it, Escape puts it back.`
				: undefined;
		},
		onDragOver: ({ active, over }) => {
			const d = carried(active.id);
			if (!d || !over) return undefined;
			if (over.id === d.from && !moved.current) return undefined;
			moved.current = true;
			const to = over.id as BoardColumn;
			return `${columnLabel(to)}: ${dropWord(actionFor(d, to))}.`;
		},
		onDragEnd: ({ active, over }) => {
			const d = carried(active.id);
			if (!d) return undefined;
			return over &&
				over.id !== d.from &&
				actionFor(d, over.id as BoardColumn).kind !== "none"
				? `Dropped ${cardName(d)} on ${columnLabel(over.id)}.`
				: `${cardName(d)} stays in ${columnLabel(d.from)}.`;
		},
		onDragCancel: ({ active }) => {
			const d = carried(active.id);
			return d
				? `Put ${cardName(d)} back in ${columnLabel(d.from)}.`
				: undefined;
		},
	};

	const settle = (id: string) => async () => {
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
	const investigate = useMutation(orpc.incidents.investigate.mutationOptions());
	const close = useMutation(orpc.incidents.close.mutationOptions());
	const update = useMutation(orpc.incidents.update.mutationOptions());
	const cancel = useCancelInvestigation();

	const startRun = (incident: IncidentWithRelations) => {
		if (!isReady) {
			// A reopen-and-investigate lands here with the card still busy.
			void settle(incident.id)();
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
				onSuccess: settle(incident.id),
				onError: fail(incident.id, "Investigation refused"),
			},
		);
	};
	const acknowledge = (incident: IncidentWithRelations, then?: () => void) => {
		setBusy((b) => ({ ...b, [incident.id]: "Acknowledging" }));
		update.mutate(
			{ id: incident.id, status: "investigating" },
			{
				onSuccess: then ?? settle(incident.id),
				onError: fail(incident.id, "Not acknowledged"),
			},
		);
	};
	const stopRun = (incident: IncidentWithRelations, then?: () => void) => {
		// Whichever turn is live, a resumed older run or a chat (#673 w59, OBJ-014).
		const run = liveThread(incident);
		// A refetch can drop the run between the drop and the confirm; never leave the card busy.
		if (!run) {
			if (then) then();
			else settle(incident.id)();
			return;
		}
		cancel.mutate(
			{ id: run.id },
			{
				onSuccess: then ?? settle(incident.id),
				onError: fail(incident.id, "Stop did not reach the investigation"),
			},
		);
	};

	const onDragStart = (e: DragStartEvent) => {
		const incident = incidents.find((i) => i.id === e.active.id);
		if (incident) setDragging({ incident, from: boardColumn(incident) });
	};
	const onDragEnd = (e: DragEndEvent) => {
		const d = dragging;
		setDragging(null);
		lastDragEnd = Date.now();
		if (!d || !e.over) return;
		const action = actionFor(d, e.over.id as BoardColumn);
		if (action.kind === "none") return;
		if (action.kind === "investigate")
			return acknowledgesFirst(action, isReady)
				? acknowledge(d.incident, () => startRun(d.incident))
				: startRun(d.incident);
		if (action.kind === "acknowledge") return acknowledge(d.incident);
		// Stop asks nothing, like the box's Stop; the run ends "Stopped by you" (#673 walk 4).
		if (action.kind === "stop") {
			setBusy((b) => ({ ...b, [d.incident.id]: "Stopping" }));
			return stopRun(d.incident);
		}
		setPrompt(
			action.kind === "resolve"
				? {
						incident: d.incident,
						kind: "resolve",
						stopFirst: action.stopFirst,
					}
				: { incident: d.incident, kind: action.kind },
		);
	};

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

	const arrivals = useArrivals(columns.needs_you);
	const card = (incident: IncidentWithRelations, column: BoardColumn) => (
		<DraggableCard
			key={incident.id}
			arriving={column === "needs_you" ? arrivals.get(incident.id) : undefined}
			incident={incident}
			column={column}
			now={now}
			offline={offline}
			search={search}
			busy={busy[incident.id]}
			onAcknowledge={() => acknowledge(incident)}
		/>
	);
	const needs = columns.needs_you.filter((i) => !isWrapUp(i));
	const wrapUp = columns.needs_you.filter(isWrapUp);
	const at = now ?? Date.now();
	const settled = columns.resolved.filter((i) => isSettled(i, at));
	const resolved = columns.resolved.filter((i) => !isSettled(i, at));
	// Any live run lights Working's head, one sitting in Needs you included (ruling m15).
	const liveMark = incidents.some((i) => !!liveThread(i));

	return (
		<DndContext
			sensors={sensors}
			accessibility={{
				announcements,
				screenReaderInstructions: { draggable: KEYBOARD_HELP },
			}}
			onDragStart={onDragStart}
			onDragEnd={onDragEnd}
			onDragCancel={() => {
				setDragging(null);
				lastDragEnd = Date.now();
			}}
		>
			<div
				ref={flipRef}
				className="grid grid-cols-1 gap-3 md:min-h-0 md:flex-1 md:grid-cols-2 md:grid-rows-2 xl:grid-cols-4 xl:grid-rows-1"
				data-testid="incident-board"
			>
				{BOARD_COLUMNS.map((column) => (
					<DropColumn
						key={column.id}
						column={column}
						count={
							column.id === "resolved"
								? resolved.length
								: columns[column.id].length
						}
						mark={
							column.id === "working" && liveMark
								? offline !== null
									? "off"
									: "live"
								: null
						}
						action={dragging ? actionFor(dragging, column.id) : null}
						dragging={dragging?.from === column.id}
						empty={
							column.id === "working"
								? workingEmptyText(incidents)
								: EMPTY[column.id]
						}
					>
						{column.id === "needs_you" ? (
							<>
								{needs.map((i) => card(i, column.id))}
								{wrapUp.length > 0 && (
									<li data-testid="board-wrap-up">
										<ul className="flex flex-col gap-2">
											{wrapUp.map((i) => card(i, column.id))}
										</ul>
									</li>
								)}
							</>
						) : (
							(column.id === "resolved" ? resolved : columns[column.id]).map(
								(i) => card(i, column.id),
							)
						)}
					</DropColumn>
				))}
			</div>
			<SettledFold incidents={settled} search={search} />
			<DragOverlay dropAnimation={prefersReducedMotion() ? null : undefined}>
				{dragging && (
					// A picture of the card, not a second card: dnd-kit keeps it ~250ms after the drop (#780).
					<div className="floating rotate-1 rounded-surface" aria-hidden>
						<CardBody
							incident={dragging.incident}
							column={dragging.from}
							now={now}
							offline={offline}
							overlay
						/>
					</div>
				)}
			</DragOverlay>
			{prompt?.kind === "resolve" && (
				<ResolveDialog
					open
					incident={prompt.incident}
					onOpenChange={(open) => !open && setPrompt(null)}
					isPending={close.isPending}
					onConfirm={(cause) => {
						const { incident, stopFirst } = prompt;
						setPrompt(null);
						setBusy((b) => ({ ...b, [incident.id]: "Resolving" }));
						const go = () =>
							close.mutate(
								{ id: incident.id, ...cause },
								{
									onSuccess: settle(incident.id),
									onError: fail(incident.id, "Not resolved"),
								},
							);
						if (stopFirst) stopRun(incident, go);
						else go();
					}}
				/>
			)}
			{prompt?.kind === "reopen-investigate" && (
				<ReopenDialog
					open
					investigate
					incidentNumber={prompt.incident.number}
					onOpenChange={(open) => !open && setPrompt(null)}
					onConfirm={() => {
						const { incident } = prompt;
						setPrompt(null);
						setBusy((b) => ({ ...b, [incident.id]: "Reopening" }));
						update.mutate(
							{ id: incident.id, status: "investigating" },
							{
								onSuccess: () => startRun(incident),
								onError: fail(incident.id, "Not reopened"),
							},
						);
					}}
				/>
			)}
			{prompt?.kind === "reopen" && (
				<ReopenDialog
					open
					incidentNumber={prompt.incident.number}
					onOpenChange={(open) => !open && setPrompt(null)}
					onConfirm={() => {
						const { incident } = prompt;
						setPrompt(null);
						setBusy((b) => ({ ...b, [incident.id]: "Reopening" }));
						update.mutate(
							{ id: incident.id, status: "investigating" },
							{
								onSuccess: settle(incident.id),
								onError: fail(incident.id, "Not reopened"),
							},
						);
					}}
				/>
			)}
		</DndContext>
	);
}

/** Resolved cards older than a day, folded under the columns until opened. */
function SettledFold({
	incidents,
	search,
}: {
	incidents: IncidentWithRelations[];
	search: IncidentsSearch;
}) {
	const [open, setOpen] = useState(false);
	if (incidents.length === 0) return null;
	return (
		<div className="mt-2 shrink-0" data-testid="board-settled">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				aria-expanded={open}
				className="flex h-7 items-center gap-2 rounded-control px-2.5 text-meta text-text-3 transition-colors duration-(--dur-instant) hover:bg-surface-2 hover:text-text-1"
			>
				<ChevronRight
					className={cn(
						"size-3 transition-transform duration-(--dur-fast)",
						open && "rotate-90",
					)}
				/>
				Settled
				<span className="tabular-nums">{incidents.length}</span>
			</button>
			{open && (
				<ul className="mt-1 grid gap-px md:max-h-48 md:overflow-y-auto">
					{incidents.map((i) => (
						<li key={i.id}>
							<Link
								to="/incidents/$id"
								params={{ id: i.id }}
								search={search}
								className="flex h-7 min-w-0 items-center gap-2.5 rounded-control px-2.5 text-text-2 hover:bg-surface-2 hover:text-text-1"
							>
								<Mono className="shrink-0 text-meta text-text-3">
									INC-{i.number}
								</Mono>
								<span className="truncate">{i.title}</span>
							</Link>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

const WORD_TONE: Record<CardTone, string> = {
	danger: "text-danger",
	warn: "text-warn",
	plain: "text-text-1",
};

/** The head's dot and word, each in the column's state colour (#673 w14). */
const HEAD_TONE: Record<(typeof COLUMN_TONE)[BoardColumn], string> = {
	warn: "text-warn",
	live: "text-live",
	"text-2": "text-text-2",
	ok: "text-ok",
};

const EMPTY: Record<Exclude<BoardColumn, "working">, string> = {
	needs_you: "Nothing needs you.",
	concluded: "Nothing concluded in this window.",
	resolved: "Nothing resolved in this window.",
};

/**
 * A lane (look ruling §2): one step above the canvas, the board's full
 * height, its heading still while its cards scroll; a quiet tint where a
 * drop does something.
 */
function DropColumn({
	column,
	count,
	mark,
	action,
	dragging,
	empty,
	children,
}: {
	column: { id: BoardColumn; label: string };
	count: number;
	/** Working's 3×12 bar: teal while a run is live, grey while disconnected. */
	mark: "live" | "off" | null;
	action: DropAction | null;
	/** The dragged card came from here. */
	dragging: boolean;
	/** The lane's line when it holds no card. */
	empty: string;
	children: ReactNode;
}) {
	const { setNodeRef, isOver } = useDroppable({ id: column.id });
	const valid = !!action && action.kind !== "none";
	const refused = !!action && !dragging && action.kind === "none";
	return (
		<section
			aria-labelledby={`board-${column.id}`}
			className="pool flex min-w-0 flex-col p-2 md:min-h-0"
			data-testid={`board-column-${column.id}`}
		>
			<h2
				id={`board-${column.id}`}
				className={cn(
					"flex h-7 shrink-0 items-center gap-2 px-1.5 font-medium",
					mark === "off" ? "text-text-3" : HEAD_TONE[COLUMN_TONE[column.id]],
				)}
				data-testid="board-column-heading"
			>
				<span
					aria-hidden
					className="size-1.5 shrink-0 rounded-full bg-current"
					data-testid={mark ? "lane-live-bar" : undefined}
				/>
				{column.label}
				<span className="ml-auto text-meta font-normal text-text-3 tabular-nums">
					{count}
				</span>
			</h2>
			<ul
				ref={setNodeRef}
				aria-label={column.label}
				data-column={column.id}
				data-drop={action ? (valid ? "valid" : "refused") : undefined}
				className={cn(
					"-m-1 flex min-h-16 flex-col gap-2 rounded-surface p-1 transition-colors duration-(--dur-fast) md:min-h-0 md:flex-1 md:overflow-y-auto",
					valid && "bg-accent/5",
					valid && isOver && "bg-accent/10",
					refused && "opacity-50",
				)}
			>
				{refused && isOver && action.kind === "none" && action.reason && (
					<li className="px-1.5 text-meta text-text-3">{action.reason}</li>
				)}
				{count === 0 && !(refused && isOver) && (
					<li
						className="px-1.5 pt-1 pb-2 text-meta text-text-3"
						data-testid="board-lane-empty"
					>
						{empty}
					</li>
				)}
				{children}
			</ul>
		</section>
	);
}

function DraggableCard({
	arriving,
	incident,
	column,
	now,
	offline,
	search,
	busy,
	onAcknowledge,
}: {
	/** Set while the card is a new arrival: its delay behind earlier ones, ms. */
	arriving?: number;
	incident: IncidentWithRelations;
	column: BoardColumn;
	now: number | null;
	offline: number | null;
	search: IncidentsSearch;
	busy?: string;
	onAcknowledge: () => void;
}) {
	const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
		id: incident.id,
		disabled: !!busy,
	});
	// The card's title stays the link screen readers follow; dnd-kit would make the li a button.
	const {
		role: _role,
		tabIndex: _tab,
		"aria-describedby": describedBy,
		...dragAttributes
	} = attributes;
	return (
		<li
			ref={setNodeRef}
			data-flip={incident.id}
			className={cn("relative", isDragging && "opacity-40")}
			{...dragAttributes}
			{...listeners}
		>
			<CardBody
				arriving={arriving}
				incident={incident}
				column={column}
				now={now}
				offline={offline}
				busy={busy}
				link={
					<Link
						to="/incidents/$id"
						params={{ id: incident.id }}
						search={search}
						className="outline-none after:absolute after:inset-0 after:rounded-surface focus-visible:after:outline-2 focus-visible:after:outline-accent"
						aria-describedby={describedBy}
						onClickCapture={(e) => {
							if (Date.now() - lastDragEnd < 300) e.preventDefault();
						}}
						data-testid="board-card-link"
					>
						<WrapText text={incident.title} />
					</Link>
				}
				onAcknowledge={onAcknowledge}
			/>
		</li>
	);
}

/**
 * One card (study-v3 §3.1): the dot, INC-n and age; the title; the service;
 * the state word or the live step; the lineage and the headline; Acknowledge
 * while Triggered. Severity is the dot alone, never a word.
 */
function CardBody({
	arriving,
	incident,
	column,
	now,
	offline,
	busy,
	link,
	onAcknowledge,
	overlay = false,
}: {
	arriving?: number;
	incident: IncidentWithRelations;
	column: BoardColumn;
	now: number | null;
	offline: number | null;
	busy?: string;
	link?: ReactNode;
	onAcknowledge?: () => void;
	/** The drag overlay's copy, which must not read as a board card. */
	overlay?: boolean;
}) {
	const word = cardWord(incident, now);
	const live = runWord(incident, now);
	const headline = incidentHeadline(incident);
	const lineage = incidentLineage(incident);
	const run = latestRun(incident);
	const { data: harnesses } = useHarnesses();
	const agentName =
		harnesses?.harnesses.find((h) => h.id === run?.harness)?.label ??
		run?.harness;
	const runs = incident.investigations ?? [];
	// The list carries the newest five runs, so a number is known only below that.
	const runNo = run && runs.length < 5 ? runs.length : null;
	const service =
		incident.service?.displayName ||
		incident.service?.name ||
		incident.services?.[0]?.displayName ||
		incident.services?.[0]?.name;
	const wrapUp = isWrapUp(incident);
	const quiet = live?.quietFor !== null && live?.quietFor !== undefined;
	const breathing = !!live && !quiet && offline === null && !overlay;
	const step =
		live && !quiet && live.step !== RUN_STATE_LABEL[live.state]
			? live.step
			: null;
	return (
		<article
			className={cn(
				"raised relative grid min-w-0 gap-0.5 rounded-surface px-3 py-2.5 transition-[background-color,translate,scale,box-shadow] duration-(--dur-fast) ease-(--ease-out) hover:-translate-y-px hover:shadow-float active:scale-[0.99]",
				breathing && "live-glow",
			)}
			style={
				arriving !== undefined ? { animationDelay: `${arriving}ms` } : undefined
			}
			data-new={arriving !== undefined ? "" : undefined}
			data-live={breathing ? "" : undefined}
			data-testid={overlay ? "board-card-overlay" : "board-card"}
			data-column={column}
			data-number={incident.number}
		>
			<div className="flex min-w-0 items-center gap-2 text-meta text-text-3">
				{run?.harness && (
					<span
						role="img"
						aria-label={`Run by ${agentName}`}
						className="inline-flex shrink-0"
					>
						<AgentMark id={run.harness} className="mr-0.5 size-3.5" />
					</span>
				)}
				<span
					role="img"
					aria-label={SEVERITY_LABEL[incident.severity]}
					className="relative size-1.5 shrink-0 rounded-full"
					style={{ background: `var(--sev-${incident.severity})` }}
					data-testid="card-dot"
				/>
				<Mono className="shrink-0 text-text-3" data-testid="card-id">
					INC-{incident.number}
				</Mono>
				<span className="ml-auto shrink-0 tabular-nums" data-testid="card-age">
					{shortAge(incident.triggeredAt, now)}
				</span>
			</div>
			<div
				className={cn(
					"truncate font-semibold",
					wrapUp ? "text-text-2" : "text-text-1",
				)}
				data-testid="card-title"
			>
				{link ?? incident.title}
			</div>
			<div
				className="truncate text-meta text-text-3"
				data-testid="card-service"
			>
				{service ?? "No service"}
			</div>
			{word && (
				<div className="mt-1 flex flex-wrap items-center gap-x-2.5 text-meta text-text-2 tabular-nums">
					<span
						className={cn("font-medium", WORD_TONE[word.tone])}
						data-testid="card-word"
					>
						{word.text}
					</span>
					{word.since && <span>{word.since}</span>}
				</div>
			)}
			{live && (
				<div
					className={cn(
						"mt-1 grid min-w-0 gap-1 text-meta text-text-2 tabular-nums",
						quiet && offline === null && "font-medium text-warn",
					)}
					data-testid="card-step"
				>
					{offline !== null ? (
						<span className="truncate">Last seen {formatClock(offline)}</span>
					) : quiet ? (
						<span className="truncate">{live.text}</span>
					) : (
						<>
							<span className="flex min-w-0 items-center gap-x-2.5">
								<span className="font-medium text-live">
									{RUN_STATE_LABEL[live.state]}
								</span>
								<span>{formatElapsed(live.elapsed)}</span>
								{runNo !== null && (
									<span className="text-text-3">Run #{runNo}</span>
								)}
							</span>
							{step && <span className="line-clamp-2">{step}</span>}
						</>
					)}
				</div>
			)}
			{busy ? (
				<p className="mt-1 text-meta text-text-1">{busy}</p>
			) : (
				<>
					{lineage && (
						<p
							className="mt-1 line-clamp-2 text-meta text-text-2"
							data-testid="card-lineage"
						>
							<span className="font-medium text-text-1">{lineage.lead}</span>{" "}
							{lineage.text}
						</p>
					)}
					{!live && headlineAddsInfo(headline) && (
						<p
							className="mt-1 line-clamp-2 text-meta text-text-2"
							data-testid="board-card-headline"
						>
							{headline.lead && (
								<span className="font-medium text-text-1">
									{headline.lead}{" "}
								</span>
							)}
							{headline.text}
						</p>
					)}
					{wrapUp && <p className="mt-1.5 text-meta text-text-3">To wrap up</p>}
				</>
			)}
			{incident.status === "triggered" && onAcknowledge && !busy && (
				<div className="relative z-10 mt-2 w-fit">
					<Button
						variant="secondary"
						size="sm"
						onPointerDown={(e) => e.stopPropagation()}
						onClick={onAcknowledge}
						data-testid="card-acknowledge"
					>
						Acknowledge
					</Button>
				</div>
			)}
		</article>
	);
}
