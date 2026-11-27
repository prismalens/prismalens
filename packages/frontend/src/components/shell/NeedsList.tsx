// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { agentName, type ThreadStatus } from "@prismalens/contracts";
import * as P from "@radix-ui/react-popover";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
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
import { type RowAskEntry, useRowAsk } from "@/components/shell/RowAsk";
import { RowAsk } from "@/components/shell/RowAskCard";
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

/** The badge's list with its fixes: loads with the popover, so the shell carries no registry. */
export function NeedsPopoverList() {
	const { model } = useThreadListModel();
	const asks = useAsksByThread();
	const now = useNow(30_000) ?? 0;
	return <NeedsList needs={model.needs} asks={asks} now={now} />;
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
