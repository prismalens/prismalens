// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	ThreadRow,
	ThreadSection,
	ThreadUnit,
} from "@prismalens/contracts";
import { isWorkflowLive } from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";
import {
	BellRing,
	Check,
	ChevronRight,
	FolderGit2,
	Server,
	Square,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Hint } from "@/components/shared/Hint";
import { Mono } from "@/components/shared/Mono";
import { useNow } from "@/hooks/use-now";
import { useCancelInvestigation } from "@/lib/api/hooks";
import {
	type ThreadFeedInput,
	useSettleThread,
	useThreadFeed,
} from "@/lib/api/hooks/use-threads-orpc";
import { orpc } from "@/lib/api/orpc-client";
import { shortAge } from "@/lib/incident-board";
import {
	announcements,
	rowContext,
	rowLine,
	rowState,
	STATE_WORD,
	sectionsOf,
	severityColor,
	severityWord,
	threadLink,
} from "@/lib/thread-rows";
import { cn } from "@/lib/utils";

const SECTION_LABEL: Record<ThreadSection, string> = {
	needs: "Needs you",
	active: "Active",
	settled: "Settled",
};
const UNDO_MS = 8000;

/**
 * The sidebar's thread list (#1020): Needs you, Active, and Settled folded at
 * the foot. An incident's threads move as one block under one chip.
 */
export function ThreadList({ filters = {} }: { filters?: ThreadFeedInput }) {
	const feed = useThreadFeed(filters);
	const settle = useSettleThread();
	const [settledOpen, setSettledOpen] = useState(false);
	const [undo, setUndo] = useState<{ id: string; title: string } | null>(null);
	const units = useMemo(
		() => feed.data?.pages.flatMap((p) => p.units) ?? [],
		[feed.data],
	);
	const counts = feed.data?.pages[0]?.counts;
	const said = useAnnouncer(units);

	useEffect(() => {
		if (!undo) return;
		const t = window.setTimeout(() => setUndo(null), UNDO_MS);
		return () => window.clearTimeout(t);
	}, [undo]);

	const onSettle = (t: ThreadRow) => {
		settle.mutate({ id: t.id, settled: true });
		setUndo({ id: t.id, title: t.title?.trim() || "Thread" });
	};

	if (feed.isLoading)
		return (
			<div className="flex flex-col gap-1.5 px-4 pt-2.5" aria-busy>
				<div className="shimmer h-3 w-1/3 rounded-[4px]" />
				<div className="shimmer h-9 rounded-[4px]" />
				<div className="shimmer h-9 rounded-[4px]" />
			</div>
		);
	if (feed.isError)
		return (
			<p
				className="px-4 py-2 text-meta text-danger"
				data-testid="threads-failed"
			>
				Threads did not load
			</p>
		);

	const bySection = (s: ThreadSection) => units.filter((u) => u.section === s);
	const empty = units.length === 0;
	return (
		<div className="flex flex-col gap-2 px-2" data-testid="thread-list">
			<div role="status" aria-live="polite" className="sr-only">
				{said}
			</div>
			<UnmappedAlertsRow />
			{empty && (
				<p
					className="px-2 py-1 text-meta text-text-3"
					data-testid="threads-empty"
				>
					No threads yet
				</p>
			)}
			{(["needs", "active"] as const).map((s) => {
				const list = bySection(s);
				if (list.length === 0) return null;
				return (
					<section
						key={s}
						aria-label={SECTION_LABEL[s]}
						className="flex flex-col gap-px"
						data-testid={`threads-${s}`}
					>
						<Lane label={SECTION_LABEL[s]} count={counts?.[s]} />
						{list.map((u) => (
							<UnitRows key={unitKey(u)} unit={u} onSettle={onSettle} />
						))}
					</section>
				);
			})}
			{(counts?.settled ?? 0) > 0 || undo ? (
				<section
					aria-label="Settled"
					className="flex flex-col gap-px"
					data-testid="threads-settled"
				>
					<button
						type="button"
						aria-expanded={settledOpen}
						onClick={() => setSettledOpen((o) => !o)}
						className="flex h-6 items-center gap-1.5 rounded-control px-2 text-meta text-text-3 hover:text-text-1"
						data-testid="threads-settled-toggle"
					>
						<span>Settled</span>
						<span className="tabular-nums">{counts?.settled ?? 0}</span>
						<ChevronRight
							aria-hidden
							className={cn(
								"ml-auto size-3 transition-transform duration-150 motion-reduce:transition-none",
								settledOpen && "rotate-90",
							)}
						/>
					</button>
					{undo && (
						<div
							className="flex h-7 items-center gap-2 px-2 text-meta text-text-2"
							data-testid="settle-undo-line"
						>
							<span className="min-w-0 truncate">Settled {undo.title}</span>
							<button
								type="button"
								onClick={() => {
									settle.mutate({ id: undo.id, settled: false });
									setUndo(null);
								}}
								className="ml-auto shrink-0 rounded-control px-1.5 font-medium text-text-1 hover:bg-surface-3"
								data-testid="settle-undo"
							>
								Undo
							</button>
						</div>
					)}
					{settledOpen &&
						bySection("settled").map((u) => (
							<UnitRows key={unitKey(u)} unit={u} />
						))}
				</section>
			) : null}
			{feed.hasNextPage && (
				<button
					type="button"
					onClick={() => void feed.fetchNextPage()}
					disabled={feed.isFetchingNextPage}
					className="h-7 rounded-control px-2 text-left text-meta text-text-3 hover:bg-surface-3 hover:text-text-1"
					data-testid="threads-more"
				>
					Show more
				</button>
			)}
		</div>
	);
}

