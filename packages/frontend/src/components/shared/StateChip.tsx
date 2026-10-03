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
	| "neutral";

const toneVar: Record<ChipTone, string> = {
	critical: "var(--sev-critical)",
	high: "var(--sev-high)",
	medium: "var(--sev-medium)",
	low: "var(--sev-low)",
	info: "var(--sev-info)",
	live: "var(--live)",
	stale: "var(--warn)",
	active: "var(--live)",
	done: "var(--ok)",
	failed: "var(--danger)",
	neutral: "var(--text-2)",
};

export interface StateChipProps extends HTMLAttributes<HTMLSpanElement> {
	tone: ChipTone;
	/** Identifiers and values read in mono; words read in the UI face. */
	mono?: boolean;
	/** A dashed chip means "not configured": the thing is absent, not broken. */
	dashed?: boolean;
	/** A pulsing dot in front of the label, for a state that is changing right now. */
	pulse?: boolean;
	/** StateWord only: the dot keeps the colour, the word reads muted. */
	quiet?: boolean;
	children: ReactNode;
}

/**
 * Retired as a tinted chip (study-v3 §2): a state is a coloured word, and the
 * severity dot is the only filled shape. Kept as a name so the record's screens
 * PR 3 restyles render as words meanwhile.
 */
export function StateChip({
	tone,
	mono,
	dashed,
	pulse: _pulse,
	quiet,
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
				"inline-flex items-center gap-1 whitespace-nowrap text-meta font-medium",
				dashed || quiet ? "text-text-3" : "text-(--chip)",
				mono && "font-mono tabular-nums",
				className,
			)}
			{...props}
		>
			{children}
		</span>
	);
}

/**
 * A state as a coloured word (study-v2 §2.5 rule 9). No dot: the severity dot is
 * the only filled circle in the app. Same tone tokens as the chip.
 */
export function StateWord({
	tone,
	pulse,
	quiet,
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
				"inline-flex items-center gap-1.5 whitespace-nowrap text-meta font-medium",
				quiet ? "text-text-2" : "text-(--chip)",
				className,
			)}
			data-pulse={pulse ? "" : undefined}
			{...props}
		>
			{children}
		</span>
	);
}
