// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { agentName } from "@prismalens/contracts";
import * as P from "@radix-ui/react-popover";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { AwayDigest } from "@/components/home/AwayView";
import { causeOf } from "@/components/home/needs-cause";
import { useNeedsCtx } from "@/components/home/use-needs-ctx";
import { fact } from "@/components/kit/fact";
import { ListCard, ListGrid } from "@/components/kit/ListCard";
import {
	AgentBadge,
	BranchMark,
	PrMark,
	StartedByMark,
} from "@/components/kit/MarkBadges";
import { FAMILY_CLASS, SURFACE } from "@/components/kit/Popover";
import { entryOf, surfaceEntries } from "@/components/kit/registry";
import {
	fixActionId,
	Status,
	type StatusKind,
	statusUrgency,
	statusWord,
} from "@/components/kit/Status";
import { Time } from "@/components/kit/Time";
import { RowAsk, type RowAskEntry, useRowAsk } from "@/components/shell/RowAsk";
import {
	useAsksByThread,
	useThreadListModel,
} from "@/components/shell/ThreadList";
import { detailLine } from "@/components/shell/ThreadTree";
import { Button } from "@/components/ui/button";
import { useNow } from "@/hooks/use-now";
import type { ListNode } from "@/lib/thread-list";
import { threadLink } from "@/lib/thread-rows";
import { cn } from "@/lib/utils";

/** Needs-you cards before the rest folds into status bands: two rows of the grid at desktop width. */
const NEEDS_SHOWN = 4;

export function HomeHandover() {
	const { model } = useThreadListModel();
	const asks = useAsksByThread();
	const now = useNow(30_000) ?? 0;
	// What waits on you shows once, here; the digest keeps the rest.
	const waiting = new Set(model.needs.map((n) => n.id));
	return (
		<div className="flex w-full flex-col gap-6" data-testid="home-handover">
			<HomeNeeds
				needs={model.needs}
				count={model.needsCount}
				asks={asks}
				now={now}
			/>
			<AwayDigest skip={waiting} />
		</div>
	);
}

/** The needs-you threads by status, most urgent band first. */
function bandsOf(needs: ListNode[]): { kind: StatusKind; n: number }[] {
	const bands: { kind: StatusKind; n: number }[] = [];
	for (const n of needs) {
		const kind = n.info.status;
		const band = bands.find((b) => b.kind === kind);
		if (band) band.n += 1;
		else bands.push({ kind, n: 1 });
	}
	return bands.sort((a, b) => statusUrgency(a.kind) - statusUrgency(b.kind));
}

/** One band as a toggle: the kit's Status shape, its count and its word. */
function BandButton({
	kind,
	n,
	on,
	onPick,
}: {
	kind: StatusKind;
	n: number;
	on: boolean;
	onPick: () => void;
}) {
	return (
		<button
			type="button"
			aria-pressed={on}
			onClick={onPick}
			className={cn(
				"inline-flex h-7 items-center gap-1.5 rounded-control px-2 text-meta text-text-2 tabular-nums outline-none hover:bg-surface-2 hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent",
				on && "bg-surface-3 text-text-1",
			)}
			data-testid="home-needs-band"
			data-band={kind}
		>
			<Status kind={kind} showWord={false} />
			{n}
			<span {...fact("status")}>{statusWord(kind)}</span>
		</button>
	);
}