const unitKey = (u: ThreadUnit) => u.incident?.id ?? u.threads[0]?.id ?? "";

function Lane({ label, count }: { label: string; count?: number }) {
	return (
		<div className="flex h-6 items-center gap-1.5 px-2 text-meta text-text-3">
			<span>{label}</span>
			{count !== undefined && <span className="tabular-nums">{count}</span>}
		</div>
	);
}

/** One unit: a lone thread, or an incident's block joined by its severity stripe. */
function UnitRows({
	unit,
	onSettle,
}: {
	unit: ThreadUnit;
	onSettle?: (t: ThreadRow) => void;
}) {
	const stripe = unit.incident ? severityColor(unit.incident.severity) : null;
	return (
		<div
			className={cn("relative flex flex-col gap-px", stripe && "pl-1")}
			data-testid="thread-unit"
			data-incident={unit.incident?.number}
		>
			{stripe && (
				<span
					aria-hidden
					className="absolute inset-y-1 left-0 w-0.5 rounded-full"
					style={{ background: stripe }}
				/>
			)}
			{unit.threads.map((t, i) => (
				<Row
					key={t.id}
					thread={t}
					unit={unit}
					chip={i === 0}
					onSettle={onSettle}
				/>
			))}
		</div>
	);
}

function Row({
	thread: t,
	unit,
	chip,
	onSettle,
}: {
	thread: ThreadRow;
	unit: ThreadUnit;
	chip: boolean;
	onSettle?: (t: ThreadRow) => void;
}) {
	const now = useNow(30_000);
	const { pathname, search } = useLocation();
	const cancel = useCancelInvestigation();
	const state = rowState(t);
	const line = rowLine(t);
	const context = rowContext(t);
	const live = isWorkflowLive(t.status);
	const here =
		pathname === `/threads/${t.id}` ||
		pathname.endsWith(`/runs/${t.id}`) ||
		(search as { investigation?: string }).investigation === t.id;
	const incident = unit.incident;
	const title =
		t.title?.trim() ||
		incident?.title ||
		(t.kind === "chat" ? "Thread" : "Investigation");
	return (
		<div className="group/row relative" data-testid="thread-row-wrap">
			<Hint
				label={incident ? `INC-${incident.number}` : (context ?? "No subject")}
				meta={
					state === "ask"
						? "Waiting on you"
						: [t.model ?? t.harness, shortAge(t.createdAt, now)]
								.filter(Boolean)
								.join(", ")
				}
				side="right"
			>
				<Link
					{...threadLink(t)}
					aria-current={here ? "page" : undefined}
					className={cn(
						"flex min-w-0 flex-col gap-0.5 rounded-control px-2 py-1.5 text-text-2 transition-colors duration-(--dur-instant) hover:bg-surface-3",
						here && "bg-surface-3",
					)}
					data-testid="thread-row"
					data-id={t.id}
					data-section={t.section}
					data-state={state ?? "quiet"}
				>
					<span className="flex h-4 min-w-0 items-center gap-1.5 text-meta text-text-3">
						{incident && chip ? (
							<span
								className="inline-flex shrink-0 items-center gap-1 font-medium"
								style={{ color: severityColor(incident.severity) }}
								data-testid="thread-incident-chip"
							>
								<Mono>INC-{incident.number}</Mono>
								<span>{severityWord(incident.severity)}</span>
							</span>
						) : null}
						{context && (
							<span className="inline-flex min-w-0 items-center gap-1">
								{t.projectName ? (
									<FolderGit2 aria-hidden className="size-3 shrink-0" />
								) : (
									<Server aria-hidden className="size-3 shrink-0" />
								)}
								<span dir="auto" className="truncate">
									{context}
								</span>
							</span>
						)}
						<span
							className={cn(
								"ml-auto inline-flex shrink-0 items-center gap-1 tabular-nums",
								onSettle &&
									"group-hover/row:invisible group-focus-within/row:invisible",
								state === "ask" && "text-warn",
								state === "failed" && "text-danger",
								state === "live" && "text-live",
								state === "new" && "text-accent",
							)}
							data-testid="thread-row-state"
						>
							{state ? (
								<>
									<span
										aria-hidden
										className={cn(
											"size-1.5 rounded-full bg-current",
											(state === "ask" || state === "live") &&
												"breathe motion-reduce:animate-none",
										)}
									/>
									{STATE_WORD[state]}
								</>
							) : (
								shortAge(t.lastActivityAt, now)
							)}
						</span>
					</span>
					<span
						dir="auto"
						className="truncate text-body text-text-1"
						data-testid="thread-row-title"
					>
						{title}
					</span>
					{line && (
						<span
							dir="auto"
							className="truncate text-meta text-text-3"
							data-testid="thread-row-line"
						>
							{line}
						</span>
					)}
				</Link>
			</Hint>
			{onSettle && (
				<div className="absolute top-1 right-1 hidden items-center gap-0.5 group-focus-within/row:flex group-hover/row:flex">
					{live ? (
						<RowAction
							label="Stop"
							onClick={() => cancel.mutate({ id: t.id })}
							testId="thread-stop"
						>
							<Square className="size-3" />
						</RowAction>
					) : (
						<RowAction
							label="Settle"
							onClick={() => onSettle(t)}
							testId="thread-settle"
						>
							<Check className="size-3.5" />
						</RowAction>
					)}
				</div>
			)}
		</div>
	);
}

