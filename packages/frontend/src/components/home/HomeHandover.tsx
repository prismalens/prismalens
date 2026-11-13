// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Home's handover (#1101 F3): under the composer, without a click, the trees
 * that need you (answerable in place) and what changed while you were away.
 */
import { agentName } from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { AwayView } from "@/components/home/AwayView";
import { ListCard, ListGrid } from "@/components/kit/ListCard";
import {
	AgentBadge,
	BranchMark,
	ChildrenMark,
	PrMark,
} from "@/components/kit/MarkBadges";
import { type RowAskEntry, useRowAsk } from "@/components/shell/RowAsk";
import {
	useAsksByThread,
	useThreadListModel,
} from "@/components/shell/ThreadList";
import { detailLine } from "@/components/shell/ThreadTree";
import { Button } from "@/components/ui/button";
import { useNow } from "@/hooks/use-now";
import type { ListNode } from "@/lib/thread-list";
import { threadLink } from "@/lib/thread-rows";
import { needsYouNow } from "@/lib/thread-status";

/** Needs-you cards before "Show N more": two rows of the grid at desktop width. */
const NEEDS_SHOWN = 6;

const below = (n: ListNode): ListNode[] =>
	n.children.flatMap((c) => [c, ...below(c)]);

export function HomeHandover() {
	const { model } = useThreadListModel();
	const asks = useAsksByThread();
	const now = useNow(30_000) ?? 0;
	// What waits on you shows once, here; the away list keeps the rest.
	const waiting = new Set(
		model.needs.flatMap((n) =>
			[n, ...below(n)]
				.filter((d) => needsYouNow(d.thread, d.info))
				.map((d) => d.id),
		),
	);
	return (
		<div className="flex w-full flex-col gap-6" data-testid="home-handover">
			<HomeNeeds
				needs={model.needs}
				count={model.needsCount}
				asks={asks}
				now={now}
			/>
			<AwayView skip={waiting} />
		</div>
	);
}

/** The trees that need you as cards, from data, for Home and the gallery. */
export function HomeNeeds({
	needs,
	count,
	asks,
	now,
}: {
	needs: ListNode[];
	count: number;
	asks: ReadonlyMap<string, RowAskEntry[]>;
	now: number;
}) {
	const [all, setAll] = useState(false);
	const shown = all ? needs : needs.slice(0, NEEDS_SHOWN);
	return (
		<>
			{needs.length > 0 && (
				<section
					aria-label="Needs you"
					className="flex flex-col gap-2"
					data-testid="home-needs"
				>
					<h2 className="flex items-center gap-2 text-heading text-text-1">
						Needs you
						<span className="text-meta font-medium text-warn tabular-nums">
							{count}
						</span>
					</h2>
					<ListGrid label="Needs you">
						{shown.map((n) => (
							<NeedsCard
								key={n.id}
								node={n}
								asks={[n, ...below(n)]
									.flatMap((d) => asks.get(d.id) ?? [])
									.sort((a, b) => a.ask.openedAt.localeCompare(b.ask.openedAt))}
								now={now}
							/>
						))}
					</ListGrid>
					{needs.length > shown.length && (
						<button
							type="button"
							onClick={() => setAll(true)}
							className="flex h-7 w-fit items-center rounded-control px-2 text-meta text-text-3 hover:bg-surface-2 hover:text-text-1"
							data-testid="home-needs-more"
						>
							Show {needs.length - shown.length} more
						</button>
					)}
				</section>
			)}
		</>
	);
}

/** One tree that needs you: its worst state, its marks, and the oldest ask to answer. */
function NeedsCard({
	node,
	asks,
	now,
}: {
	node: ListNode;
	asks: RowAskEntry[];
	now: number;
}) {
	const entry = asks[0];
	const state = useRowAsk(entry);
	const t = node.thread;
	const title =
		node.unit.incident?.title ??
		(t.title?.trim() || (t.kind === "chat" ? "Thread" : "Run"));
	const kids = below(node).length;
	const agent = t.harness ? agentName(t.harness) : null;
	const link = threadLink(t);
	return (
		<ListCard
			title={title}
			status={node.rolled?.top ?? node.info.status}
			meta={
				<span className="inline-flex items-center gap-2">
					{t.harness && agent && (
						<AgentBadge agent={t.harness} label={agent} model={t.model} />
					)}
					{kids > 0 && <ChildrenMark count={kids} />}
					{t.pr && (
						<PrMark number={t.pr.number} tone={t.pr.tone} count={t.pr.count} />
					)}
					{t.branch && <BranchMark branch={t.branch} />}
				</span>
			}
			detail={detailLine(node, now, entry, true)}
			footer={entry && state.can ? <QuickAnswer state={state} /> : undefined}
			link={(heading) => <Link {...link}>{heading}</Link>}
			testId="home-needs-card"
		/>
	);
}

/**
 * The answer as one row of buttons: Approve and Decline, or a single question's
 * options. Anything longer opens the thread from the card.
 */
function QuickAnswer({ state }: { state: ReturnType<typeof useRowAsk> }) {
	const ask = state.ask;
	if (!ask) return null;
	if (ask.kind === "permission")
		return (
			<div className="flex items-center gap-1.5" data-testid="home-answer">
				<Button
					size="sm"
					variant="primary"
					disabled={state.busy}
					onClick={state.approve}
				>
					Approve
				</Button>
				<Button
					size="sm"
					variant="secondary"
					disabled={state.busy}
					onClick={() => state.decline()}
				>
					Decline
				</Button>
			</div>
		);
	const options = state.single ? (ask.questions?.[0]?.options ?? []) : [];
	if (options.length === 0) return null;
	return (
		<div
			className="flex flex-wrap items-center gap-1.5"
			data-testid="home-answer"
		>
			{options.map((o, n) => (
				<Button
					key={o.id}
					size="sm"
					variant="secondary"
					disabled={state.busy}
					onClick={() => state.pick(n + 1)}
				>
					{o.label}
				</Button>
			))}
		</div>
	);
}
