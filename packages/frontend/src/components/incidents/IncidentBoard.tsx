// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	DndContext,
	type DragEndEvent,
	DragOverlay,
	type DragStartEvent,
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
	INCIDENT_ATTENTION_LABEL,
	INCIDENT_STATUS_LABEL,
	type IncidentStatus,
	type IncidentWithRelations,
	isWorkflowLive,
	SEVERITY_LABEL,
} from "@prismalens/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { ComposerBox } from "@/components/investigation/ComposerBox";
import { Mono } from "@/components/shared/Mono";
import { LaneHeader, useLaneFolded } from "@/components/shared/ServiceLanes";
import { type ChipTone, StateWord } from "@/components/shared/StateChip";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverAnchor,
	PopoverContent,
} from "@/components/ui/popover";
import { useLayoutPrefs } from "@/hooks/use-layout-prefs";
import { ago, useNow } from "@/hooks/use-now";
import { useToast } from "@/hooks/use-toast";
import { useInvestigationReadiness } from "@/lib/api/hooks";
import { incidentKeys } from "@/lib/api/hooks/use-incidents-orpc";
import {
	investigationKeys,
	useCancelInvestigation,
} from "@/lib/api/hooks/use-investigations-orpc";
import { orpc } from "@/lib/api/orpc-client";
import { type DropAction, dropAction } from "@/lib/board-drop";
import { getErrorMessage } from "@/lib/get-error-message";
import { attentionFor, attentionTone } from "@/lib/incident-attention";
import {
	BOARD_COLUMNS,
	type BoardColumn,
	boardColumn,
	incidentHeadline,
	latestRun,
	runWord,
} from "@/lib/incident-board";
import { alsoIn, incidentLanes } from "@/lib/service-lanes";
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
	/** The service lane it was picked up in; `all` when the board is not grouped. */
	lane: string;
}

const ALL = "all";
const dndId = (lane: string, id: string) => `${lane}::${id}`;
const parseDndId = (id: string | number) => {
	const [lane = ALL, rest = ""] = String(id).split("::");
	return { lane, id: rest };
};

/** A drop waiting on the operator: pick the agent, confirm a stop or a resolve. */
type Prompt = { incidentId: string; lane: string } & (
	| { kind: "investigate" }
	| { kind: "stop" }
	| { kind: "reopen" }
	| { kind: "resolve"; stopFirst: boolean }
);

function actionFor(d: Dragging, to: BoardColumn, lane: string): DropAction {
	if (lane !== d.lane) {
		return { kind: "none", reason: "A card moves within its service" };
	}
	const run = latestRun(d.incident);
	return dropAction({
		from: d.from,
		to,
		live: !!run && isWorkflowLive(run.status),
		canResolve: canIncidentAction("resolve", d.incident.status),
		canReopen: canIncidentAction("reopen", d.incident.status),
	});
}