function RowAction({
	label,
	onClick,
	testId,
	children,
}: {
	label: string;
	onClick: () => void;
	testId: string;
	children: React.ReactNode;
}) {
	return (
		<Hint label={label} side="top">
			<button
				type="button"
				aria-label={label}
				onClick={onClick}
				className="flex size-6 items-center justify-center rounded-control bg-surface-3 text-text-2 hover:bg-surface-4 hover:text-text-1"
				data-testid={testId}
			>
				{children}
			</button>
		</Hint>
	);
}

/** Only when some alerts landed with no service to map them to. */
function UnmappedAlertsRow() {
	const { data } = useQuery(
		orpc.alerts.list.queryOptions({ input: { unassigned: true, limit: 1 } }),
	);
	const n = data?.pagination.total ?? 0;
	if (n === 0) return null;
	return (
		<Link
			to="/alerts"
			search={{ tab: "unmapped" }}
			className="flex h-7 items-center gap-2 rounded-control px-2 text-meta text-text-2 hover:bg-surface-3 hover:text-text-1"
			data-testid="unmapped-alerts-row"
		>
			<BellRing aria-hidden className="size-3.5 text-warn" />
			<span>
				{n.toLocaleString("en-US")} {n === 1 ? "alert" : "alerts"} unmapped
			</span>
		</Link>
	);
}

/** Reads background moves into Needs you or Settled; the first read says nothing. */
function useAnnouncer(units: ThreadUnit[]): string {
	const before = useRef<Map<string, ThreadSection> | null>(null);
	const [said, setSaid] = useState("");
	useEffect(() => {
		const next = sectionsOf(units);
		if (before.current) {
			const lines = announcements(before.current, units);
			if (lines.length) setSaid(lines.join(". "));
		}
		before.current = next;
	}, [units]);
	return said;
}
