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
const MODE_ICONS: [RegExp, LucideIcon, string][] = [
	[
		/bypass|yolo|full|danger/,
		TriangleAlert,
		"Runs every action without asking you.",
	],
	[/read|plan/, Eye, "Reads and plans; makes no edits and runs no commands."],
	[
		/accept|edit/,
		Pencil,
		"Edits files without asking; other actions wait for you.",
	],
	[
		/auto|review|dontask/,
		Shield,
		"Acts on its own within the agent's own checks.",
	],
	[/manual|default|ask/, Hand, "Every action beyond reading waits for you."],
];

const modeRow = (id: string) => {
	const key = id.toLowerCase().replace(/[^a-z]/g, "");
	return MODE_ICONS.find(([re]) => re.test(key));
};

export function modeIcon(id: string): LucideIcon {
	return modeRow(id)?.[1] ?? CircleDot;
}

/** A mode's one sentence when the agent describes it with none (#1101 category 6 item 4). */
export function modeLine(id: string): string | null {
	return modeRow(id)?.[2] ?? null;
}

/** A mode that runs every action unasked. */
export const modeIsDanger = (id: string) => modeRow(id)?.[1] === TriangleAlert;

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
