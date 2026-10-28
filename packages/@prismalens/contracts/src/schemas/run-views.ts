// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * What the run's panel reads beside a file (#973): one directory of a
 * recorded commit's tree, and the diff of a commit pair the run recorded when
 * it started. Both come out of git objects; a caller never names a commit
 * the run did not record.
 */
import { z } from "zod";
import { CommitShaSchema, RepoPathSchema } from "./evidence-blob.js";

/** What an end of a comparison is, from what PrismaLens holds about it. */
export const ComparisonEndKindSchema = z.enum([
	"deployment",
	"tag",
	"merge",
	"commit",
]);
export type ComparisonEndKind = z.infer<typeof ComparisonEndKindSchema>;

/** A commit pair recorded at run start; the diff endpoint takes its index, never shas. */
export const RunComparisonSchema = z.object({
	/** The workspace repo's `name`. */
	repo: z.string(),
	head: CommitShaSchema,
	headKind: ComparisonEndKindSchema,
	/** A deployment's version or a tag's name; null for a plain commit. */
	headName: z.string().nullable(),
	base: CommitShaSchema,
	baseKind: ComparisonEndKindSchema,
	baseName: z.string().nullable(),
	/** Commits in base..head; 1 means the base is the head's parent. */
	between: z.number().int().positive(),
});
export type RunComparison = z.infer<typeof RunComparisonSchema>;

export const RunTreeQuerySchema = z.object({
	id: z.string().uuid(),
	sha: CommitShaSchema,
	/** A directory from the repository's top; absent for the top itself. */
	prefix: RepoPathSchema.optional(),
	/** "true": every file under it at once, not one level. */
	recursive: z.enum(["true"]).optional(),
});
export type RunTreeQuery = z.infer<typeof RunTreeQuerySchema>;

/** Above this many entries a directory is cut and says so. */
export const RUN_TREE_MAX_ENTRIES = 2000;
/** A recursive listing stops here and says so. */
export const RUN_TREE_MAX_FILES = 20_000;

export const RunTreeEntrySchema = z.object({
	name: z.string(),
	path: z.string(),
	type: z.enum(["file", "dir", "symlink", "submodule"]),
});
export type RunTreeEntry = z.infer<typeof RunTreeEntrySchema>;

export const RUN_VIEW_UNAVAILABLE = [
	"source-removed",
	"commit-gone",
	"not-a-dir",
] as const;

export const RunTreeSchema = z.discriminatedUnion("state", [
	z.object({
		state: z.literal("ok"),
		repo: z.string(),
		sha: CommitShaSchema,
		prefix: z.string().nullable(),
		entries: z.array(RunTreeEntrySchema),
		truncated: z.boolean(),
	}),
	z.object({
		state: z.literal("unavailable"),
		repo: z.string(),
		sha: CommitShaSchema,
		prefix: z.string().nullable(),
		reason: z.enum(RUN_VIEW_UNAVAILABLE),
	}),
]);
export type RunTree = z.infer<typeof RunTreeSchema>;

export const RunDiffQuerySchema = z.object({
	id: z.string().uuid(),
	/** Index into the run's recorded `workspace.compare`. */
	pair: z.coerce.number().int().nonnegative(),
	path: RepoPathSchema.optional(),
});
export type RunDiffQuery = z.infer<typeof RunDiffQuerySchema>;

/** Above this a patch is summarised, not sent. */
export const RUN_DIFF_MAX_BYTES = 2 * 1024 * 1024;

export const RunDiffFileSchema = z.object({
	path: z.string(),
	/** The path before a rename; null otherwise. */
	oldPath: z.string().nullable(),
	/** null for a binary file, which has no line counts. */
	additions: z.number().int().nonnegative().nullable(),
	deletions: z.number().int().nonnegative().nullable(),
});
export type RunDiffFile = z.infer<typeof RunDiffFileSchema>;

export const RunDiffSchema = z.discriminatedUnion("state", [
	z.object({
		state: z.literal("ok"),
		comparison: RunComparisonSchema,
		files: z.array(RunDiffFileSchema),
		/** The unified patch; null when `omitted` says why. */
		patch: z.string().nullable(),
		omitted: z.enum(["too-large"]).nullable(),
	}),
	z.object({
		state: z.literal("unavailable"),
		comparison: RunComparisonSchema,
		reason: z.enum(["source-removed", "commit-gone"]),
	}),
]);
export type RunDiff = z.infer<typeof RunDiffSchema>;

function end(kind: ComparisonEndKind, name: string | null, sha: string) {
	const short = sha.slice(0, 7);
	if (kind === "deployment") return `Deployment ${name ?? short}`;
	if (kind === "tag") return `Tag ${name ?? short}`;
	if (kind === "merge") return `Merge ${name ?? short}`;
	return `Commit ${short}`;
}

/**
 * The pair named for what each end is, never more: a tag is not called a
 * deploy, and "its parent" only when the base is the head's parent.
 */
export function comparisonLabel(c: RunComparison): string {
	const head = end(c.headKind, c.headName, c.head);
	if (c.between === 1 && c.baseKind !== "deployment" && c.baseKind !== "tag")
		return `${head} against its parent`;
	const base = end(c.baseKind, c.baseName, c.base);
	const n = c.between === 1 ? "1 commit" : `${c.between} commits`;
	return `${head} against ${base.charAt(0).toLowerCase()}${base.slice(1)}, ${n}`;
}
