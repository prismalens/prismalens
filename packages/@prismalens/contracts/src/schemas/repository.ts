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

const RunCredentialSourceSchema = z.enum([
	"connection",
	"env",
	"machine",
	"none",
]);

/** Which credential git uses for a repository (#673): pin, stored token, env token, the machine's git, public (#848). Never holds a secret. */
export const RunCredentialSchema = z.object({
	source: RunCredentialSourceSchema,
	/** The `Code:` text: "machine git (gh, sumit)", "token A", "env GH_TOKEN", "public", "folder". */
	label: z.string(),
	/** The tooltip: the helper value, "ssh keys", the template id or the variable, plus "fp <8 hex>" for a token. */
	via: z.string(),
	connectionId: z.string().optional(),
	fingerprint: z.string().optional(),
	/** The environment variable an `env` credential came from. */
	envVar: z.string().optional(),
	/** Runs before #848 only: the machine's credential was refused and the one matching saved token was used. */
	fallback: z.literal(true).optional(),
	/** An unpinned credential got this refusal, so the next one in the order was used (#848). */
	fallbackFrom: z
		.object({
			source: RunCredentialSourceSchema,
			label: z.string(),
			code: z.string(),
		})
		.optional(),
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
	/** Where the project sits below its repository's top folder; null at the top. */
	subPath: z.string().nullable(),
	/** A folder with no git: threads you start run in it, nothing unattended does (#1020). */
	plain: z.boolean(),
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
	/** `GET /repositories/{id}/icon` when a logo was found; absent means the monogram (#1024 E). */
	iconUrl: z.string().optional(),
});

/** What a project is (#1020): a plain folder, a git repo on this computer, or a git URL. */
export const PROJECT_KINDS = ["folder", "repo", "remote"] as const;
export const ProjectKindSchema = z.enum(PROJECT_KINDS);
export type ProjectKind = z.infer<typeof ProjectKindSchema>;

export function projectKindOf(repo: {
	sourceKind: string;
	plain: boolean;
}): ProjectKind {
	if (repo.sourceKind !== "folder") return "remote";
	return repo.plain ? "folder" : "repo";
}

/** Folder listing for the Add project browser (#1020): folders only, never file names. */
export const FOLDER_LIST_MAX = 500;
export const FOLDER_READ_MS = 3000;

export const BrowseFoldersSchema = z.object({
	/** An absolute folder; null lists the host's home. */
	path: z.string().trim().min(1).max(4096).nullable(),
});

export const FolderEntrySchema = z.object({
	name: z.string(),
	path: z.string(),
	hidden: z.boolean(),
	/** Holds a `.git`, so it adds as a Repo. */
	git: z.boolean(),
});
export type FolderEntry = z.infer<typeof FolderEntrySchema>;

export const FOLDER_ERRORS = [
	"denied",
	"missing",
	"timeout",
	"not-folder",
	"not-absolute",
	"link",
	"busy",
] as const;

export const BrowseFoldersResultSchema = z.discriminatedUnion("ok", [
	z.object({
		ok: z.literal(true),
		path: z.string(),
		parent: z.string().nullable(),
		git: z.boolean(),
		entries: z.array(FolderEntrySchema),
		/** More folders than FOLDER_LIST_MAX, or the read ran out of time part way. */
		truncated: z.boolean(),
	}),
	z.object({
		ok: z.literal(false),
		path: z.string(),
		error: z.enum(FOLDER_ERRORS),
	}),
]);
export type BrowseFoldersResult = z.infer<typeof BrowseFoldersResultSchema>;

/** Relative to the repository root; the run joins it onto the snapshot, so it must stay inside. */
const SubPathSchema = z
	.string()
	.trim()
	.min(1)
	.refine(
		(p) => !/^([\\/]|[A-Za-z]:)/.test(p) && !p.split(/[\\/]/).includes(".."),
		"Sub-path must be relative and must not contain '..'",
	);

/**
 * A folder or git URL; save validates it. With a service it becomes that service's primary
 * repo; without one it is a project on its own (#1020).
 */
export const AddRepositorySourceSchema = z.object({
	serviceId: z.string().uuid().optional(),
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
