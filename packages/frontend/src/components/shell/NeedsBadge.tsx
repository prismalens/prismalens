// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { agentName, type ThreadStatus } from "@prismalens/contracts";
import * as P from "@radix-ui/react-popover";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { causeOf } from "@/components/home/needs-cause";
import { useNeedsCtx } from "@/components/home/use-needs-ctx";
import { fact } from "@/components/kit/fact";
import { AgentBadge, StartedByMark } from "@/components/kit/MarkBadges";
import { ContextMenu } from "@/components/kit/Menu";
import { FAMILY_CLASS, SURFACE } from "@/components/kit/Popover";
import { entryOf, surfaceEntries } from "@/components/kit/registry";
import {
	fixActionId,
	Status,
	statusUrgency,
	statusWord,
} from "@/components/kit/Status";
import { Time } from "@/components/kit/Time";
import { RowAsk, type RowAskEntry, useRowAsk } from "@/components/shell/RowAsk";
import {
	useAsksByThread,
	useThreadListModel,
} from "@/components/shell/ThreadList";
import { detailLine, StatusMark } from "@/components/shell/ThreadTree";
import { Button } from "@/components/ui/button";
import { useNow } from "@/hooks/use-now";
import type { ListNode } from "@/lib/thread-list";
import { threadLink } from "@/lib/thread-rows";
import { cn } from "@/lib/utils";

/** How long a pointer may cross from the badge to its list, or leave it, before it closes. */
const HOVER_MS = 150;

/**
 * Needs you where the sidebar's list is off screen (#1247 D25): the count, drawn with the
 * most urgent waiting status. Hover or focus previews the threads grouped by urgency, and a
 * click or tap keeps them open, each with its one fix. Home carries no queue of its own.
 */
export function NeedsBadge({
	className,
	countClassName,
	testId,
	side = "bottom",
}: {
	className?: string;
	countClassName?: string;
	testId: string;
	side?: "bottom" | "right";
}) {
	const { model } = useThreadListModel();
	const asks = useAsksByThread();
	const now = useNow(30_000) ?? 0;
	const [open, setOpen] = useState(false);
	const pinned = useRef(false);
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
	useEffect(() => () => clearTimeout(timer.current), []);
	const count = model.needsCount;
	const top = model.needs[0]?.info.status;
	if (!count || !top) return null;
	const label = `${count} waiting for you`;
	const later = (next: boolean) => {
		clearTimeout(timer.current);
		timer.current = setTimeout(() => setOpen(next), HOVER_MS);
	};
	const hoverIn = (e: React.PointerEvent) => {
		if (e.pointerType !== "touch") later(true);
	};
	const hoverOut = (e: React.PointerEvent) => {
		if (e.pointerType !== "touch" && !pinned.current) later(false);
	};
	return (
		<P.Root
			open={open}
			onOpenChange={(next) => {
				clearTimeout(timer.current);
				if (!next) pinned.current = false;
				setOpen(next);
			}}
		>
			<P.Trigger asChild>
				<button
					type="button"
					aria-label={label}
					onPointerEnter={hoverIn}
					onPointerLeave={hoverOut}
					onFocus={(e) => e.target.matches(":focus-visible") && later(true)}
					onClick={(e) => {
						// A click keeps the list open; Radix's own toggle runs after this.
						if (open && !pinned.current) {
							e.preventDefault();
							pinned.current = true;
						} else pinned.current = !open;
					}}
					className={cn(
						"flex items-center gap-1.5 rounded-control font-medium text-text-1 tabular-nums hover:bg-surface-2",
						className,
					)}
					data-testid={testId}
					data-urgent={top}
				>
					<StatusMark status={top} />
					<span className={countClassName}>{count}</span>
				</button>
			</P.Trigger>
			<P.Portal>
				<P.Content
					side={side}
					align="start"
					sideOffset={6}
					collisionPadding={8}
					aria-label="Needs you"
					onPointerEnter={() => clearTimeout(timer.current)}
					onPointerLeave={hoverOut}
					onOpenAutoFocus={(e) => !pinned.current && e.preventDefault()}
					data-float="pop"
					className={cn(
						SURFACE,
						FAMILY_CLASS.card,
						"flex max-h-[min(70vh,560px)] w-[min(400px,calc(100vw-16px))] flex-col overflow-y-auto p-2",
					)}
					data-testid="needs-popover"
				>
					<NeedsList needs={model.needs} asks={asks} now={now} />
				</P.Content>
			</P.Portal>
		</P.Root>
	);
}

/** The waiting threads in urgency tiers, as the status registry ranks them; each tier's icons head it. */
export function NeedsList({
	needs,
	asks,
	now,
}: {
	needs: ListNode[];
	asks: ReadonlyMap<string, RowAskEntry[]>;
	now: number;
}) {
	const tiers = new Map<number, ListNode[]>();
	for (const n of needs) {
		const u = statusUrgency(n.info.status);
		tiers.set(u, [...(tiers.get(u) ?? []), n]);
	}
	return (
		<div className="flex flex-col gap-2" data-testid="needs-list">
			{[...tiers.entries()]
				.sort(([a], [b]) => a - b)
				.map(([u, rows]) => {
					const kinds = [...new Set(rows.map((n) => n.info.status))];
					const words = kinds.map(statusWord).join(", ");
					return (
						<section
							key={u}
							aria-label={`${words}: ${rows.length}`}
							className="flex flex-col"
							data-testid="needs-tier"
							data-urgency={u}
						>
							<h3 className="flex h-6 items-center gap-1.5 px-1.5 text-meta text-text-3">
								{kinds.map((k) => (
									<TierMark key={k} status={k} />
								))}
								<span className="font-medium text-text-1 tabular-nums">
									{rows.length}
								</span>
							</h3>
							<ul className="flex flex-col">
								{rows.map((n) => (
									<NeedsRow
										key={n.id}
										node={n}
										asks={asks.get(n.id) ?? []}
										now={now}
									/>
								))}
							</ul>
						</section>
					);
				})}
		</div>
	);
}

function TierMark({ status }: { status: ThreadStatus }) {
	return (
		<span role="img" aria-label={statusWord(status)} className="flex">
			<StatusMark status={status} />
		</span>
	);
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
	// The same registered fix as the sidebar row's (`RowFix`), by the same rule.
	const fixId = fixActionId(node.info.status, causeOf(node));
	const own = fixId ? entryOf(fixId, ctx) : null;
	const found = own ?? entryOf("needs.open", ctx) ?? null;
	const fix = found && !("separator" in found) ? found : null;
	const detail = detailLine(node, now, entry);
	const button = fix && (
		<Button
			size="sm"
			variant="secondary"
			disabled={fix.disabled}
			onClick={fix.id === "answer" ? undefined : fix.onSelect}
			className="max-w-44"
			data-testid="needs-fix"
			data-fix={fix.id}
			// The registered action it runs, the one the sidebar row's `RowFix` runs too.
			data-action={own ? fixId : "needs.open"}
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
						data-testid="needs-ask-card"
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
				className="group/row relative flex min-w-0 items-center gap-3 rounded-control px-1.5 py-1.5 hover:bg-surface-2"
				data-testid="needs-row"
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
					<span className="flex min-w-0 items-center gap-1.5 text-meta">
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
					</span>
					{detail && (
						<p
							className="line-clamp-2 text-meta text-text-2"
							{...fact("cause")}
						>
							{detail}
						</p>
					)}
				</div>
				{action && <div className="relative z-10 shrink-0">{action}</div>}
			</li>
		</ContextMenu>
	);
}
