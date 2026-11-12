// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Shrink } from "lucide-react";
import { useRef } from "react";
import { Hint } from "@/components/shared/Hint";
import { tokenCount } from "@/components/thread/session/session-words";
import { cn } from "@/lib/utils";

/** What the next send does with the context it carries (sheet §10). */
export interface ContextChoice {
	used: number;
	/** The agent has a compact command; without one the next send always keeps. */
	canCompact: boolean;
}

/** The one-sentence tooltip for the control's current state. */
export function contextHint(
	used: number,
	compact: boolean,
	canCompact: boolean,
) {
	const n = tokenCount(used);
	if (!canCompact)
		return `Next send keeps all ${n} tokens; this agent can't compact.`;
	return compact
		? `Next send compacts ${n} tokens first. Click to keep them all.`
		: `Next send keeps all ${n} tokens. Click to compact first.`;
}

const LONG_PRESS_MS = 500;

/**
 * "Keep 261k" or "Compact 261k" in the composer footer: a click toggles, a
 * long press or right-click opens the breakdown (the same view as `/context`).
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
	const on = compact && choice.canCompact;
	return (
		<Hint label={contextHint(choice.used, on, choice.canCompact)} side="top">
			<button
				type="button"
				aria-pressed={on}
				aria-disabled={choice.canCompact ? undefined : true}
				data-testid="context-control"
				data-mode={on ? "compact" : "keep"}
				className={cn(
					"inline-flex h-7 shrink-0 items-center gap-1.5 rounded-control px-2 text-body outline-none focus-visible:ring-2 focus-visible:ring-accent",
					choice.canCompact
						? "hover:bg-surface-3 hover:text-text-1"
						: "cursor-default",
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
					if (choice.canCompact) onCompact(!on);
				}}
			>
				<Shrink aria-hidden className="size-3.5 shrink-0 text-text-3" />
				<span className="font-medium">{on ? "Compact" : "Keep"}</span>
				<span className="text-text-3 tabular-nums max-sm:hidden">
					{tokenCount(choice.used)}
				</span>
			</button>
		</Hint>
	);
}