/**
 * The board (#743 §3c, layer 0): the landing beside the list. Four columns in
 * the order an SRE asks, from the same query and predicates as the list pane,
 * so a card and its row never disagree. The board scrolls as one region; 1 to
 * 4 put focus on a column's first card. j, k and Enter stay with the list.
 *
 * A card can be dropped on another column; since columns follow state, a drop
 * is one action (`dropAction`), and nothing runs until the operator confirms.
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
	const { groupBy } = useLayoutPrefs();
	const grouped = groupBy.board === "service";
	const laneFolded = useLaneFolded("board");
	const lanes = useMemo(
		() =>
			grouped
				? incidentLanes(incidents).map((l) => ({
						...l,
						columns: groupByColumn(l.items),
					}))
				: [{ id: ALL, name: "", items: incidents, columns }],
		[grouped, incidents, columns],
	);
	const flipRef = useFlip(incidents);
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const { isReady, blockedReason } = useInvestigationReadiness();
	const [dragging, setDragging] = useState<Dragging | null>(null);
	const [prompt, setPrompt] = useState<Prompt | null>(null);
	// What a confirmed drop is doing, shown on the card until the list confirms it.
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
		}),
	);

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
	const resolve = useMutation(orpc.incidents.resolve.mutationOptions());
	const reopen = useMutation(orpc.incidents.update.mutationOptions());
	const cancel = useCancelInvestigation();

	const startRun = (incident: IncidentWithRelations, brief: string) => {
		setPrompt(null);
		setBusy((b) => ({ ...b, [incident.id]: "Starting…" }));
		investigate.mutate(
			{ id: incident.id, ...(brief ? { brief } : {}) },
			{
				onSuccess: settle(incident.id),
				onError: fail(incident.id, "Investigation refused"),
			},
		);
	};
	const stopRun = (incident: IncidentWithRelations, then?: () => void) => {
		const run = latestRun(incident);
		if (!run) return;
		cancel.mutate(
			{ id: run.id },
			{
				onSuccess: then ?? settle(incident.id),
				onError: fail(incident.id, "Stop did not reach the run"),
			},
		);
	};
	const resolveIncident = (
		incident: IncidentWithRelations,
		stopFirst: boolean,
	) => {
		setPrompt(null);
		setBusy((b) => ({ ...b, [incident.id]: "Resolving…" }));
		const go = () =>
			resolve.mutate(
				{ id: incident.id },
				{
					onSuccess: settle(incident.id),
					onError: fail(incident.id, "Not resolved"),
				},
			);
		if (stopFirst) stopRun(incident, go);
		else go();
	};

	const onDragStart = (e: DragStartEvent) => {
		const { lane, id } = parseDndId(e.active.id);
		const incident = incidents.find((i) => i.id === id);
		if (incident) setDragging({ incident, from: boardColumn(incident), lane });
	};
	const onDragEnd = (e: DragEndEvent) => {
		const d = dragging;
		setDragging(null);
		lastDragEnd = Date.now();
		if (!d || !e.over) return;
		const { lane, id: to } = parseDndId(e.over.id);
		const action = actionFor(d, to as BoardColumn, lane);
		if (action.kind === "none") return;
		const at = { incidentId: d.incident.id, lane };
		setPrompt(
			action.kind === "resolve"
				? { ...at, kind: "resolve", stopFirst: action.stopFirst }
				: { ...at, kind: action.kind },
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

	const promptFor = (incident: IncidentWithRelations): ReactNode => {
		if (prompt?.incidentId !== incident.id) return null;
		if (prompt.kind === "investigate") {
			return (
				<div className="space-y-2" data-testid="board-investigate-prompt">
					<p className="text-record font-medium">
						Investigate INC-{incident.number}
					</p>
					<ComposerBox
						mode="brief"
						onInvestigate={(brief) => startRun(incident, brief)}
						isPending={investigate.isPending}
						blockedReason={isReady ? undefined : blockedReason}
					/>
				</div>
			);
		}
		if (prompt.kind === "reopen") {
			return (
				<ConfirmBody
					title={`Reopen INC-${incident.number}?`}
					body="It goes back to Investigating and its resolve time is cleared."
					cancel="Cancel"
					confirm="Reopen"
					onCancel={() => setPrompt(null)}
					onConfirm={() => {
						setPrompt(null);
						setBusy((b) => ({ ...b, [incident.id]: "Reopening…" }));
						reopen.mutate(
							{ id: incident.id, status: "investigating" },
							{
								onSuccess: settle(incident.id),
								onError: fail(incident.id, "Not reopened"),
							},
						);
					}}
				/>
			);
		}
		if (prompt.kind === "stop") {
			return (
				<ConfirmBody
					title="Stop this run?"
					body="The agent stops at its current step. Everything it found so far stays in the conversation. You can start a new run afterwards."
					cancel="Keep going"
					confirm="Stop run"
					destructive
					onCancel={() => setPrompt(null)}
					onConfirm={() => {
						setPrompt(null);
						setBusy((b) => ({ ...b, [incident.id]: "Stopping…" }));
						stopRun(incident);
					}}
				/>
			);
		}
		return (
			<ConfirmBody
				title={`Resolve INC-${incident.number}?`}
				body={
					prompt.stopFirst
						? "Its run is still working. Resolving stops the run first."
						: "It moves to Resolved. Close it from the incident once the fix holds."
				}
				cancel="Cancel"
				confirm={prompt.stopFirst ? "Stop and resolve" : "Resolve"}
				onCancel={() => setPrompt(null)}
				onConfirm={() => resolveIncident(incident, prompt.stopFirst)}
			/>
		);
	};

	return (
		<div className="relative flex min-h-0 flex-1 flex-col">
			<DndContext
				sensors={sensors}
				onDragStart={onDragStart}
				onDragEnd={onDragEnd}
				onDragCancel={() => {
					setDragging(null);
					lastDragEnd = Date.now();
				}}
			>
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
					{lanes.map((lane) => (
						<section
							key={lane.id}
							data-lane={lane.id}
							aria-label={lane.name || undefined}
						>
							{grouped && (
								<LaneHeader
									view="board"
									id={lane.id}
									name={lane.name}
									count={lane.items.length}
									className="sticky top-8 z-[5] bg-background px-4"
								/>
							)}
							{!laneFolded(lane.id) && (
								<div
									className={cn(
										"grid grid-cols-4 gap-2 px-2",
										!grouped && "min-h-[calc(100%-2rem)]",
									)}
								>
									{BOARD_COLUMNS.map((column) => (
										<DropColumn
											key={column.id}
											dropId={dndId(lane.id, column.id)}
											column={column}
											action={
												dragging
													? actionFor(dragging, column.id, lane.id)
													: null
											}
											dragging={
												dragging?.from === column.id &&
												dragging.lane === lane.id
											}
										>
											{lane.columns[column.id].map((incident) => (
												<Popover
													key={incident.id}
													open={
														prompt?.incidentId === incident.id &&
														prompt.lane === lane.id
													}
													onOpenChange={(open) => {
														if (!open) setPrompt(null);
													}}
												>
													<DraggableCard
														dragId={dndId(lane.id, incident.id)}
														incident={incident}
														column={column.id}
														now={now}
														search={search}
														busy={busy[incident.id]}
														also={
															grouped ? alsoIn(incident, lane.id) : undefined
														}
													/>
													<PopoverContent
														align="start"
														className="w-96 max-w-[calc(100vw-2rem)] p-3"
														data-testid="board-drop-prompt"
													>
														{promptFor(incident)}
													</PopoverContent>
												</Popover>
											))}
										</DropColumn>
									))}
								</div>
							)}
						</section>
					))}
				</div>
				<DragOverlay dropAnimation={prefersReducedMotion() ? null : undefined}>
					{dragging && (
						<div className="rotate-1 rounded-md bg-background shadow-md">
							<BoardCardBody
								incident={dragging.incident}
								column={dragging.from}
								now={now}
							/>
						</div>
					)}
				</DragOverlay>
			</DndContext>
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

function ConfirmBody({
	title,
	body,
	cancel,
	confirm,
	destructive,
	onCancel,
	onConfirm,
}: {
	title: string;
	body: string;
	cancel: string;
	confirm: string;
	destructive?: boolean;
	onCancel: () => void;
	onConfirm: () => void;
}) {
	return (
		<div className="space-y-3">
			<div className="space-y-1">
				<p className="text-record font-medium">{title}</p>
				<p className="text-record text-muted-foreground">{body}</p>
			</div>
			<div className="flex justify-end gap-2">
				<Button variant="ghost" size="sm" onClick={onCancel}>
					{cancel}
				</Button>
				<Button
					variant={destructive ? "destructive" : "default"}
					size="sm"
					onClick={onConfirm}
					data-testid="board-drop-confirm"
				>
					{confirm}
				</Button>
			</div>
		</div>
	);
}

/** A column that takes drops: a quiet tint where a drop does something, dim where it cannot. */
function DropColumn({
	dropId,
	column,
	action,
	dragging,
	children,
}: {
	dropId: string;
	column: { id: BoardColumn; label: string };
	action: DropAction | null;
	/** The dragged card came from here. */
	dragging: boolean;
	children: ReactNode;
}) {
	const { setNodeRef, isOver } = useDroppable({ id: dropId });
	const valid = !!action && action.kind !== "none";
	const refused = !!action && !dragging && action.kind === "none";
	return (
		<ul
			ref={setNodeRef}
			aria-label={column.label}
			data-column={column.id}
			data-drop={action ? (valid ? "valid" : "refused") : undefined}
			className={cn(
				"flex min-w-0 flex-col gap-2 rounded-md pb-2 transition-colors motion-reduce:transition-none",
				valid && "bg-primary/5",
				valid && isOver && "bg-primary/10",
				refused && "opacity-50",
			)}
			data-testid={`board-column-${column.id}`}
		>
			{refused && isOver && action.kind === "none" && action.reason && (
				<li className="px-2 pt-1 text-meta text-muted-foreground">
					{action.reason}
				</li>
			)}
			{children}
		</ul>
	);
}

