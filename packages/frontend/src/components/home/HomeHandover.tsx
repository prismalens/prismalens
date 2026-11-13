// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Home's handover (#1101 F3): under the composer, without a click, the threads
 * that need you, most urgent first with each one's fix, then what changed while
 * you were away as one digest that opens Events.
 */
import type { HarnessId } from "@prismalens/config/harness";
import { agentName } from "@prismalens/contracts";
import * as P from "@radix-ui/react-popover";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AwayDigest } from "@/components/home/AwayView";
import type { NeedsCtx } from "@/components/home/needs.actions";
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
	statusWord,
} from "@/components/kit/Status";
import { Time } from "@/components/kit/Time";
import { Hint } from "@/components/shared/Hint";
import { RowAsk, type RowAskEntry, useRowAsk } from "@/components/shell/RowAsk";
import {
	useAsksByThread,
	useThreadListModel,
} from "@/components/shell/ThreadList";
import { detailLine } from "@/components/shell/ThreadTree";
import { Button } from "@/components/ui/button";
import { useNow } from "@/hooks/use-now";
import { useResumeInvestigation } from "@/lib/api/hooks/use-investigations-orpc";
import { useRetryNow } from "@/lib/api/hooks/use-session-orpc";
import { accountPage } from "@/lib/provider-stop";
import { stopCause } from "@/lib/stop-causes";
import type { ListNode } from "@/lib/thread-list";
import { threadLink } from "@/lib/thread-rows";
import { cn } from "@/lib/utils";

/** Needs-you cards before "Show N more": two rows of the grid at desktop width. */
const NEEDS_SHOWN = 6;

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

/** Each urgency band's count as a mark in the heading: what kind of wait, at a glance. */
function NeedsTally({ needs }: { needs: ListNode[] }) {
	const bands: { kind: StatusKind; n: number }[] = [];
	for (const n of needs) {
		const kind = n.info.status;
		const band = bands.find((b) => b.kind === kind);
		if (band) band.n += 1;
		else bands.push({ kind, n: 1 });
	}
	if (bands.length < 2) return null;
	return (
		<span className="flex items-center gap-2.5" data-testid="home-needs-tally">
			{bands.map((b) => (
				<TallyMark key={b.kind} kind={b.kind} n={b.n} />
			))}
		</span>
	);
}

function TallyMark({ kind, n }: { kind: StatusKind; n: number }) {
	// The kit's Status draws the shape; its word rides in the hint (sheet §0.7).
	return (
		<Hint label={`${n} ${statusWord(kind)}`}>
			<span
				className="inline-flex items-center gap-1 text-meta font-normal text-text-2 tabular-nums"
				data-band={kind}
			>
				<Status kind={kind} showWord={false} />
				{n}
			</span>
		</Hint>
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
				<NeedsTally needs={needs} />
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
	);
}

/** What stopped a thread, as the status registry's `fix` reads it. */
const causeOf = (n: ListNode) =>
	n.info.mode ?? n.info.host ?? n.thread.limit?.mode ?? null;

/** The context a card's registered fix actions run with. */
function useNeedsCtx(node: ListNode, answer: () => void): NeedsCtx {
	const navigate = useNavigate();
	const retry = useRetryNow(node.id);
	const resume = useResumeInvestigation();
	const t = node.thread;
	const cause = causeOf(node);
	const view = cause ? stopCause(cause) : null;
	const url = view?.account
		? accountPage(t.harness, view.account.page, t.model)
		: null;
	return {
		answer,
		updateKey: () =>
			void navigate({
				to: "/settings",
				search: {
					tab: "agent",
					agent: (t.harness ?? undefined) as HarnessId | undefined,
				},
			}),
		account: () => {
			if (url) window.open(url, "_blank", "noopener");
		},
		freeSpace: () =>
			void navigate({ to: "/settings", search: { tab: "runs" } }),
		retryNow: () => retry.mutate(),
		resume: () => resume.mutate({ id: node.id }),
		open: () => void navigate(threadLink(t)),
		facts: {
			is: {
				ask: node.info.status === "approval" || node.info.status === "question",
				key: view?.fix === "needs.updateKey",
				credit: !!url && view?.fix === "needs.addCredit",
				cap: !!url && view?.fix === "needs.raiseCap",
				busy: retry.isPending || resume.isPending,
				disk: cause === "disk_full",
				interrupted: node.info.status === "interrupted",
			},
		},
	};
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
						<AgentBadge agent={t.harness} label={agent} model={t.model} />
					)}
					{t.startedBy && <StartedByMark by={t.startedBy} />}
					{t.pr && (
						<PrMark number={t.pr.number} tone={t.pr.tone} count={t.pr.count} />
					)}
					{t.branch && <BranchMark branch={t.branch} />}
					<Time at={node.at} now={now || null} className="text-text-3" />
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
			testId="home-needs-card"
		/>
	);
}
