// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { LucideIcon } from "lucide-react";

/**
 * The closed set of metadata marks (#1125): one icon, an accessible label and a
 * tone per state, for status, agent, branch, PR or MR checks, children, asks,
 * limit and risk. The design owner fills `MARKS`; surfaces name the ones they show.
 */
export type MarkTone = "ok" | "warn" | "danger" | "info" | "muted";

export interface MarkDef<State extends string = string> {
	id: string;
	icon: LucideIcon;
	label: string;
	tones: Readonly<Record<State, MarkTone>>;
}

export function defineMark<const M extends MarkDef>(mark: M): M {
	return mark;
}

export const MARKS = {} as const satisfies Readonly<Record<string, MarkDef>>;

export type MarkId = keyof typeof MARKS & string;
