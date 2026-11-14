// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { shortTime } from "@prismalens/contracts";
import { Mark } from "@/components/kit/Mark";
import { markLook } from "@/components/kit/marks";
import { Status, type StatusKind } from "@/components/kit/Status";
import {
	type InboundRow,
	type InboundTone,
	inboundText,
	inboundWords,
	retryWords,
} from "@/lib/inbound-rows";
import { cn } from "@/lib/utils";

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
	return (
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
							<span
								className={tone === "failed" ? "text-danger" : undefined}
								data-testid="inbound-words"
							>
								{text}
							</span>
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
		</li>
	);
}
