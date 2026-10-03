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
import { Mono } from "@/components/shared/Mono";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useNow } from "@/hooks/use-now";
import { useToast } from "@/hooks/use-toast";
import { useInvestigationReadiness } from "@/lib/api/hooks";
import { incidentKeys } from "@/lib/api/hooks/use-incidents-orpc";
import {
	investigationKeys,
	useCancelInvestigation,
} from "@/lib/api/hooks/use-investigations-orpc";
import { useStreamStatus } from "@/lib/api/live-refresh";
import { orpc } from "@/lib/api/orpc-client";
import { type DropAction, dropAction } from "@/lib/board-drop";
import { formatClock } from "@/lib/format-time";
import { getErrorMessage } from "@/lib/get-error-message";
import {
	BOARD_COLUMNS,
	type BoardColumn,
	boardColumn,
	cardWord,
	clockElapsed,
	headlineAddsInfo,
	incidentHeadline,
	incidentLineage,
	isWrapUp,
	latestRun,
	orderNeedsYou,
	runWord,
	shortAge,
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
}

/** A drop or a card action waiting on the operator. */
type Prompt = { incident: IncidentWithRelations } & (
	| { kind: "stop" }
	| { kind: "reopen-investigate" }
	| { kind: "resolve"; stopFirst: boolean }
);

