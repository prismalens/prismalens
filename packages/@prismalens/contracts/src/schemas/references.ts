// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * One reference search behind `/`, `@`, `#` and Ctrl K (#1024): `/` to do,
 * `@` to mention anything, `#` to find work items by number, key or title.
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
 * anything, monitoring items included; `#` finds work items by number, key or title.
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
			"alert",
			"silence",
			"alert_rule",
		],
		"#": ["thread", "incident", "pull_request", "issue"],
	};

/** `#123`, `!123` (a merge request) or a bare `123` after the trigger; null when the query is words. */
export function referenceNumber(
	q: string,
): { n: number; mergeRequest: boolean } | null {
	const m = /^([#!]?)(\d{1,9})$/.exec(q.trim());
	return m ? { n: Number(m[2]), mergeRequest: m[1] === "!" } : null;
}

/** A tracker key such as `PROJ-123` (with or without `#`); null otherwise. */
export function referenceKey(q: string): string | null {
	const m = /^#?([A-Z][A-Z0-9_]{1,19}-\d{1,9})$/.exec(q.trim());
	return m ? (m[1] as string) : null;
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
	/** The menu group: a source such as "GitHub · org/repo", or PrismaLens. */
	group: z.string().max(120).optional(),
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
	/** A source that could not answer: one line each, e.g. "GitLab: no token for gitlab.example.com". */
	unavailable: z.array(
		z.object({ source: z.string().max(120), message: z.string().max(300) }),
	),
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
