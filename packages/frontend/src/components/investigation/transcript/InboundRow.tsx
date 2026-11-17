// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { shortTime } from "@prismalens/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Clamp, estimateLines } from "@/components/kit/Clamp";
import { Mark } from "@/components/kit/Mark";
import { markLook } from "@/components/kit/marks";
import { surfaceEntries } from "@/components/kit/registry";
import { Status, type StatusKind } from "@/components/kit/Status";
import { Surface } from "@/components/kit/Surface";
import { Button } from "@/components/ui/button";
import { compose } from "@/lib/compose";
import { THREAD_LINES } from "@/lib/fold";
import {
	type InboundRow,
	type InboundTone,
	inboundText,
	inboundWords,
	retryWords,
} from "@/lib/inbound-rows";
import { lazyPart } from "@/lib/lazy";
import { cn } from "@/lib/utils";
import type { InboundCtx } from "./inbound.actions";

const DELIVERY_WORD = {
	wake: "Woke the agent",
	batch: "Batched",
	next_pause: "At the next pause",
} as const;

// The provenance list loads with the first PR bundle, off the thread page's first paint.
const PrEventsList = lazyPart(
	() => import("./InboundPrEvents").then((m) => m.InboundPrEvents),
	<span className="ml-[22px] text-meta text-text-3">PR events</span>,
);

const STATUS: Record<InboundTone, StatusKind> = {
	waiting: "waiting",
	delivered: "done",
	failed: "failed",
};

/**
 * An incoming message as one quiet line (sheet §10): its state's icon and words,
 * who sent it, its time; the text quoted under it, retries under that. No box.
 */
export function InboundRowView({ row }: { row: InboundRow }) {
	const locale =
		typeof navigator === "undefined" ? undefined : navigator.language;
	const { tone, text } = inboundWords(row, locale);
	const source = markLook("inbound", row.source).word ?? row.source;
	const who = row.from?.name ?? source;
	// A PR bundle quotes host text; its row lists provenance instead (#1179).
	const quoted = row.prEvents?.length ? "" : inboundText(row);
	const [open, setOpen] = useState(false);
	const navigate = useNavigate();
	const ctx: InboundCtx = {
		sendAgain: () => compose(inboundText(row)),
		openPr: () =>
			void navigate({
				to: ".",
				search: (s: Record<string, unknown>) => ({
					...s,
					panel: "thread" as const,
					section: `pull-requests:${row.prId}`,
				}),
			}),
		facts: { is: { failed: tone === "failed", pr: !!row.prId } },
	};
	// A failed row offers its steps; a waiting or delivered one keeps them in its menu.
	const next =
		tone === "failed" ? surfaceEntries("inbound.row", "more", ctx) : [];
	return (
		<Surface id="inbound.row" ctx={ctx}>
			<li
				className="group/msg flex min-w-0 flex-col gap-0.5 py-0.5"
				data-testid="transcript-inbound"
				data-state={row.state}
			>
				<div className="flex min-w-0 items-center gap-2 text-meta">
					{tone === "delivered" ? (
						<Mark id="inbound" state={row.source} word={source} />
					) : (
						<Status kind={STATUS[tone]} showWord={false} />
					)}
					{/* A failure's cause wraps, never cut off; only its icon is red (sheet §9.1, #1101 cat 23). */}
					<span
						className={cn(
							"min-w-0 text-text-2",
							tone === "failed" ? "[overflow-wrap:anywhere]" : "truncate",
						)}
					>
						{row.from?.link ? (
							<a
								href={row.from.link}
								className="font-medium text-text-1 hover:underline"
							>
								{who}
							</a>
						) : (
							<span className="font-medium text-text-1">{who}</span>
						)}
						{row.prEvents?.[0] && (
							<span className="text-text-3">
								{" · "}
								{DELIVERY_WORD[row.prEvents[0].delivery]}
							</span>
						)}
						{(tone !== "delivered" || row.mergedAt) && (
							<>
								{" · "}
								<span data-testid="inbound-words">{text}</span>
							</>
						)}
					</span>
					{/* Its sender is never the obvious one, so it stays (`META_SENDER`); the time shows on hover. */}
					<span
						className={cn(
							"ml-auto shrink-0 text-text-3 tabular-nums transition-opacity",
							"md:opacity-0 md:group-focus-within/msg:opacity-100 md:group-hover/msg:opacity-100",
						)}
					>
						{shortTime(new Date(row.arrivedAt), locale)}
					</span>
				</div>
				{/* Its sender and 3 lines (`FOLD.inbound`); a page carries only their head (#1101 cat 12). */}
				{quoted && (
					<div className="ml-[22px]">
						<Clamp
							lines={THREAD_LINES}
							over={estimateLines(quoted, 70) > THREAD_LINES}
							open={open}
							onToggle={() => setOpen((o) => !o)}
							testId="inbound-clamp"
						>
							<p
								dir="auto"
								className={cn(
									"relative pl-3 text-body text-text-1 [overflow-wrap:anywhere]",
									"before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:rounded-full before:bg-surface-4",
								)}
							>
								{quoted}
							</p>
						</Clamp>
					</div>
				)}
				{row.prEvents?.length ? <PrEventsList prs={row.prEvents} /> : null}
				{row.retries.map((r) => (
					<span
						key={r.attempt}
						className="ml-[22px] text-meta text-text-3"
						data-testid="inbound-retry"
					>
						{retryWords(r, locale)}
					</span>
				))}
				{next.length > 0 && (
					<span className="ml-[16px] flex items-center gap-1">
						{next.map((e) =>
							"separator" in e ? null : (
								<Button
									key={e.id}
									variant="text"
									size="sm"
									onClick={e.onSelect}
									data-testid={`inbound-${e.id}`}
								>
									{e.icon && <e.icon className="size-3" aria-hidden />}
									{e.label}
								</Button>
							),
						)}
					</span>
				)}
			</li>
		</Surface>
	);
}
