// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ArrowDown, ChevronRight } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CardLink } from "@/components/incidents/cards/Card";
import { Mono } from "@/components/shared/Mono";
import {
	type ChipTone,
	StateChip,
	StateWord,
} from "@/components/shared/StateChip";
import { Button } from "@/components/ui/button";
import { formatClock, formatElapsed } from "@/lib/format-time";
import {
	OPERATOR_STATE_LABEL,
	type OperatorState,
	type TranscriptItem,
} from "@/lib/investigation-events";
import { INITIAL_TAIL_FOLLOW, nextTailFollow } from "@/lib/stream-autoscroll";
import { cn } from "@/lib/utils";

const OPERATOR_TONE: Record<OperatorState, ChipTone> = {
	queued: "stale",
	sent_now: "active",
	delivered: "active",
	answered: "done",
	not_delivered: "failed",
};

const ENTER =
	"motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200";

function prefersReducedMotion(): boolean {
	return (
		typeof window !== "undefined" &&
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
	);
}

/**
 * The conversation as chat (#743 §3c): newest at the bottom, following the
 * tail until the reader scrolls up, then a `New messages` button to return.
 */
export function Transcript({
	items,
	incidentId,
}: {
	items: TranscriptItem[];
	incidentId: string;
}) {
	const scrollRef = useRef<HTMLDivElement>(null);
	// Sampled while the reader scrolls: at append time the growth itself reads as a scroll-up (#280).
	const tailRef = useRef(INITIAL_TAIL_FOLLOW);
	const [unseen, setUnseen] = useState(false);
	const count = items.length;
	const lastKey = items[items.length - 1]?.key;

	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		const onScroll = () => {
			tailRef.current = nextTailFollow(tailRef.current, el);
			if (tailRef.current.following) setUnseen(false);
		};
		el.addEventListener("scroll", onScroll, { passive: true });
		return () => el.removeEventListener("scroll", onScroll);
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: follow on every append.
	useLayoutEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		if (tailRef.current.following) el.scrollTop = el.scrollHeight;
		else setUnseen(true);
	}, [count, lastKey]);

	const jump = () => {
		const el = scrollRef.current;
		if (!el) return;
		tailRef.current = { lastTop: el.scrollHeight, following: true };
		el.scrollTo({
			top: el.scrollHeight,
			behavior: prefersReducedMotion() ? "auto" : "smooth",
		});
		setUnseen(false);
	};

	return (
		<div className="relative min-h-0 flex-1">
			<div
				ref={scrollRef}
				className="h-full overflow-y-auto px-4 py-3"
				data-testid="transcript"
			>
				<div className="mx-auto flex max-w-3xl flex-col gap-2.5">
					{items.map((item) => (
						<TranscriptRow key={item.key} item={item} incidentId={incidentId} />
					))}
				</div>
			</div>
			{unseen && (
				<Button
					size="xs"
					variant="secondary"
					onClick={jump}
					className="absolute bottom-3 left-1/2 -translate-x-1/2 border shadow-sm motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-200"
					data-testid="transcript-new-messages"
				>
					New messages
					<ArrowDown />
				</Button>
			)}
		</div>
	);
}

function TranscriptRow({
	item,
	incidentId,
}: {
	item: TranscriptItem;
	incidentId: string;
}) {
	switch (item.kind) {
		case "prose":
			return (
				<p
					className={cn("whitespace-pre-wrap text-record", ENTER)}
					data-testid="transcript-prose"
				>
					{item.text}
				</p>
			);
		case "line":
			return (
				<p
					className={cn("text-meta text-muted-foreground", ENTER)}
					data-testid="transcript-line"
				>
					{item.text}
				</p>
			);
		case "tools":
			return <ToolGroup item={item} />;
		case "thought":
			return (
				<p
					className="text-meta text-muted-foreground"
					data-testid="transcript-thought"
				>
					Thought for {formatElapsed(item.seconds)}
				</p>
			);
		case "thinking":
			return (
				<p
					className={cn(
						"flex items-center gap-1.5 text-meta tabular-nums transition-colors duration-300 motion-reduce:transition-none",
						item.stale ? "text-stale" : "text-muted-foreground",
					)}
					data-testid="transcript-thinking"
				>
					<span
						aria-hidden
						className="h-1.5 w-1.5 rounded-full bg-current motion-safe:animate-pulse"
					/>
					Thinking {formatElapsed(item.seconds)}
				</p>
			);
		case "operator":
			return (
				<div
					className={cn(
						"rounded-r-md border-l-2 border-primary bg-primary/6 px-3 py-1.5",
						ENTER,
					)}
					data-testid="transcript-operator"
					data-state={item.state}
				>
					<div className="flex items-center gap-2 text-meta text-muted-foreground">
						<span className="font-medium text-foreground">You</span>
						<span className="tabular-nums">{formatClock(item.at)}</span>
						<span className="ml-auto flex items-center gap-2">
							{item.state === "queued" && <span>until the agent pauses</span>}
							<StateChip
								key={item.state}
								tone={OPERATOR_TONE[item.state]}
								pulse={item.state === "delivered" || item.state === "sent_now"}
								className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-150"
							>
								{OPERATOR_STATE_LABEL[item.state]}
							</StateChip>
						</span>
					</div>
					<p className="whitespace-pre-wrap text-record">{item.text}</p>
				</div>
			);
		case "end":
			return (
				<div
					className={cn("space-y-1 pt-1", ENTER)}
					data-testid="transcript-end"
				>
					<p className="flex flex-wrap items-center gap-2 text-meta">
						<StateWord tone={item.tone} className="whitespace-normal">
							{item.text}
						</StateWord>
						{item.detail && (
							<span className="text-muted-foreground tabular-nums">
								{item.detail}
							</span>
						)}
						{item.report && (
							<CardLink incidentId={incidentId} to="report">
								Read the report
							</CardLink>
						)}
					</p>
					{item.path && (
						<p className="text-meta text-muted-foreground">
							The raw wire transcript is at <Mono>{item.path}</Mono> under the
							workspace directory that pl up printed at start.
						</p>
					)}
				</div>
			);
		case "empty":
			return (
				<p
					className="py-6 text-center text-record text-muted-foreground"
					data-testid="transcript-empty"
				>
					{item.text}
				</p>
			);
	}
}

function ToolGroup({
	item,
}: {
	item: Extract<TranscriptItem, { kind: "tools" }>;
}) {
	const [open, setOpen] = useState(false);
	return (
		<div data-testid="transcript-tools">
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
				className="flex h-5 max-w-full items-center gap-1.5 truncate text-meta text-muted-foreground hover:text-foreground"
			>
				<ChevronRight className={cn("h-3 w-3 shrink-0", open && "rotate-90")} />
				<span key={item.count} className="shrink-0 text-foreground/80">
					Ran {item.count} tool{item.count === 1 ? "" : "s"}
				</span>
				{item.summary && <span className="truncate">{item.summary}</span>}
				{item.failed > 0 && (
					<span className="shrink-0 text-run-failed">{item.failed} failed</span>
				)}
			</button>
			{open && (
				<ul
					className="mt-1 space-y-0.5 border-l pl-3"
					data-testid="transcript-tool-rows"
				>
					{item.rows.map((row) => (
						<li key={row.key} className="min-w-0 text-meta">
							<span
								className={cn(
									"font-mono",
									row.ok === false ? "text-run-failed" : "text-foreground",
								)}
							>
								{row.message}
							</span>
							{row.detail && (
								<span className="ml-2 truncate text-muted-foreground">
									{row.detail}
								</span>
							)}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
