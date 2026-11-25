// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Home's handover (#1101 F3): under the composer, the threads that need you with
 * each one's fix while the sidebar's list is off screen, then what changed while
 * you were away as one digest that opens Events.
 */
import type { HarnessId } from "@prismalens/config/harness";
import { agentName } from "@prismalens/contracts";
import * as P from "@radix-ui/react-popover";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AwayDigest } from "@/components/home/AwayView";
import type { NeedsCtx } from "@/components/home/needs.actions";
import { fact } from "@/components/kit/fact";
import { AgentBadge, StartedByMark } from "@/components/kit/MarkBadges";
import { ContextMenu } from "@/components/kit/Menu";
import { FAMILY_CLASS, SURFACE } from "@/components/kit/Popover";
import { entryOf, surfaceEntries } from "@/components/kit/registry";
import { fixActionId, Status } from "@/components/kit/Status";
import { Time } from "@/components/kit/Time";
import { RowAsk, type RowAskEntry, useRowAsk } from "@/components/shell/RowAsk";
import {
	useAsksByThread,
	useThreadListModel,
} from "@/components/shell/ThreadList";
import { detailLine } from "@/components/shell/ThreadTree";
import { Button } from "@/components/ui/button";
import { useNow } from "@/hooks/use-now";
import { agentFacts } from "@/lib/agent-facts";
import { useResumeInvestigation } from "@/lib/api/hooks/use-investigations-orpc";
import { useRetryNow } from "@/lib/api/hooks/use-session-orpc";
import { failureWords, signInCommand } from "@/lib/failure-words";
import { accountLink } from "@/lib/provider-stop";
import { stopCause } from "@/lib/stop-causes";
import type { ListNode } from "@/lib/thread-list";
import { threadLink } from "@/lib/thread-rows";
import { cn } from "@/lib/utils";

/** Rows before "N more": a phone screen keeps the composer and the first rows in view. */
const NEEDS_SHOWN = 5;

/** Shown only while the sidebar's own Needs you is off screen: below 1280 px, folded or hidden (`use-layout-prefs`). */
const SIDEBAR_OFF =
	"xl:hidden [[data-sidebar-folded]_&]:flex [[data-sidebar-hidden]_&]:flex";

export function HomeHandover() {
	const { model } = useThreadListModel();
	const asks = useAsksByThread();
	const now = useNow(30_000) ?? 0;
	// The digest leaves out what waits on you at every width, so phone and desktop list the same changes (bar 3.1).
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

/**
 * The threads that need you as rows, most urgent first, each with its cause and one fix,
 * for when the sidebar's Needs you is off screen (one list calls for attention, GUIDELINES rule 3).
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
	const [all, setAll] = useState(false);
	if (needs.length === 0) return null;
	const shown = all ? needs : needs.slice(0, NEEDS_SHOWN);
	const left = needs.length - shown.length;
	return (
		<section
			aria-label="Needs you"
			className={cn("flex flex-col gap-1", SIDEBAR_OFF)}
			data-testid="home-needs"
		>
			<h2 className="flex items-center gap-2 text-heading text-text-1">
				Needs you
				<span className="text-meta font-medium text-warn tabular-nums">
					{count}
				</span>
			</h2>
			<ul aria-label="Needs you" className="flex flex-col">
				{shown.map((n) => (
					<NeedsRow key={n.id} node={n} asks={asks.get(n.id) ?? []} now={now} />
				))}
			</ul>
			{(left > 0 || (all && needs.length > NEEDS_SHOWN)) && (
				<button
					type="button"
					onClick={() => setAll(!all)}
					className="-mx-1.5 flex min-h-8 items-center self-start rounded-control px-1.5 text-meta text-text-3 tabular-nums outline-none hover:bg-surface-2 hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent max-sm:min-h-11"
					data-testid={all ? "home-needs-fewer" : "home-needs-all"}
				>
					{all ? "Show fewer" : `${left} more`}
				</button>
			)}
		</section>
	);
}

/** What stopped a thread: a provider or host stop. */
const stopOf = (n: ListNode) =>
	n.info.mode ?? n.info.host ?? n.thread.limit?.mode ?? null;

/** The cause the status registry's `fix` reads: a stop, or a signed-out agent's failure. */
const causeOf = (n: ListNode) =>
	stopOf(n) ??
	(n.info.status === "failed" &&
	n.thread.error &&
	failureWords(n.thread.error).signIn
		? "sign_in"
		: null);

/** The context a card's registered fix actions run with. */
function useNeedsCtx(node: ListNode, answer: () => void): NeedsCtx {
	const navigate = useNavigate();
	const retry = useRetryNow(node.id);
	const resume = useResumeInvestigation();
	const t = node.thread;
	const cause = causeOf(node);
	const stop = stopOf(node);
	const view = stop ? stopCause(stop) : null;
	const link = view?.account
		? accountLink(t.harness, view.account.page, t.model)
		: null;
	const url = link?.url ?? null;
	const command = signInCommand(agentFacts(t.harness)?.loginHint);
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
		accountLabel: link?.label ?? "",
		signInCommand: command,
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
				signIn: cause === "sign_in" && !!command,
				interrupted: node.info.status === "interrupted",
			},
		},
	};
}

/** One thread that needs you: its status, title, cause, marks and age, and its one fix. */
function NeedsRow({
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
	const detail = detailLine(node, now, entry);
	const button = fix && (
		<Button
			size="sm"
			variant="secondary"
			disabled={fix.disabled}
			onClick={fix.id === "answer" ? undefined : fix.onSelect}
			className="max-w-44"
			data-testid="home-fix"
			data-fix={fix.id}
		>
			{fix.icon && <fix.icon aria-hidden />}
			<span className="truncate">{fix.label}</span>
		</Button>
	);
	const action =
		fix?.id === "answer" && entry && state.can ? (
			<P.Root open={asking} onOpenChange={setAsking}>
				<P.Trigger asChild>{button}</P.Trigger>
				<P.Portal>
					<P.Content
						side="bottom"
						align="end"
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
		);
	return (
		<ContextMenu
			label={`${title} actions`}
			entries={surfaceEntries("needs.card", "context", ctx)}
		>
			<li
				className="group/row relative -mx-1.5 flex min-w-0 items-center gap-3 rounded-control px-1.5 py-1.5 hover:bg-surface-2"
				data-testid="home-needs-row"
				data-id={node.id}
				data-status={node.info.status}
			>
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span className="flex min-w-0 items-center gap-2">
						<Link
							{...link}
							className="min-w-0 truncate text-body font-medium text-text-1 outline-none after:absolute after:inset-0 after:rounded-control focus-visible:after:ring-2 focus-visible:after:ring-accent"
							{...fact("title")}
						>
							{title}
						</Link>
						<Time
							at={node.at}
							now={now || null}
							className="ml-auto shrink-0 text-meta text-text-3"
							past
						/>
					</span>
					<span className="flex min-w-0 items-center gap-1.5 text-meta text-text-3">
						<Status kind={node.info.status} className="shrink-0" />
						{t.harness && agent && (
							<AgentBadge
								agent={t.harness}
								label={agent}
								model={t.model}
								inRow
							/>
						)}
						{t.startedBy && <StartedByMark by={t.startedBy} />}
						{detail && (
							<span className="min-w-0 truncate" {...fact("cause")}>
								{detail}
							</span>
						)}
					</span>
				</div>
				{action && <div className="relative z-10 shrink-0">{action}</div>}
			</li>
		</ContextMenu>
	);
}
