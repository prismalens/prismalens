// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A file the agent read, served read-only at the commit its run recorded:
 * a tracked blob out of the run's source, never a workspace (proposal item 2).
 */
import { z } from "zod";

/** A full object id; an abbreviation or a ref name never reaches git. */
export const CommitShaSchema = z
	.string()
	.regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/, "A full lowercase commit sha");

/**
 * A path from the repository's top: forward slashes, no `.`/`..`/empty
 * segment, nothing absolute, no control character. Git resolves it inside
 * the commit's tree, so this is the first of two fences, not the only one.
 */
export function isSafeRepoPath(path: string): boolean {
	if (path.length === 0 || path.length > 1024) return false;
	// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this refuses.
	if (/[\u0000-\u001f\u007f\\]/.test(path)) return false;
	if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) return false;
	return path
		.split("/")
		.every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

export const RepoPathSchema = z
	.string()
	.refine(isSafeRepoPath, "A path inside the repository, from its top");

export const EvidenceBlobQuerySchema = z.object({
	id: z.string().uuid(),
	sha: CommitShaSchema,
	path: RepoPathSchema,
});
export type EvidenceBlobQuery = z.infer<typeof EvidenceBlobQuerySchema>;

/** Why a cited file cannot be shown; each has its own sentence in the view. */
export const EVIDENCE_UNAVAILABLE = [
	"source-removed",
	"commit-gone",
	"not-retained",
	"not-a-file",
] as const;
export type EvidenceUnavailable = (typeof EVIDENCE_UNAVAILABLE)[number];

/** Above this a blob is named, not sent. */
export const EVIDENCE_BLOB_MAX_BYTES = 1024 * 1024;

/** A git blob id: never changes for the same bytes, so it keys the viewer's cache. */
export const BlobOidSchema = z
	.string()
	.regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/, "A full lowercase blob id");

export const EvidenceBlobSchema = z.discriminatedUnion("state", [
	z.object({
		state: z.literal("ok"),
		repo: z.string(),
		sha: CommitShaSchema,
		path: z.string(),
		/** A symlink's content is its target, shown as text and never followed. */
		kind: z.enum(["file", "symlink"]),
		size: z.number().int().nonnegative(),
		oid: BlobOidSchema,
		/** Null when `omitted` says why; text that is not UTF-8 is `binary` (never decoded). */
		content: z.string().nullable(),
		omitted: z.enum(["binary", "too-large"]).nullable(),
	}),
	z.object({
		state: z.literal("unavailable"),
		repo: z.string(),
		sha: CommitShaSchema,
		path: z.string(),
		reason: z.enum(EVIDENCE_UNAVAILABLE),
	}),
]);
export type EvidenceBlob = z.infer<typeof EvidenceBlobSchema>;
