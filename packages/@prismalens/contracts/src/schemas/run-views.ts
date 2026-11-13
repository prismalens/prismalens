// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * What the run's panel reads beside a file (#973): one directory of a
 * recorded commit's tree, and the diff of a commit pair the run recorded when
 * it started. Both come out of git objects; a caller never names a commit
 * the run did not record.
 */
import { z } from "zod";
import { lazySchema } from "../lazy-schema.js";
import { CommitShaSchema, RepoPathSchema } from "./evidence-blob.js";

/** What an end of a comparison is, from what PrismaLens holds about it. */
export const ComparisonEndKindSchema = /* @__PURE__ */ lazySchema(() =>
	z.enum(["deployment", "tag", "merge", "commit"]),
);
export type ComparisonEndKind = z.infer<typeof ComparisonEndKindSchema>;

/** A commit pair recorded at run start; the diff endpoint takes its index, never shas. */
export const RunComparisonSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
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
	}),
);
export type RunComparison = z.infer<typeof RunComparisonSchema>;

export const RunTreeQuerySchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		id: z.string().uuid(),
		sha: CommitShaSchema,
		/** A directory from the repository's top; absent for the top itself. */
		prefix: RepoPathSchema.optional(),
		/** "true": every file under it at once, not one level. */
		recursive: z.enum(["true"]).optional(),
	}),
);
export type RunTreeQuery = z.infer<typeof RunTreeQuerySchema>;

/** Above this many entries a directory is cut and says so. */
export const RUN_TREE_MAX_ENTRIES = 2000;
/** A recursive listing stops here and says so. */
export const RUN_TREE_MAX_FILES = 20_000;

export const RunTreeEntrySchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		name: z.string(),
		path: z.string(),
		type: z.enum(["file", "dir", "symlink", "submodule"]),
	}),
);
export type RunTreeEntry = z.infer<typeof RunTreeEntrySchema>;

export const RUN_VIEW_UNAVAILABLE = [
	"source-removed",
	"commit-gone",
	"not-a-dir",
] as const;

export const RunTreeSchema = /* @__PURE__ */ lazySchema(() =>
	z.discriminatedUnion("state", [
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
	]),
);
export type RunTree = z.infer<typeof RunTreeSchema>;

export const RunDiffQuerySchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		id: z.string().uuid(),
		/** Index into the run's recorded `workspace.compare`. */
		pair: z.coerce.number().int().nonnegative(),
		path: RepoPathSchema.optional(),
	}),
);
export type RunDiffQuery = z.infer<typeof RunDiffQuerySchema>;

/** Above this a patch is summarised, not sent. */
export const RUN_DIFF_MAX_BYTES = 2 * 1024 * 1024;

export const RunDiffFileSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		path: z.string(),
		/** The path before a rename; null otherwise. */
		oldPath: z.string().nullable(),
		/** null for a binary file, which has no line counts. */
		additions: z.number().int().nonnegative().nullable(),
		deletions: z.number().int().nonnegative().nullable(),
	}),
);
export type RunDiffFile = z.infer<typeof RunDiffFileSchema>;

export const RunDiffSchema = /* @__PURE__ */ lazySchema(() =>
	z.discriminatedUnion("state", [
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
	]),
);
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

/** Which diff a thread's Changes tab shows (#1101 category 16). */
export const DiffScopeSchema = /* @__PURE__ */ lazySchema(() =>
	z.enum(["all", "turn", "uncommitted", "outside"]),
);
export type DiffScope = z.infer<typeof DiffScopeSchema>;

export const WorktreeChangesQuerySchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		id: z.string().uuid(),
		/** Absent: the run's workspace against the commit it started at, read from disk (#1020). */
		scope: DiffScopeSchema.optional(),
		/** `scope=turn`: the turn's first event seq. */
		turn: z
			.string()
			.regex(/^\d{1,9}$/)
			.optional(),
		/** `none`: files and counts only; each file's patch comes from `getChangesPatch` (#1101 cat 16). */
		patch: z.enum(["none"]).optional(),
	}),
);
export type WorktreeChangesQuery = z.infer<typeof WorktreeChangesQuerySchema>;