function DraggableCard({
	dragId,
	incident,
	column,
	now,
	search,
	busy,
	also,
}: {
	dragId: string;
	incident: IncidentWithRelations;
	column: BoardColumn;
	now: number | null;
	search: IncidentsSearch;
	busy?: string;
	also?: string[];
}) {
	const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
		id: dragId,
		disabled: !!busy,
	});
	// The card stays a link to screen readers; dnd-kit would make it a button.
	const { role: _role, ...dragAttributes } = attributes;
	return (
		<PopoverAnchor asChild>
			<li
				ref={setNodeRef}
				data-flip={incident.id}
				className={cn(isDragging && "opacity-40")}
			>
				<Link
					to="/incidents/$id"
					params={{ id: incident.id }}
					search={search}
					data-testid="board-card"
					className="block rounded-md outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
					onClickCapture={(e) => {
						if (Date.now() - lastDragEnd < 300) e.preventDefault();
					}}
					{...dragAttributes}
					{...listeners}
				>
					<BoardCardBody
						incident={incident}
						column={column}
						now={now}
						busy={busy}
						also={also}
					/>
				</Link>
			</li>
		</PopoverAnchor>
	);
}

function BoardCardBody({
	incident,
	column,
	now,
	busy,
	also,
}: {
	incident: IncidentWithRelations;
	column: BoardColumn;
	now: number | null;
	busy?: string;
	also?: string[];
}) {
	const why = attentionFor(incident);
	const word = runWord(incident, now);
	const headline = incidentHeadline(incident);
	const service =
		incident.service?.displayName || incident.service?.name || "no service";

	return (
		<div className="space-y-1 rounded-md bg-muted/40 px-3 py-2 hover:bg-muted/70">
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
			<p
				className="truncate text-meta text-muted-foreground"
				data-testid="board-card-headline"
			>
				{busy ? (
					<span className="text-foreground">{busy}</span>
				) : (
					<>
						{headline.lead && (
							<span className="font-medium text-foreground">
								{headline.lead}{" "}
							</span>
						)}
						{headline.text}
					</>
				)}
			</p>
			{also && also.length > 0 && (
				<p
					className="truncate text-meta text-muted-foreground"
					data-testid="board-card-also"
				>
					Also in {also.join(", ")}
				</p>
			)}
		</div>
	);
}
