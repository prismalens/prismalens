// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	CircleDot,
	Eye,
	Hand,
	type LucideIcon,
	Pencil,
	Shield,
	Signal,
	SignalHigh,
	SignalLow,
	SignalMedium,
	TriangleAlert,
} from "lucide-react";

/**
 * An agent's own mode id to an icon (pattern sheet §5); first match wins, so
 * "auto_edit" reads as edits before auto. Ids vary by agent, hence patterns.
 */
const MODE_ICONS: [RegExp, LucideIcon][] = [
	[/bypass|yolo|full|danger/, TriangleAlert],
	[/read|plan/, Eye],
	[/accept|edit/, Pencil],
	[/auto|review|dontask/, Shield],
	[/manual|default|ask/, Hand],
];

export function modeIcon(id: string): LucideIcon {
	const key = id.toLowerCase().replace(/[^a-z]/g, "");
	return MODE_ICONS.find(([re]) => re.test(key))?.[1] ?? CircleDot;
}

const EFFORT_ICONS: Record<string, LucideIcon> = {
	minimal: SignalLow,
	low: SignalLow,
	medium: SignalMedium,
	high: SignalHigh,
};

/** Effort levels past high (xhigh, max) share the full bars. */
export function effortIcon(id: string): LucideIcon {
	return EFFORT_ICONS[id.toLowerCase()] ?? Signal;
}
