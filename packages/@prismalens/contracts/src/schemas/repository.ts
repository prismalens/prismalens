// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Repository schemas
 */
import { z } from "zod";
import { DateStringSchema } from "./common.js";

// =============================================================================
// REPOSITORY SCHEMAS
// =============================================================================

export const RepositorySourceKindSchema = z.enum(["folder", "url"]);

/** Which credential git uses for a repository (#673). Never holds a secret. */
export const RunCredentialSchema = z.object({
	source: z.enum(["connection", "machine", "none"]),
	/** The `Code:` text: "machine git (gh, sumit)", "token A", "public", "folder". */
	label: z.string(),
	/** The tooltip: the helper value, "ssh keys" or the template id, plus "fp <8 hex>" for a token. */
	via: z.string(),
	connectionId: z.string().optional(),
	fingerprint: z.string().optional(),
	/** The machine's credential was refused and the one matching saved token was used. */
	fallback: z.literal(true).optional(),
});
export type RunCredential = z.infer<typeof RunCredentialSchema>;

export const GitCredentialCandidateSchema = z.object({
	connectionId: z.string(),
	label: z.string(),
	fingerprint: z.string(),
});

/** A service row's credential: a run's, plus why the row cannot resolve by itself. */
export const GitCredentialDisplaySchema = RunCredentialSchema.extend({
	problem: z
		.object({
			code: z.enum([
				"ambiguous",
				"pinned-unusable",
				"probe-timeout",
				"legacy-link",
			]),
			message: z.string(),
			candidates: z.array(GitCredentialCandidateSchema).optional(),
		})
		.optional(),
});
export type GitCredentialDisplay = z.infer<typeof GitCredentialDisplaySchema>;

export const RepositorySchema = z.object({
	id: z.string().uuid(),
	/** Null for a folder or URL the operator typed; set when a VCS connection discovered it. */
	connectionId: z.string().uuid().nullable(),
	sourceKind: RepositorySourceKindSchema,
	fullName: z.string(),
	/** A git URL, or an absolute folder path when sourceKind is "folder". */
	url: z.string(),
	description: z.string().nullable(),
	language: z.string().nullable(),
	defaultBranch: z.string(),
	isPrivate: z.boolean(),
	metadata: z.record(z.string(), z.unknown()).nullable(),
	/** What the last save validated: branch and commit, or the git error verbatim (ADR 0004 §2). */
	syncBranch: z.string().nullable(),
	syncHead: z.string().nullable(),
	syncError: z.string().nullable(),
	syncedAt: DateStringSchema.nullable(),
	createdAt: DateStringSchema,
	updatedAt: DateStringSchema,
	/** The credential the next git call would use, worked out when the row is read (#673). */
	credential: GitCredentialDisplaySchema.optional(),
});

/** Relative to the repository root; the run joins it onto the snapshot, so it must stay inside. */
const SubPathSchema = z
	.string()
	.trim()
	.min(1)
	.refine(
		(p) => !/^([\\/]|[A-Za-z]:)/.test(p) && !p.split(/[\\/]/).includes(".."),
		"Sub-path must be relative and must not contain '..'",
	);

/** A service names its code as a local folder or a git URL; save validates it and links it as primary. */
export const AddRepositorySourceSchema = z.object({
	serviceId: z.string().uuid(),
	source: z.string().trim().min(1),
	subPath: SubPathSchema.optional(),
});

/** Pin a saved token to a repository, or null for Auto. */
export const SetRepositoryCredentialSchema = z.object({
	id: z.string().uuid(),
	connectionId: z.string().uuid().nullable(),
});

// =============================================================================
// SERVICE REPOSITORY JUNCTION SCHEMAS
// =============================================================================

export const ServiceRepositorySchema = z.object({
	id: z.string().uuid(),
	serviceId: z.string().uuid(),
	repositoryId: z.string().uuid(),
	subPath: z.string().nullable(),
	isPrimary: z.boolean(),
	createdAt: DateStringSchema,
});

export const LinkRepositorySchema = z.object({
	serviceId: z.string().uuid(),
	subPath: SubPathSchema.optional(),
	isPrimary: z.boolean().optional(),
});

export const RepositoryWithServicesSchema = RepositorySchema.extend({
	services: z.array(ServiceRepositorySchema).optional(),
});

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type Repository = z.infer<typeof RepositorySchema>;
export type RepositorySourceKind = z.infer<typeof RepositorySourceKindSchema>;
export type AddRepositorySourceInput = z.infer<
	typeof AddRepositorySourceSchema
>;
export type SetRepositoryCredentialInput = z.infer<
	typeof SetRepositoryCredentialSchema
>;
export type ServiceRepository = z.infer<typeof ServiceRepositorySchema>;
export type LinkRepositoryInput = z.infer<typeof LinkRepositorySchema>;
export type RepositoryWithServices = z.infer<
	typeof RepositoryWithServicesSchema
>;
