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
	stale: "var(--warn)",
	active: "var(--live)",
	done: "var(--ok)",
	failed: "var(--danger)",
	primary: "var(--accent)",
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
 * The one chip for every state in the app: severity, status, run state, liveness.
 * Colour comes from a state token, never from a palette class, so a chip reads the
 * same on every screen and in both themes.
 */
export function StateChip({
	tone,
	mono,
	dashed,
	pulse,
	quiet: _quiet,
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
				"inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-[4px] px-1.5 text-meta font-medium leading-none",
				dashed ? "text-text-3" : "bg-(--chip)/12 text-(--chip)",
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
