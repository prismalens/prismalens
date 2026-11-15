// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { LucideIcon } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import type { FactId } from "./fact";

/** One row of the details card; the registry builds them per thread kind. */
export interface DetailsRow {
	id: string;
	/** The fact the row shows, from `registry/closed/fact.ts`. */
	fact?: FactId;
	/** Rows of one group sit together; a hairline separates groups. In the box, the group is its slot. */
	group: string;
	/** 1 survives every density, 2 survives compact, 3 shows only in full. */
	priority: 1 | 2 | 3;
	icon?: LucideIcon;
	/** A brand or agent mark in place of `icon`. */
	mark?: ReactNode;
	/** Tints the icon only (sheet §9.1); the words stay neutral. */
	tone?: "danger" | "warn" | "accent" | "ok" | "sev-high" | "sev-low";
	label: ReactNode;
	value?: ReactNode;
	/** Two lines for prose such as a likely cause; everything else is one. */
	lines?: 1 | 2;
	mono?: boolean;
	/** A quiet slot's stand-in ("No pull request"): drawn dim, so the slot holds its place. */
	quiet?: boolean;
	onOpen?: () => void;
	/** A row drawn by its caller (buttons, live child rows), `span` lines tall. */
	control?: ReactNode;
	span?: number;
	/** Puts the row inside its object's registered surface, so right-click offers that object's menu. */
	wrap?: (row: ReactElement) => ReactElement;
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
	const body = rows.reduce(
		(h, r) => h + (r.lines === 2 ? ROW_2_H : ROW_H * (r.span ?? 1)),
		0,
	);
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

/** One slot of the thread's box: its rows are reserved even when quiet, so nothing moves. */
export interface BoxSlot {
	id: string;
	rows: number;
	/** Rare rows past the slot's height scroll inside it instead of dropping. */
	scroll?: boolean;
}

/** A slot's height: `rows` one-line rows; a two-line row takes two of them. */
const units = (r: DetailsRow) => (r.lines === 2 ? 2 : (r.span ?? 1));

/** The rows a slot keeps: in order, dropping the least needed until they fit. */
export function slotRows(rows: DetailsRow[], slot: BoxSlot): DetailsRow[] {
	let kept = rows.filter((r) => r.group === slot.id);
	if (slot.scroll) return kept;
	while (kept.reduce((n, r) => n + units(r), 0) > slot.rows) {
		const worst = kept.reduce((w, r) => (r.priority >= w.priority ? r : w));
		kept = kept.filter((r) => r !== worst);
	}
	return kept;
}

/** The box's height for a layout, the same whatever the slots hold (#1101 category 21 item 6). */
export function boxHeight(layout: readonly BoxSlot[]): number {
	return (
		PAD +
		layout.reduce((h, s) => h + s.rows * ROW_H, 0) +
		Math.max(0, layout.length - 1) * GROUP_GAP
	);
}
