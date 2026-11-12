// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** One row of the details card; the registry builds them per thread kind. */
export interface DetailsRow {
	id: string;
	/** Rows of one group sit together; a hairline separates groups. */
	group: string;
	/** 1 survives every density, 2 survives compact, 3 shows only in full. */
	priority: 1 | 2 | 3;
	icon?: LucideIcon;
	/** A brand or agent mark in place of `icon`. */
	mark?: ReactNode;
	/** Tints the icon only (sheet §9.1); the words stay neutral. */
	tone?: "danger" | "warn" | "accent" | "sev-high" | "sev-low";
	label: ReactNode;
	value?: ReactNode;
	/** Two lines for prose such as a likely cause; everything else is one. */
	lines?: 1 | 2;
	mono?: boolean;
	onOpen?: () => void;
}

export type Density = "full" | "compact" | "essential";
const DENSITIES: Density[] = ["full", "compact", "essential"];
const MAX_PRIORITY: Record<Density, number> = {
	full: 3,
	compact: 2,
	essential: 1,
};

export const ROW_H = 28;
const ROW_2_H = 44;
const PAD = 12;
const GROUP_GAP = 9;
/** The card's width and the narrowest the transcript may get beside it. */
export const CARD_W = 280;
export const TRANSCRIPT_MIN = 560;
export const DOCK_GAP = 16;

export function visibleRows(rows: DetailsRow[], density: Density) {
	return rows.filter((r) => r.priority <= MAX_PRIORITY[density]);
}

export function cardHeight(rows: DetailsRow[]) {
	const groups = new Set(rows.map((r) => r.group)).size;
	const body = rows.reduce((h, r) => h + (r.lines === 2 ? ROW_2_H : ROW_H), 0);
	return PAD + body + Math.max(0, groups - 1) * GROUP_GAP;
}

/** The fullest density whose rows fit the height; essential when none does. */
export function densityFor(height: number, rows: DetailsRow[]): Density {
	return (
		DENSITIES.find((d) => cardHeight(visibleRows(rows, d)) <= height) ??
		"essential"
	);
}

/** Docked while the transcript keeps its minimum beside it; a button otherwise. */
export function dockFor(areaWidth: number): "docked" | "button" {
	return areaWidth - CARD_W - DOCK_GAP >= TRANSCRIPT_MIN ? "docked" : "button";
}
