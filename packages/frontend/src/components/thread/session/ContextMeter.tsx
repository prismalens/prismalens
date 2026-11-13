// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { RunUsage, ThreadSession } from "@prismalens/contracts";
import { useState } from "react";
import { Block } from "@/components/kit/Block";
import { KitPopover } from "@/components/kit/Popover";
import { Hint } from "@/components/shared/Hint";
import { contextBreakdownBlock } from "@/components/thread/session/context.blocks";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CATEGORY_LABEL, type ContextBreakdown } from "@/lib/context-breakdown";
import { cn } from "@/lib/utils";
import {
	cacheWord,
	type MeterTone,
	meterLine,
	meterPercent,
	meterTone,
	tokenCount,
} from "./session-words";

/** Brightness, never hue (sheet §9.1): the ring steps up as the compaction point nears. */
const TONE: Record<MeterTone, string> = {
	neutral: "text-text-3",
	warn: "text-text-2",
	danger: "text-text-1",
};

const R = 6;
const C = 2 * Math.PI * R;

/** A ring filled to the share of the context window in use, with a tick where it compacts. */
export function MeterRing({
	percent,
	autoAt,
	className,
}: {
	percent: number;
	/** The percent where the agent compacts by itself; the tone warns before it. */
	autoAt?: number | null;
	className?: string;
}) {
	const tone = meterTone(percent, autoAt);
	const angle = autoAt ? (autoAt / 100) * 2 * Math.PI : null;
	return (
		<svg
			viewBox="0 0 16 16"
			aria-hidden
			className={cn("size-4 -rotate-90", TONE[tone], className)}
			data-tone={tone}
			data-testid="context-meter-ring"
		>
			<circle
				cx="8"
				cy="8"
				r={R}
				fill="none"
				strokeWidth="2"
				className="stroke-track"
			/>
			<circle
				cx="8"
				cy="8"
				r={R}
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeDasharray={`${(percent / 100) * C} ${C}`}
			/>
			{angle !== null && (
				<line
					x1={8 + (R - 2) * Math.cos(angle)}
					y1={8 + (R - 2) * Math.sin(angle)}
					x2={8 + (R + 2) * Math.cos(angle)}
					y2={8 + (R + 2) * Math.sin(angle)}
					strokeWidth="1.25"
					className="stroke-text-1"
					data-testid="context-meter-auto"
				/>
			)}
		</svg>
	);
}

/**
 * The composer footer's context meter (#1101 cat 11): always shown, the share of the window
 * in use, warning before the agent compacts by itself; `/context` opens the breakdown.
 */
