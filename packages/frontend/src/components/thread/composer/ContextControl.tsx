// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useRef } from "react";
import { Hint } from "@/components/shared/Hint";
import { MeterRing } from "@/components/thread/session/MeterRing";
import {
	meterPercent,
	tokenCount,
} from "@/components/thread/session/session-words";
import { cn } from "@/lib/utils";

/** What the next send does with the context it carries (sheet §10). */
export interface ContextChoice {
	used: number;
	/** The window, for the ring; without it the control shows no share. */
	size?: number;
	/** Where the agent compacts by itself, in percent; the ring warns before it. */
	autoAt?: number | null;
	/** The agent has a compact command. */
	canCompact: boolean;
	/** The next send may start a fresh session from a summary: a follow-up, not a live turn. */
	canFresh?: boolean;
}

export type ContextMode = "keep" | "compact" | "fresh";

/** Each choice the control offers: its word and what the next send does (#1101 category 11). */
export const CONTEXT_MODES: Record<
	ContextMode,
	{ word: string; does: (n: string) => string; click: string }
> = {
	keep: {
		word: "Keep",
		does: (n) => `Next send keeps all ${n} tokens.`,
		click: "Click to keep them all.",
	},
	compact: {
		word: "Compact",
		does: (n) => `Next send compacts ${n} tokens first.`,
		click: "Click to compact first.",
	},
	fresh: {
		word: "Summarize",
		does: (n) => `Next send starts fresh from a summary of ${n} tokens.`,
		click: "Click to start fresh from a summary.",
	},
};

/** What a click switches to from Keep: the agent's compact, else a fresh start, else nothing. */
export function contextAlternative(
	choice: Pick<ContextChoice, "canCompact" | "canFresh"> | null | undefined,
): Exclude<ContextMode, "keep"> | null {
	if (choice?.canCompact) return "compact";
	return choice?.canFresh ? "fresh" : null;
}

/** The one-sentence tooltip for the control's current state. */
export function contextHint(
	used: number,
	on: boolean,
	canCompact: boolean,
	canFresh = false,
) {
	const n = tokenCount(used);
	const alt = contextAlternative({ canCompact, canFresh });
	if (!alt) return `Next send keeps all ${n} tokens; this agent can't compact.`;
	return on
		? `${CONTEXT_MODES[alt].does(n)} ${CONTEXT_MODES.keep.click}`
		: `${CONTEXT_MODES.keep.does(n)} ${CONTEXT_MODES[alt].click}`;
}

const LONG_PRESS_MS = 500;

/**
 * "Keep 261k" or "Compact 261k" in the composer footer, its ring the meter: a click
 * toggles, a long press or right-click opens the breakdown (the same view as `/context`).
 */
export function ContextControl({
	choice,
	compact,
	onCompact,
	onBreakdown,
}: {
	choice: ContextChoice;
	compact: boolean;
	onCompact: (next: boolean) => void;
	onBreakdown: () => void;
}) {
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const pressed = useRef(false);
	const stop = () => {
		if (timer.current) clearTimeout(timer.current);
		timer.current = null;
	};
	const alt = contextAlternative(choice);
	const on = compact && !!alt;
	const mode: ContextMode = on && alt ? alt : "keep";
	return (
		<Hint
			label={contextHint(choice.used, on, choice.canCompact, choice.canFresh)}
			side="top"
		>
			<button
				type="button"
				aria-pressed={on}
				aria-disabled={alt ? undefined : true}
				data-testid="context-control"
				data-mode={on ? (alt ?? "compact") : "keep"}
				className={cn(
					"inline-flex h-7 shrink-0 items-center gap-1.5 rounded-control px-2 text-body outline-none focus-visible:ring-2 focus-visible:ring-accent",
					alt ? "hover:bg-surface-3 hover:text-text-1" : "cursor-default",
					on ? "text-text-1" : "text-text-2",
				)}
				onPointerDown={() => {
					pressed.current = false;
					stop();
					timer.current = setTimeout(() => {
						pressed.current = true;
						onBreakdown();
					}, LONG_PRESS_MS);
				}}
				onPointerUp={stop}
				onPointerLeave={stop}
				onContextMenu={(e) => {
					e.preventDefault();
					stop();
					onBreakdown();
				}}
				onClick={() => {
					// The click that ends a long press only opened the breakdown.
					if (pressed.current) {
						pressed.current = false;
						return;
					}
					if (alt) onCompact(!on);
				}}
			>
				<MeterRing
					percent={choice.size ? meterPercent(choice.used, choice.size) : 0}
					autoAt={choice.size ? choice.autoAt : null}
					className="size-3.5 shrink-0"
				/>
				<span className="font-medium">{CONTEXT_MODES[mode].word}</span>
				<span className="text-text-3 tabular-nums max-sm:hidden">
					{tokenCount(choice.used)}
				</span>
			</button>
		</Hint>
	);
}
