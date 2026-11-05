// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Check, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type RingState = "busy" | "done" | "failed";

/** How long the still tick or cross stays after the work ends. */
export const SETTLE_MS = 1200;

/**
 * Work in flight is a ring; when it ends, a still tick or cross pops in once (#1020).
 * Drawn in the current text colour, so it reads on any button.
 */
export function RingTick({
	state,
	className,
}: {
	state: RingState;
	className?: string;
}) {
	const size = cn("size-3.5 shrink-0", className);
	if (state === "busy")
		return (
			<svg
				viewBox="0 0 16 16"
				fill="none"
				aria-hidden
				className={cn("ring-spin", size)}
				data-ring="busy"
			>
				<circle
					cx="8"
					cy="8"
					r="6"
					stroke="currentColor"
					strokeOpacity="0.3"
					strokeWidth="2"
				/>
				<path
					d="M8 2a6 6 0 0 1 6 6"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
				/>
			</svg>
		);
	const Mark = state === "done" ? Check : X;
	return (
		<Mark aria-hidden className={cn("tick-pop", size)} data-ring={state} />
	);
}

/**
 * The ring's state for one piece of work: busy while pending, then done or failed
 * for SETTLE_MS, then nothing.
 */
export function useRingTick(
	pending: boolean,
	failed: boolean,
): RingState | null {
	const [settled, setSettled] = useState<"done" | "failed" | null>(null);
	const was = useRef(pending);
	useEffect(() => {
		if (was.current && !pending) setSettled(failed ? "failed" : "done");
		if (pending) setSettled(null);
		was.current = pending;
	}, [pending, failed]);
	useEffect(() => {
		if (!settled) return;
		const t = window.setTimeout(() => setSettled(null), SETTLE_MS);
		return () => window.clearTimeout(t);
	}, [settled]);
	return pending ? "busy" : settled;
}
