// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type StateTone =
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

const toneVar: Record<StateTone, string> = {
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

export interface StateWordProps extends HTMLAttributes<HTMLSpanElement> {
	tone: StateTone;
	/** Identifiers and values read in mono; words read in the UI face. */
	mono?: boolean;
	/** A state that is changing right now; the motion pass hangs its cue here. */
	pulse?: boolean;
	/** The word reads muted: absent or not configured, rather than a state. */
	quiet?: boolean;
	children: ReactNode;
}

/**
 * A state as a coloured word (study-v3 §2): no tinted chip and no dot, the
 * severity dot being the only filled circle in the app.
 */
export function StateWord({
	tone,
	mono,
	pulse,
	quiet,
	className,
	style,
	children,
	...props
}: StateWordProps) {
	return (
		<span
			data-tone={tone}
			style={{ "--chip": toneVar[tone], ...style } as CSSProperties}
			className={cn(
				"inline-flex items-center gap-1.5 whitespace-nowrap text-meta font-medium",
				quiet ? "text-text-3" : "text-(--chip)",
				mono && "font-mono tabular-nums",
				className,
			)}
			data-pulse={pulse ? "" : undefined}
			{...props}
		>
			{children}
		</span>
	);
}