function actionFor(d: Dragging, to: BoardColumn): DropAction {
	const run = latestRun(d.incident);
	return dropAction({
		from: d.from,
		to,
		live: !!run && isWorkflowLive(run.status),
		canResolve: canIncidentAction("close", d.incident.status),
		canReopen: canIncidentAction("reopen", d.incident.status),
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
 * Below `lg` the columns stack with their headings.
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
	const acknowledge = (incident: IncidentWithRelations) => {
		setBusy((b) => ({ ...b, [incident.id]: "Acknowledging" }));
		update.mutate(
			{ id: incident.id, status: "investigating" },
			{
				onSuccess: settle(incident.id),
				onError: fail(incident.id, "Not acknowledged"),
			},
		);
	};
	const stopRun = (incident: IncidentWithRelations, then?: () => void) => {
		const run = latestRun(incident);
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
		if (action.kind === "investigate") return startRun(d.incident);
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

	const card = (incident: IncidentWithRelations, column: BoardColumn) => (
		<DraggableCard
			key={incident.id}
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
	const liveMark = columns.working.length > 0;

	return (
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
				className="grid grid-cols-1 gap-x-4 gap-y-6 md:grid-cols-2 lg:grid-cols-4"
				data-testid="incident-board"
			>
				{BOARD_COLUMNS.map((column) => (
					<DropColumn
						key={column.id}
						column={column}
						count={columns[column.id].length}
						mark={
							column.id === "working" && liveMark
								? offline !== null
									? "off"
									: "live"
								: null
						}
						action={dragging ? actionFor(dragging, column.id) : null}
						dragging={dragging?.from === column.id}
					>
						{column.id === "needs_you" ? (
							<>
								{needs.map((i) => card(i, column.id))}
								{wrapUp.length > 0 && (
									<li className="mt-3" data-testid="board-wrap-up">
										<p className="mb-2 flex h-6 items-center text-meta text-text-3">
											To wrap up
										</p>
										<ul className="flex flex-col gap-2.5">
											{wrapUp.map((i) => card(i, column.id))}
										</ul>
									</li>
								)}
							</>
						) : (
							columns[column.id].map((i) => card(i, column.id))
						)}
					</DropColumn>
				))}
			</div>
			<DragOverlay dropAnimation={prefersReducedMotion() ? null : undefined}>
				{dragging && (
					<div className="floating rotate-1 rounded-surface">
						<CardBody
							incident={dragging.incident}
							column={dragging.from}
							now={now}
							offline={offline}
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
			<AlertDialog
				open={prompt?.kind === "stop"}
				onOpenChange={(open) => !open && setPrompt(null)}
			>
				<AlertDialogContent data-testid="board-stop-dialog">
					<AlertDialogHeader>
						<AlertDialogTitle>
							Stop INC-{prompt?.incident.number}'s run?
						</AlertDialogTitle>
						<AlertDialogDescription>
							The agent stops at its current step. What it found so far stays in
							the conversation.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Keep going</AlertDialogCancel>
						<AlertDialogAction
							className="bg-danger text-accent-fg hover:bg-danger/90"
							onClick={() => {
								if (!prompt) return;
								const { incident } = prompt;
								setPrompt(null);
								setBusy((b) => ({ ...b, [incident.id]: "Stopping" }));
								stopRun(incident);
							}}
						>
							Stop
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</DndContext>
	);
}

/** A column: its heading in the foreground, a quiet tint where a drop does something. */
function DropColumn({
	column,
	count,
	mark,
	action,
	dragging,
	children,
}: {
	column: { id: BoardColumn; label: string };
	count: number;
	/** Working's 3×12 bar: teal while a run is live, grey while disconnected. */
	mark: "live" | "off" | null;
	action: DropAction | null;
	/** The dragged card came from here. */
	dragging: boolean;
	children: ReactNode;
}) {
	const { setNodeRef, isOver } = useDroppable({ id: column.id });
	const valid = !!action && action.kind !== "none";
	const refused = !!action && !dragging && action.kind === "none";
	return (
		<section
			aria-labelledby={`board-${column.id}`}
			className="min-w-0"
			data-testid={`board-column-${column.id}`}
		>
			<h2
				id={`board-${column.id}`}
				className="mb-2 flex h-6 items-center gap-2 font-medium text-text-1"
				data-testid="board-column-heading"
			>
				{mark && (
					<span
						aria-hidden
						className={cn(
							"h-3 w-[3px] shrink-0 rounded-full",
							mark === "live" ? "bg-live" : "bg-text-3",
						)}
					/>
				)}
				{column.label}
				<span className="font-normal text-text-3 tabular-nums">{count}</span>
			</h2>
			<ul
				ref={setNodeRef}
				aria-label={column.label}
				data-column={column.id}
				data-drop={action ? (valid ? "valid" : "refused") : undefined}
				className={cn(
					"flex min-h-16 flex-col gap-2.5 rounded-surface transition-colors duration-150 motion-reduce:transition-none",
					valid && "bg-accent/5",
					valid && isOver && "bg-accent/10",
					refused && "opacity-50",
				)}
			>
				{refused && isOver && action.kind === "none" && action.reason && (
					<li className="px-1 text-meta text-text-3">{action.reason}</li>
				)}
				{children}
			</ul>
		</section>
	);
}

function DraggableCard({
	incident,
	column,
	now,
	offline,
	search,
	busy,
	onAcknowledge,
}: {
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
	const { role: _role, tabIndex: _tab, ...dragAttributes } = attributes;
	return (
		<li
			ref={setNodeRef}
			data-flip={incident.id}
			className={cn("relative", isDragging && "opacity-40")}
			{...dragAttributes}
			{...listeners}
		>
			<CardBody
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
						className="outline-none after:absolute after:inset-0 after:rounded-surface focus-visible:after:ring-2 focus-visible:after:ring-accent"
						onClickCapture={(e) => {
							if (Date.now() - lastDragEnd < 300) e.preventDefault();
						}}
						data-testid="board-card-link"
					>
						{incident.title}
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
	incident,
	column,
	now,
	offline,
	busy,
	link,
	onAcknowledge,
}: {
	incident: IncidentWithRelations;
	column: BoardColumn;
	now: number | null;
	offline: number | null;
	busy?: string;
	link?: ReactNode;
	onAcknowledge?: () => void;
}) {
	const word = cardWord(incident);
	const live = runWord(incident, now);
	const headline = incidentHeadline(incident);
	const lineage = incidentLineage(incident);
	const service =
		incident.service?.displayName ||
		incident.service?.name ||
		incident.services?.[0]?.displayName ||
		incident.services?.[0]?.name;
	const wrapUp = isWrapUp(incident);
	const quiet = live?.quietFor !== null && live?.quietFor !== undefined;
	return (
		<article
			className="relative min-w-0 rounded-surface bg-surface-2 px-3.5 py-3 shadow-[inset_0_0_0_1px_var(--raised-edge)] transition-colors duration-150 hover:bg-surface-3 motion-reduce:transition-none"
			data-testid="board-card"
			data-column={column}
			data-number={incident.number}
		>
			<div className="flex min-w-0 items-center gap-2 text-meta text-text-3">
				<span
					role="img"
					aria-label={SEVERITY_LABEL[incident.severity]}
					className="relative -top-px size-2 shrink-0 rounded-full"
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
					"mt-1 [overflow-wrap:anywhere]",
					wrapUp ? "text-text-2" : "font-medium text-text-1",
				)}
				data-testid="card-title"
			>
				{link ?? incident.title}
			</div>
			{service && (
				<div className="text-meta text-text-2" data-testid="card-service">
					{service}
				</div>
			)}
			{(word || live) && (
				<div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-meta text-text-3">
					{word && (
						<span
							className={cn(
								"font-medium",
								word.attention ? "text-danger" : "text-text-2",
							)}
							data-testid="card-word"
						>
							{word.text}
						</span>
					)}
					{live && (
						<span
							className={cn(
								"inline-flex min-w-0 items-center gap-1.5 tabular-nums",
								quiet && !offline && "font-medium text-warn",
							)}
							data-testid="card-step"
						>
							<span
								aria-hidden
								className={cn(
									"h-3 w-[3px] shrink-0 rounded-full",
									offline !== null
										? "bg-text-3"
										: quiet
											? "bg-warn"
											: "bg-live",
								)}
							/>
							{offline !== null ? (
								<span className="min-w-0 truncate">
									Last seen {formatClock(offline)}
								</span>
							) : quiet ? (
								<span className="min-w-0 truncate">{live.text}</span>
							) : (
								<>
									<span className="min-w-0 truncate">{live.step}</span>
									<span className="shrink-0">{clockElapsed(live.elapsed)}</span>
								</>
							)}
						</span>
					)}
				</div>
			)}
			{busy ? (
				<p className="mt-1.5 text-meta text-text-1">{busy}</p>
			) : (
				<>
					{lineage && (
						<p
							className="mt-1.5 line-clamp-2 text-meta text-text-2"
							data-testid="card-lineage"
						>
							<span className="font-medium text-text-1">{lineage.lead}</span>{" "}
							{lineage.text}
						</p>
					)}
					{!live && headlineAddsInfo(headline) && (
						<p
							className="mt-1.5 line-clamp-2 text-meta text-text-2"
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
				</>
			)}
			{incident.status === "triggered" && onAcknowledge && !busy && (
				<div className="relative z-10 mt-2">
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
