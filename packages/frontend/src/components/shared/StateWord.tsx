// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** One meaning set per hue (look ruling §1.2); lib/state-tone.ts picks them. */
export type StateTone =
	| "danger"
	| "warn"
	| "ok"
	| "live"
	| "accent"
	| "neutral"
	| "quiet"
	| "sev-high"
	| "sev-low"
	/** @deprecated danger; the last look PR removes the old names. */
	| "critical"
	/** @deprecated sev-high */
	| "high"
	/** @deprecated warn */
	| "medium"
	/** @deprecated sev-low */
	| "low"
	/** @deprecated quiet */
	| "info"
	/** @deprecated warn */
	| "stale"
	/** @deprecated live */
	| "active"
	/** @deprecated ok */
	| "done"
	/** @deprecated danger */
	| "failed";

const toneVar: Record<StateTone, string> = {
	danger: "var(--danger)",
	warn: "var(--warn)",
	ok: "var(--ok)",
	live: "var(--live)",
	accent: "var(--accent)",
	neutral: "var(--text-2)",
	quiet: "var(--text-3)",
	"sev-high": "var(--sev-high)",
	"sev-low": "var(--sev-low)",
	critical: "var(--danger)",
	high: "var(--sev-high)",
	medium: "var(--warn)",
	low: "var(--sev-low)",
	info: "var(--text-3)",
	stale: "var(--warn)",
	active: "var(--live)",
	done: "var(--ok)",
	failed: "var(--danger)",
};

export interface StateWordProps extends HTMLAttributes<HTMLSpanElement> {
	tone: StateTone;
	/** Identifiers and values read in mono; words read in the UI face. */
	mono?: boolean;
	/** A state that is changing right now: the word breathes on the shared clock. */
	pulse?: boolean;
	/** The word reads muted: absent or not configured, rather than a state. */
	quiet?: boolean;
	children: ReactNode;
}

/**
 * A state as a coloured word, 500 weight (look ruling §1.2): never a tint
 * behind it, and no dot; the severity dot is the only filled circle.
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
				quiet || tone === "quiet" || tone === "info"
					? "font-normal text-text-3"
					: "text-(--chip)",
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