/** Untracked files past this many are neither listed nor counted in the totals. */
export const WORKTREE_MAX_FILES = 1000;
/** An untracked file over this many bytes is listed without its lines. */
export const WORKTREE_FILE_MAX_BYTES = 512 * 1024;

/**
 * One change in a run's live worktree (#1020): `link` is a symlink, junction or a
 * path that leaves the workspace, and `submodule` a nested repository; neither is read.
 */
export const WorktreeFileSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		path: z.string(),
		status: z.enum(["added", "modified", "deleted", "submodule", "link"]),
		/** null for a binary, a too-large, a link or a submodule entry. */
		additions: z.number().int().nonnegative().nullable(),
		deletions: z.number().int().nonnegative().nullable(),
	}),
);
export type WorktreeFile = z.infer<typeof WorktreeFileSchema>;

/** Why this diff cannot be reverted from here; absent when it can. */
export const RevertBlockSchema = /* @__PURE__ */ lazySchema(() =>
	z.enum([
		/** The thread works in the user's own checkout or a plain folder. */
		"borrowed",
		"folder",
		/** The agent is working; stop it first. */
		"running",
		/** This device was paired to view and answer. */
		"view-only",
	]),
);
export type RevertBlock = z.infer<typeof RevertBlockSchema>;

export const ScopedDiffSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		scope: DiffScopeSchema,
		from: CommitShaSchema,
		to: CommitShaSchema,
		/** `turn`: the turn's first seq; null for the other scopes. */
		turn: z.number().int().nonnegative().nullable(),
		/** `turn`: the turn is still running, so `to` is the files now. */
		live: z.boolean(),
		/** Each shown file's `mode blob` at `to` (or `absent`): what a revert checks it still is. Empty with `patch=none`. */
		states: z.record(z.string(), z.string()),
		/** Paths that changed outside the agent's turns: between them or after the last. */
		outside: z.array(z.string()),
		/** Paths the snapshot left out: a link, a special or hard-linked file, or too large. */
		skipped: z.array(z.string()),
		/** Turns with a snapshot, oldest first. */
		turns: z.array(
			z.object({ seq: z.number().int().nonnegative(), ended: z.boolean() }),
		),
		revert: RevertBlockSchema.nullable(),
		/** Reverts cut off mid-write; Undo of each restores the files before it. */
		interrupted: z.array(z.string()),
	}),
);
export type ScopedDiff = z.infer<typeof ScopedDiffSchema>;

export const WorktreeRepoChangesSchema = /* @__PURE__ */ lazySchema(() =>
	z.discriminatedUnion("state", [
		z.object({
			state: z.literal("ok"),
			repo: z.string(),
			/** The commit the server recorded when it made the workspace. */
			base: CommitShaSchema,
			branch: z.string().nullable(),
			files: z.array(WorktreeFileSchema),
			additions: z.number().int().nonnegative(),
			deletions: z.number().int().nonnegative(),
			/** The unified patch; null when `omitted` says why. */
			patch: z.string().nullable(),
			/** `per-file`: asked with `patch=none`; read each file's with `getChangesPatch`. */
			omitted: z.enum(["too-large", "per-file"]).nullable(),
			/** More untracked files than WORKTREE_MAX_FILES. */
			truncated: z.boolean(),
			/** Set when a scope was asked for: what the diff compares (#1101 category 16). */
			scoped: ScopedDiffSchema.optional(),
			/** Commits HEAD is ahead of and behind its upstream; null with no upstream. */
			sync: z
				.object({
					ahead: z.number().int().nonnegative(),
					behind: z.number().int().nonnegative(),
				})
				.nullable()
				.optional(),
		}),
		z.object({
			state: z.literal("unavailable"),
			repo: z.string(),
			reason: z.enum([
				"removed",
				"not-a-workspace",
				"commit-gone",
				/** The scope needs a turn snapshot this run does not have. */
				"no-snapshot",
				/** More linked or special files than a snapshot takes. */
				"too-many-links",
			]),
		}),
	]),
);
export type WorktreeRepoChanges = z.infer<typeof WorktreeRepoChangesSchema>;

