// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { shortTime } from "@prismalens/contracts";
import { useNavigate } from "@tanstack/react-router";
import { Mark } from "@/components/kit/Mark";
import { markLook } from "@/components/kit/marks";
import { surfaceEntries } from "@/components/kit/registry";
import { Status, type StatusKind } from "@/components/kit/Status";
import { Surface } from "@/components/kit/Surface";
import { Hint } from "@/components/shared/Hint";
import { Button } from "@/components/ui/button";
import { compose } from "@/lib/compose";
import {
	type InboundRow,
	type InboundTone,
	inboundText,
	inboundWords,
	retryWords,
} from "@/lib/inbound-rows";
import { cn } from "@/lib/utils";
import type { InboundCtx } from "./inbound.actions";

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
	const quoted = inboundText(row);
	const navigate = useNavigate();
	const ctx: InboundCtx = {
		sendAgain: () => compose(quoted),
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
				className="flex min-w-0 flex-col gap-0.5 py-0.5"
				data-testid="transcript-inbound"
				data-state={row.state}
			>
				<div className="flex min-w-0 items-center gap-2 text-meta">
					{tone === "delivered" ? (
						<Mark id="inbound" state={row.source} word={source} />
					) : (
						<Status kind={STATUS[tone]} showWord={false} />
					)}
					<span className="min-w-0 truncate text-text-2">
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
						{(tone !== "delivered" || row.mergedAt) && (
							<>
								{" · "}
								{/* A long reason truncates; the whole of it is the hint. */}
								<Hint label={text} when={tone === "failed"}>
									<span
										className={tone === "failed" ? "text-danger" : undefined}
										data-testid="inbound-words"
									>
										{text}
									</span>
								</Hint>
							</>
						)}
					</span>
					<span className="ml-auto shrink-0 text-text-3 tabular-nums">
						{shortTime(new Date(row.arrivedAt), locale)}
					</span>
				</div>
				{quoted && (
					<p
						dir="auto"
						className={cn(
							"relative ml-[22px] line-clamp-2 pl-3 text-body text-text-1 [overflow-wrap:anywhere]",
							"before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:rounded-full before:bg-surface-4",
						)}
					>
						{quoted}
					</p>
				)}
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
