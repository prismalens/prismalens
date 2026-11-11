// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { RunUsage, ThreadSession } from "@prismalens/contracts";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
	cacheWord,
	type MeterTone,
	meterLine,
	meterPercent,
	meterTone,
} from "./session-words";

const TONE: Record<MeterTone, string> = {
	neutral: "text-text-2",
	warn: "text-warn",
	danger: "text-danger",
};

const R = 6;
const C = 2 * Math.PI * R;

/** A ring filled to the share of the context window in use. */
export function MeterRing({
	percent,
	className,
}: {
	percent: number;
	className?: string;
}) {
	const tone = meterTone(percent);
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
		</svg>
	);
}

/**
 * The composer footer's context meter: the share of the window in use, and a
 * popover with the sizes, the cache state when known, and Compact.
 */
export function ContextMeter({
	usage,
	session,
	compactTakesFocus = false,
	open,
	onOpenChange,
	onCompact,
	compacting = false,
	running = false,
}: {
	usage: Pick<RunUsage, "used" | "size">;
	session?: Pick<ThreadSession, "cache" | "compactCommand"> | null;
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
	const percent = meterPercent(usage.used, usage.size);
	const cache = session ? cacheWord(session.cache) : null;
	const canCompact = !!session?.compactCommand && !!onCompact;
	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			<PopoverTrigger asChild>
				<button
					type="button"
					aria-label={`Context ${percent} percent used`}
					className="flex h-6 items-center gap-1 rounded-control px-1 text-meta text-text-3 tabular-nums hover:bg-surface-3 hover:text-text-1"
					data-testid="context-meter"
				>
					<MeterRing percent={percent} />
					{percent}%
				</button>
			</PopoverTrigger>
			<PopoverContent align="end" data-testid="context-meter-popover">
				<div className="grid w-60 gap-2">
					<p className="text-body text-text-1" data-testid="context-meter-line">
						{meterLine(usage.used, usage.size)}
					</p>
					{cache && (
						<p
							className="text-meta text-text-3"
							data-testid="context-meter-cache"
						>
							{cache}
						</p>
					)}
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
			</PopoverContent>
		</Popover>
	);
}