/** The run's workspace against the commit it started at; no repos when it recorded no code. */
export const WorktreeChangesSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		repos: z.array(WorktreeRepoChangesSchema),
	}),
);
export type WorktreeChanges = z.infer<typeof WorktreeChangesSchema>;

/** One file's text at a commit the Changes tab showed, for context and the file view. */
export const WorktreeFileQuerySchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		id: z.string().uuid(),
		repo: z.string().min(1),
		commit: CommitShaSchema,
		path: RepoPathSchema,
	}),
);
export type WorktreeFileQuery = z.infer<typeof WorktreeFileQuerySchema>;

export const WorktreeFileContentSchema = /* @__PURE__ */ lazySchema(() =>
	z.discriminatedUnion("state", [
		z.object({ state: z.literal("ok"), contents: z.string() }),
		z.object({
			state: z.literal("unavailable"),
			reason: z.enum(["absent", "binary", "too-large", "no-workspace"]),
		}),
	]),
);
export type WorktreeFileContent = z.infer<typeof WorktreeFileContentSchema>;

/** One file's patch between two commits a scoped diff named (#1101 category 16 item 7). */
export const WorktreePatchQuerySchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		id: z.string().uuid(),
		repo: z.string().min(1),
		from: CommitShaSchema,
		to: CommitShaSchema,
		path: RepoPathSchema,
	}),
);
export type WorktreePatchQuery = z.infer<typeof WorktreePatchQuerySchema>;

export const WorktreePatchSchema = /* @__PURE__ */ lazySchema(() =>
	z.discriminatedUnion("state", [
		z.object({
			state: z.literal("ok"),
			patch: z.string(),
			/** The file's `mode blob` at `to` (or `absent`): what a revert of it expects. */
			at: z.string(),
		}),
		z.object({
			state: z.literal("unavailable"),
			reason: z.enum(["too-large", "no-workspace"]),
		}),
	]),
);
export type WorktreePatch = z.infer<typeof WorktreePatchSchema>;

/** What one revert undoes (#1101 category 16). */
export const RevertTargetSchema = /* @__PURE__ */ lazySchema(() =>
	z.discriminatedUnion("kind", [
		z.object({ kind: z.literal("file"), path: RepoPathSchema }),
		z.object({
			kind: z.literal("hunk"),
			path: RepoPathSchema,
			/** The hunk's header line as shown, `@@ -a,b +c,d @@`. */
			header: z.string().min(1).max(400),
		}),
		z.object({ kind: z.literal("turn"), seq: z.number().int().nonnegative() }),
		z.object({
			kind: z.literal("undo"),
			revertId: z.string().regex(/^\d{1,15}$/),
		}),
	]),
);
export type RevertTarget = z.infer<typeof RevertTargetSchema>;

export const RevertChangesInputSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		id: z.string().uuid(),
		repo: z.string().min(1),
		/** The diff the user looked at; the server resolves its ends again and refuses on a mismatch. */
		scope: DiffScopeSchema,
		turn: z.number().int().nonnegative().optional(),
		from: CommitShaSchema,
		target: RevertTargetSchema,
		/** Each target path's `mode blob` (or `absent`) as shown; a revert refuses when one differs. */
		expect: z.record(RepoPathSchema, z.string().max(200)),
	}),
);
export type RevertChangesInput = z.infer<typeof RevertChangesInputSchema>;

export const RevertChangesResultSchema = /* @__PURE__ */ lazySchema(() =>
	z.discriminatedUnion("state", [
		z.object({
			state: z.literal("done"),
			/** Undo it with `{kind: "undo", revertId}`. */
			revertId: z.string(),
			paths: z.array(z.string()),
		}),
		z.object({
			state: z.literal("refused"),
			reason: z.enum([
				/** A file changed since the diff was shown. */
				"stale",
				/** The reverse patch no longer applies: the user changed those lines since. */
				"conflict",
				"blocked",
				"no-snapshot",
				"linked",
				/** A binary, added, deleted or mode-changed file: revert the whole file. */
				"not-a-hunk",
				"unavailable",
			]),
			paths: z.array(z.string()),
			block: RevertBlockSchema.nullable(),
		}),
	]),
);
export type RevertChangesResult = z.infer<typeof RevertChangesResultSchema>;