/**
 * The trees that need you as cards, from data, for Home and the gallery: the
 * most urgent few, then the rest grouped by status, one band per kind (#1101 cat 3).
 */
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
	const [kind, setKind] = useState<StatusKind | null>(null);
	// "N more" opens every card here, so the overflow is one click from its answers (#1101 Ops fit).
	const [all, setAll] = useState(false);
	const bands = bandsOf(needs);
	const picked = kind && bands.some((b) => b.kind === kind) ? kind : null;
	const shown = picked
		? needs.filter((n) => n.info.status === picked)
		: all
			? needs
			: needs.slice(0, NEEDS_SHOWN);
	const rest = picked || all ? [] : bandsOf(needs.slice(NEEDS_SHOWN));
	if (needs.length === 0) return null;
	return (
		<section
			aria-label="Needs you"
			className="flex flex-col gap-2"
			data-testid="home-needs"
		>
			<h2 className="flex items-center gap-3 text-heading text-text-1">
				<span className="flex items-center gap-2">
					Needs you
					<span className="text-meta font-medium text-warn tabular-nums">
						{count}
					</span>
				</span>
				{all && !picked && needs.length > NEEDS_SHOWN && (
					<button
						type="button"
						onClick={() => setAll(false)}
						className="inline-flex h-7 items-center rounded-control px-2 text-meta font-normal text-text-2 outline-none hover:bg-surface-2 hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent"
						data-testid="home-needs-fewer"
					>
						Show fewer
					</button>
				)}
				{picked && (
					<BandButton
						kind={picked}
						n={shown.length}
						on
						onPick={() => setKind(null)}
					/>
				)}
			</h2>
			<ListGrid label="Needs you">
				{shown.map((n) => (
					<NeedsCard
						key={n.id}
						node={n}
						asks={asks.get(n.id) ?? []}
						now={now}
					/>
				))}
			</ListGrid>
			{rest.length > 0 && (
				<div
					className="flex flex-wrap items-center gap-1"
					data-testid="home-needs-more"
				>
					<button
						type="button"
						onClick={() => setAll(true)}
						className="inline-flex h-7 items-center rounded-control px-2 text-meta text-text-2 tabular-nums outline-none hover:bg-surface-2 hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent"
						data-testid="home-needs-all"
					>
						{needs.length - shown.length} more
					</button>
					{rest.map((b) => (
						<BandButton
							key={b.kind}
							kind={b.kind}
							n={b.n}
							on={false}
							onPick={() => setKind(b.kind)}
						/>
					))}
				</div>
			)}
		</section>
	);
}

/** One thread that needs you: its state, its marks, its age and its one fix. */
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
	const [asking, setAsking] = useState(false);
	const ctx = useNeedsCtx(node, () => setAsking(true));
	const t = node.thread;
	const title =
		node.unit.incident?.title ??
		(t.title?.trim() || (t.kind === "chat" ? "Thread" : "Run"));
	const agent = t.harness ? agentName(t.harness) : null;
	const link = threadLink(t);
	const fixId = fixActionId(node.info.status, causeOf(node));
	const found =
		(fixId && entryOf(fixId, ctx)) ?? entryOf("needs.open", ctx) ?? null;
	const fix = found && !("separator" in found) ? found : null;
	const button = fix && (
		<Button
			size="sm"
			variant="secondary"
			disabled={fix.disabled}
			onClick={fix.id === "answer" ? undefined : fix.onSelect}
			data-testid="home-fix"
			data-fix={fix.id}
		>
			{fix.icon && <fix.icon aria-hidden />}
			{fix.label}
		</Button>
	);
	return (
		<ListCard
			title={title}
			status={node.info.status}
			meta={
				<span className="inline-flex items-center gap-2">
					{t.harness && agent && (
						<AgentBadge agent={t.harness} label={agent} model={t.model} inRow />
					)}
					{t.startedBy && <StartedByMark by={t.startedBy} />}
					{t.pr && (
						<PrMark number={t.pr.number} tone={t.pr.tone} count={t.pr.count} />
					)}
					{t.branch && <BranchMark branch={t.branch} />}
					<Time at={node.at} now={now || null} className="text-text-3" past />
				</span>
			}
			detail={detailLine(node, now, entry)}
			footer={
				fix?.id === "answer" && entry && state.can ? (
					<P.Root open={asking} onOpenChange={setAsking}>
						<P.Trigger asChild>{button}</P.Trigger>
						<P.Portal>
							<P.Content
								side="bottom"
								align="start"
								sideOffset={6}
								collisionPadding={8}
								aria-label="Waiting ask"
								data-float="pop"
								className={cn(SURFACE, FAMILY_CLASS.card, "p-2.5")}
								data-testid="home-ask-card"
							>
								<RowAsk
									state={state}
									ended={entry.ended}
									accessLevel={entry.accessLevel}
									now={now}
									count={asks.length}
									openHref={ctx.open}
								/>
							</P.Content>
						</P.Portal>
					</P.Root>
				) : fix?.id === "answer" ? (
					// An ask this device can't answer opens the thread.
					entryOf("needs.open", ctx) && (
						<Button size="sm" variant="secondary" onClick={ctx.open}>
							Open
						</Button>
					)
				) : (
					button
				)
			}
			link={(heading) => <Link {...link}>{heading}</Link>}
			menu={surfaceEntries("needs.card", "context", ctx)}
			mirrored
			testId="home-needs-card"
		/>
	);
}
