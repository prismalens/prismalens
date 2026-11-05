// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * One reference search behind `/`, `@`, `#` and Ctrl K (#1024): `/` to do,
 * `@` to mention anything, `#N` to jump by number.
 */
import { z } from "zod";
import {
	ComposerScopeSchema,
	type ReferenceKind,
	ReferenceRefSchema,
} from "./composer.js";

export const REFERENCE_TRIGGERS = ["/", "@", "#"] as const;
export const ReferenceTriggerSchema = z.enum(REFERENCE_TRIGGERS);
export type ReferenceTrigger = z.infer<typeof ReferenceTriggerSchema>;

/**
 * The kinds each trigger searches; no trigger searches them all. `@` mentions
 * anything; `#` is the number shortcut, words after it search these kinds only.
 */
export const TRIGGER_KINDS: Record<ReferenceTrigger, readonly ReferenceKind[]> =
	{
		"/": ["command"],
		"@": [
			"file",
			"folder",
			"thread",
			"incident",
			"service",
			"project",
			"schedule",
			"attachment",
			"artifact",
			"runbook",
			"pull_request",
		],
		"#": ["thread", "incident", "pull_request"],
	};

/** `#123`: a bare number after `#` matches records by number, not by text. */
export function referenceNumber(q: string): number | null {
	const m = /^#?(\d{1,9})$/.exec(q.trim());
	return m ? Number(m[1]) : null;
}

/** Why a hit ranks where it does, strongest boost first. */
export const REFERENCE_WHYS = ["used", "agent", "open", "match"] as const;
export const ReferenceWhySchema = z.enum(REFERENCE_WHYS);
export type ReferenceWhy = z.infer<typeof ReferenceWhySchema>;

export const ReferenceHitSchema = z.object({
	ref: ReferenceRefSchema,
	/** A second line: a path's folder, a thread's state, a command's description. */
	detail: z.string().max(300).optional(),
	/** Commands only: a PrismaLens action, or one the agent advertised. */
	source: z.enum(["app", "agent"]).optional(),
	/** A state tone the row may carry (surface D). */
	tone: z.string().max(40).optional(),
	why: ReferenceWhySchema,
	score: z.number(),
});
export type ReferenceHit = z.infer<typeof ReferenceHitSchema>;

export const ReferenceSearchInputSchema = z.object({
	q: z.string().max(200).default(""),
	trigger: ReferenceTriggerSchema.optional(),
	threadId: z.string().uuid().optional(),
	/** A new thread's scope, for the project's folder before a run exists. */
	scope: ComposerScopeSchema.optional(),
	/** What the panel has open, so it ranks first (`why: open`). */
	open: z.string().max(1024).optional(),
	limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ReferenceSearchInput = z.infer<typeof ReferenceSearchInputSchema>;

export const ReferenceSearchResultSchema = z.object({
	hits: z.array(ReferenceHitSchema),
	/** The file list was cut at the cap. */
	truncated: z.boolean(),
});
export type ReferenceSearchResult = z.infer<typeof ReferenceSearchResultSchema>;

/** Record that the user picked a hit, for frecency (`why: used`). */
export const ReferenceUseSchema = z.object({
	kind: ReferenceRefSchema.shape.kind,
	id: ReferenceRefSchema.shape.id,
});

export const REFERENCE_SNAPSHOT_MAX_CHARS = 4000;
export const REFERENCE_SNAPSHOTS_MAX_CHARS = 20000;

/** A reference resolved at send time into what the agent receives. */
export const ReferenceSnapshotSchema = z.object({
	ref: ReferenceRefSchema,
	text: z.string().max(REFERENCE_SNAPSHOT_MAX_CHARS),
	/** The record is outside the run's scope: only this snapshot goes, no read tool. */
	outOfScope: z.boolean(),
	/** The tool the run may call for more, when its tool view serves the record. */
	readTool: z.string().max(100).optional(),
});
export type ReferenceSnapshot = z.infer<typeof ReferenceSnapshotSchema>;

/** One agent command, validated from `available_commands_update`. */
export const AgentCommandSchema = z.object({
	name: z.string().min(1).max(64),
	description: z.string().max(200),
	inputHint: z.string().max(200).optional(),
});
export type AgentCommand = z.infer<typeof AgentCommandSchema>;
export const MAX_AGENT_COMMANDS = 200;
export const AgentCommandsSchema = z
	.array(AgentCommandSchema)
	.max(MAX_AGENT_COMMANDS);
