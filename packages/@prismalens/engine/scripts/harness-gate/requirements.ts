// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * What a harness transport must deliver before prismalens drives a harness through it.
 * MUST rows decide admission; a WANT row becomes MUST only when a milestone schedules
 * the screen that needs it. Rows without a probe are listed so the gap stays visible.
 */
export type Tier = "must" | "want";

export interface Requirement {
	id: string;
	title: string;
	tier: Tier;
	probed: boolean;
}

export const REQUIREMENTS: readonly Requirement[] = [
	{ id: "R1", title: "Runs in the given cwd", tier: "must", probed: true },
	{
		id: "R2",
		title: "File write raises a permission request and does not land",
		tier: "must",
		probed: true,
	},
	{
		id: "R3",
		title:
			"Mutating shell command raises a permission request and does not land",
		tier: "must",
		probed: true,
	},
	{
		id: "R4",
		title: "Repo-supplied agent config (hooks, .mcp.json) stays inert",
		tier: "must",
		probed: true,
	},
	{ id: "R5", title: "Stream ends on its own", tier: "must", probed: true },
	{
		id: "R6",
		title: "Interrupt stops the turn within 10 s",
		tier: "must",
		probed: true,
	},
	{
		id: "R7",
		title: "Served model equals the requested model",
		tier: "must",
		probed: false,
	},
	{
		id: "R12",
		title: "Tool calls pair start to result with input and content",
		tier: "must",
		probed: true,
	},
	{
		id: "R13",
		title: "Liveness is content: first event within 15 s, no silence over 30 s",
		tier: "must",
		probed: true,
	},
	{
		id: "R14",
		title: "Follow-up in the same session keeps context",
		tier: "must",
		probed: true,
	},
	{
		id: "R15",
		title: "Final message arrives complete",
		tier: "must",
		probed: true,
	},
	{
		id: "R16",
		title: "Failures arrive as errors within 30 s, not hangs",
		tier: "must",
		probed: true,
	},
	{
		id: "R18",
		title: "MCP server injected by prismalens is called and named in events",
		tier: "must",
		probed: true,
	},
	{
		id: "R8",
		title: "Resume after the client process dies",
		tier: "want",
		probed: false,
	},
	{
		id: "R9",
		title: "Steer mid-turn, landing at the next tool boundary",
		tier: "want",
		probed: false,
	},
	{
		id: "R10",
		title: "Sub-agent events carry a parent id",
		tier: "want",
		probed: false,
	},
	{
		id: "R11",
		title: "Structured tool output arrives unflattened",
		tier: "want",
		probed: false,
	},
	{
		id: "R17",
		title: "A prompt queued during a turn runs after it",
		tier: "want",
		probed: false,
	},
	{
		id: "R19",
		title: "A permission request can wait 120 s for a human",
		tier: "want",
		probed: false,
	},
];

/** Never a reason to pick a transport: the product ruled these out. */
export const EXCLUDED: readonly string[] = [
	"Fork and rewind (UX study patterns.md implication 10)",
	"Hook exposure and manual compaction (no screen uses them)",
	"Numeric confidence and per-call cost (wave-5 verdict rulings)",
];
