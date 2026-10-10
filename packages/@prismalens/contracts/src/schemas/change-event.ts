// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Change Event schema — matches DB model (ChangeEvent table)
 * Tracks deployments, config changes, commits, and rollbacks
 * that may correlate with incidents.
 */
import { z } from "zod";
import {
	ChangeEventTypeSchema,
	DateStringSchema,
	QueryBooleanSchema,
} from "./common.js";
import { RunCredentialSchema } from "./repository.js";

export const ChangeEventSchema = z.object({
	id: z.string().uuid(),
	type: ChangeEventTypeSchema,
	source: z.string(),
	timestamp: DateStringSchema,
	serviceId: z.string().uuid().nullable(),
	description: z.string().nullable(),
	metadata: z.record(z.string(), z.unknown()).nullable(),
	createdAt: DateStringSchema,
});

export type ChangeEvent = z.infer<typeof ChangeEventSchema>;

// =============================================================================
// WHAT CHANGED (incident overview, #811)
// =============================================================================

/** A ChangeEvent's type, with a git commit split into the release, merge or plain commit it is. */
export const IncidentChangeKindSchema = z.enum([
	"deployment",
	"rollback",
	"config",
	"migration",
	"release",
	"merge",
	"commit",
]);

export const IncidentChangeSchema = z.object({
	id: z.string().uuid(),
	kind: IncidentChangeKindSchema,
	/** When it landed on the default branch (committer date), or when the deploy happened. */
	at: DateStringSchema,
	/** The pull or merge request title for a merge, else the commit subject. */
	title: z.string(),
	sha: z.string().nullable(),
	/** A tag on the commit, e.g. "v1.42". */
	tag: z.string().nullable(),
	/** The pull or merge request number named in the commit. */
	pr: z.number().int().nullable(),
	author: z.string().nullable(),
	/** Files the change touched: the count and the first three paths. */
	files: z
		.object({ count: z.number().int(), paths: z.array(z.string()) })
		.nullable(),
	/** The commit on the host's web UI; null for a folder or an ssh host with a port. */
	url: z.string().nullable(),
	/** "owner/repo", or the folder name. */
	repo: z.string().nullable(),
	service: z.object({ id: z.string(), name: z.string() }).nullable(),
	/** Where the event came from: "git", or another source that wrote it. */
	source: z.string(),
});
export type IncidentChange = z.infer<typeof IncidentChangeSchema>;

/** Why one linked repository could not be read; each maps to one thing the user can do. */
export const ChangeSourceProblemCodeSchema = z.enum([
	"no-credential",
	"credential-rejected",
	"no-access",
	"pick-credential",
	"rate-limited",
	"unreachable",
	"ssh",
	"error",
]);
export type ChangeSourceProblemCode = z.infer<
	typeof ChangeSourceProblemCodeSchema
>;

/** One linked repository of the incident's services, and how its last read went. */
export const ChangeSourceSchema = z.object({
	repositoryId: z.string().uuid(),
	repo: z.string(),
	serviceId: z.string(),
	serviceName: z.string(),
	/** "pending" until its first read finishes. */
	status: z.enum(["ok", "failed", "pending"]),
	/** Who git read it as; null until read, or when the credential could not be worked out. */
	credential: RunCredentialSchema.nullable(),
	problem: z
		.object({
			code: ChangeSourceProblemCodeSchema,
			message: z.string(),
			action: z
				.enum(["add-credential", "pick-credential", "replace-token"])
				.nullable(),
		})
		.nullable(),
	checkedAt: DateStringSchema.nullable(),
});
export type ChangeSource = z.infer<typeof ChangeSourceSchema>;

export const IncidentChangesQuerySchema = z.object({
	id: z.string().uuid(),
	/** Timeline rows to return, newest first; `total` counts them all. */
	limit: z.coerce.number().int().min(1).max(200).default(6),
	/** Read the git host now instead of within the last five minutes (Try again). */
	refresh: QueryBooleanSchema.optional(),
});
export type IncidentChangesQuery = z.infer<typeof IncidentChangesQuerySchema>;

export const IncidentChangesSchema = z.object({
	incidentId: z.string().uuid(),
	/** The incident's start: `deploy` is the newest change at or before it. */
	startedAt: DateStringSchema,
	window: z.object({ start: DateStringSchema, end: DateStringSchema }),
	/** Newest deploy, release or merge at or before the start; else the newest commit; null when none. */
	deploy: IncidentChangeSchema.nullable(),
	timeline: z.array(IncidentChangeSchema),
	total: z.number().int(),
	/**
	 * ok: every source read. partial: some failed. failed: all failed. pending: none read yet.
	 * no-repos: no service of the incident links a repository.
	 */
	state: z.enum(["ok", "partial", "failed", "pending", "no-repos"]),
	/** A read of the git host is still running; ask again shortly. */
	refreshing: z.boolean(),
	sources: z.array(ChangeSourceSchema),
});
export type IncidentChanges = z.infer<typeof IncidentChangesSchema>;
