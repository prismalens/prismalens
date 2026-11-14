// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { z } from "zod";
import { lazySchema } from "../lazy-schema.js";

/** The git states a thread's worktree can be stuck in (#1101 bar 15.1): a closed set. */
export const GIT_STATES = ["conflict", "rewritten", "gone", "moved"] as const;
export type GitStateKind = (typeof GIT_STATES)[number];

export const GIT_CONFLICT_FILES_MAX = 20;

/**
 * What git shows in a thread's own worktree, read live, and what its remote holds, read
 * without a fetch: unmerged files, or a branch rewritten, deleted or moved on the remote.
 */
export const GitStateSchema = /* @__PURE__ */ lazySchema(() =>
	z.discriminatedUnion("state", [
		z.object({
			state: z.literal("conflict"),
			/** The operation git stopped in; null when only unmerged entries tell. */
			op: z.enum(["merge", "rebase", "cherry-pick", "revert"]).nullable(),
			files: z.array(z.string().max(1000)).max(GIT_CONFLICT_FILES_MAX),
			count: z.number().int().nonnegative(),
		}),
		z.object({
			state: z.literal("rewritten"),
			branch: z.string().max(300),
			/** The remote-tracking ref the branch was compared with, e.g. `origin/fix`. */
			remote: z.string().max(400),
			/** Commits only here, and only on the remote copy; null when only the host's force-push record tells. */
			ahead: z.number().int().nonnegative().nullable(),
			behind: z.number().int().nonnegative().nullable(),
		}),
		z.object({
			state: z.literal("gone"),
			branch: z.string().max(300),
			/** The upstream the branch tracked, e.g. `origin/fix`. */
			upstream: z.string().max(400),
		}),
		z.object({
			state: z.literal("moved"),
			branch: z.string().max(300),
			remote: z.string().max(400),
			/** The remote's tip, which this worktree has not seen: new commits or a rewrite. */
			sha: z.string().max(64),
		}),
	]),
);
export type GitState = z.infer<typeof GitStateSchema>;