export function ContextMeter({
	usage,
	session,
	agent = "The agent",
	autoAt,
	breakdown,
	cacheUntil,
	compactTakesFocus = false,
	open,
	onOpenChange,
	onCompact,
	compacting = false,
	running = false,
}: {
	/** Null when the agent has reported no usage: the meter says so, never zero. */
	usage: Pick<RunUsage, "used" | "size"> | null;
	session?: Pick<ThreadSession, "cache" | "compactCommand"> | null;
	agent?: string;
	/** The percent of the window where the agent compacts by itself; null when not known. */
	autoAt?: number | null;
	breakdown?: ContextBreakdown | null;
	/** When a warm cache goes cold, for "Cache warm until 14:05". */
	cacheUntil?: string | null;
	/** UI 1's registry flag: this agent's compact command takes a focus. */
	compactTakesFocus?: boolean;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	onCompact?: (instructions?: string) => void;
	compacting?: boolean;
	/** The API refuses a compaction while a turn runs. */
	running?: boolean;
}) {
	const [focus, setFocus] = useState("");
	const percent = usage ? meterPercent(usage.used, usage.size) : 0;
	const cache = session ? cacheWord(session.cache) : null;
	const canCompact = !!session?.compactCommand && !!onCompact;
	const autoTokens =
		usage && autoAt ? Math.round((usage.size * autoAt) / 100) : null;
	return (
		<KitPopover
			family="card"
			side="top"
			align="start"
			label="Context"
			open={open}
			onOpenChange={onOpenChange}
			contentProps={{
				// `/context` opens it while the composer keeps focus; only a click elsewhere closes it.
				onOpenAutoFocus: (e) => e.preventDefault(),
				onFocusOutside: (e) => e.preventDefault(),
				...({ "data-testid": "context-meter-popover" } as Record<
					string,
					string
				>),
			}}
			trigger={
				<button
					type="button"
					aria-label={
						usage
							? `Context ${percent} percent used`
							: "Context use not reported"
					}
					className="flex h-6 items-center gap-1 rounded-control px-1 text-meta text-text-3 tabular-nums hover:bg-surface-3 hover:text-text-1"
					data-testid="context-meter"
					data-reported={usage ? "" : undefined}
				>
					<MeterRing percent={percent} autoAt={usage ? autoAt : null} />
					{/* The ring carries the share; the words are the ratio alone, as a mark. */}
					{usage
						? `${tokenCount(usage.used)}/${tokenCount(usage.size)}`
						: "Context"}
				</button>
			}
		>
			<div className="grid gap-2 p-2">
				<p className="text-body text-text-1" data-testid="context-meter-line">
					{usage
						? `${meterLine(usage.used, usage.size)} (${percent}%)`
						: `${agent} does not report its context use.`}
				</p>
				{usage && (
					<p
						className="text-meta text-text-3"
						data-testid="context-meter-auto-line"
					>
						{autoTokens
							? `Compacts by itself at ${tokenCount(autoTokens)} (${autoAt}%)`
							: "Its automatic compaction point is not reported"}
					</p>
				)}
				{breakdown && breakdown.rows.length > 0 && (
					<ContextTable breakdown={breakdown} />
				)}
				<p className="text-meta text-text-3" data-testid="context-meter-cache">
					{cache === "Cache warm" && cacheUntil
						? `Cache warm until ${cacheUntil}`
						: (cache ?? "Cache state not reported")}
				</p>
				{canCompact && (
					<form
						className="grid gap-2"
						onSubmit={(e) => {
							e.preventDefault();
							onCompact?.(compactTakesFocus ? focus : undefined);
						}}
					>
						{compactTakesFocus && (
							<Textarea
								value={focus}
								onChange={(e) => setFocus(e.target.value)}
								placeholder="What to keep (optional)"
								aria-label="What to keep"
								rows={2}
								maxLength={2000}
								data-testid="context-meter-focus"
							/>
						)}
						<Button
							type="submit"
							variant="secondary"
							size="sm"
							disabled={compacting || running}
							data-testid="context-meter-compact"
						>
							{compacting ? "Compacting" : "Compact"}
						</Button>
					</form>
				)}
			</div>
		</KitPopover>
	);
}

/** `/context`: each category with tokens and percent, then the largest items. */
export function ContextTable({ breakdown }: { breakdown: ContextBreakdown }) {
	const lines = [
		...breakdown.rows.map(
			(r) =>
				`${CATEGORY_LABEL[r.category]}\t${tokenCount(r.tokens)}\t${r.percent}%`,
		),
		`Free\t${tokenCount(breakdown.free)}`,
		...breakdown.largest.map((it) => `${it.label}\t${tokenCount(it.tokens)}`),
	];
	return (
		<Block
			spec={contextBreakdownBlock}
			data={{ lines }}
			className="grid gap-1.5"
			testId="context-breakdown"
		>
			{(chrome) => (
				<>
					<div className="flex items-start gap-1">
						<table className="min-w-0 flex-1 text-meta tabular-nums">
							<tbody>
								{breakdown.rows.map((r) => (
									<tr key={r.category} data-category={r.category}>
										<td className="py-0.5 text-text-2">
											{CATEGORY_LABEL[r.category]}
										</td>
										<td className="py-0.5 text-right text-text-1">
											{tokenCount(r.tokens)}
										</td>
										<td className="w-12 py-0.5 text-right text-text-3">
											{r.percent}%
										</td>
									</tr>
								))}
								<tr>
									<td className="py-0.5 text-text-3">Free</td>
									<td className="py-0.5 text-right text-text-3">
										{tokenCount(breakdown.free)}
									</td>
									<td />
								</tr>
							</tbody>
						</table>
						{chrome}
					</div>
					{breakdown.largest.length > 0 && (
						<div className="grid gap-0.5" data-testid="context-largest">
							<p className="text-meta text-text-3">Largest items</p>
							{breakdown.largest.map((it, i) => (
								<p
									// Items may repeat a label; the order is the identity.
									// biome-ignore lint/suspicious/noArrayIndexKey: ranked list
									key={i}
									className="flex min-w-0 gap-2 text-meta"
								>
									<span className="min-w-0 flex-1 truncate text-text-2">
										{it.label}
									</span>
									<span className="shrink-0 text-text-1 tabular-nums">
										{tokenCount(it.tokens)}
									</span>
								</p>
							))}
						</div>
					)}
					<Hint label="The agent reports only the total">
						<p className="self-start text-meta text-text-3">Estimated</p>
					</Hint>
					{breakdown.trim && (
						<p className="text-meta text-text-2" data-testid="context-trim">
							{breakdown.trim}
						</p>
					)}
				</>
			)}
		</Block>
	);
}
