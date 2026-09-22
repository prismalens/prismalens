// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ChipTone =
	| "critical"
	| "high"
	| "medium"
	| "low"
	| "info"
	| "live"
	| "stale"
	| "active"
	| "done"
	| "failed"
	| "primary"
	| "neutral";

const toneVar: Record<ChipTone, string> = {
	critical: "var(--sev-critical)",
	high: "var(--sev-high)",
	medium: "var(--sev-medium)",
	low: "var(--sev-low)",
	info: "var(--sev-info)",
	live: "var(--live)",
	stale: "var(--stale)",
	active: "var(--run-active)",
	done: "var(--run-done)",
	failed: "var(--run-failed)",
	primary: "var(--primary)",
	neutral: "var(--muted-foreground)",
};

export interface StateChipProps extends HTMLAttributes<HTMLSpanElement> {
	tone: ChipTone;
	/** Identifiers and values read in mono; words read in the UI face. */
	mono?: boolean;
	/** A dashed chip means "not configured": the thing is absent, not broken. */
	dashed?: boolean;
	/** A pulsing dot in front of the label, for a state that is changing right now. */
	pulse?: boolean;
	children: ReactNode;
}

/**
 * The one chip for every state in the app: severity, status, run state, liveness.
 * Colour comes from a state token, never from a palette class, so a chip reads the
 * same on every screen and in both themes.
 */
export function StateChip({
	tone,
	mono,
	dashed,
	pulse,
	className,
	style,
	children,
	...props
}: StateChipProps) {
	return (
		<span
			data-tone={tone}
			style={{ "--chip": toneVar[tone], ...style } as CSSProperties}
			className={cn(
				"inline-flex h-5 items-center gap-1 whitespace-nowrap rounded border px-1.5 text-meta font-medium leading-none",
				"border-(--chip)/35 bg-(--chip)/12 text-(--chip)",
				dashed && "border-dashed bg-transparent",
				mono && "font-mono tabular-nums",
				className,
			)}
			{...props}
		>
			{pulse && (
				<span
					aria-hidden
					className="h-1.5 w-1.5 rounded-full bg-(--chip) motion-safe:animate-pulse"
				/>
			)}
			{children}
		</span>
	);
}
