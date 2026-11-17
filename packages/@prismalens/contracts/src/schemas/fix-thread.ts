// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A thread started to fix a failing check or a review comment on a PR (#1176):
 * previewed with every word it will send, then started exactly as previewed.
 */
import { z } from "zod";
import { lazySchema } from "../lazy-schema.js";
import { MESSAGE_TEXT_MAX } from "./investigation-values.js";
import { UnlinkPullRequestSchema } from "./pull-request.js";
import { AccessLevelSchema } from "./settings.js";
import { StartThreadResponseSchema } from "./thread.js";
import { ThreadLinkSchema } from "./thread-tree.js";
import { FIX_BATCH_MAX } from "./thread-tree-values.js";

export { FIX_BATCH_MAX };

export const FixItemSchema = /* @__PURE__ */ lazySchema(() =>
	z.discriminatedUnion("kind", [
		z.object({ kind: z.literal("check"), runId: z.string().min(1).max(100) }),
		z.object({
			kind: z.literal("review"),
			reviewThreadId: z.string().min(1).max(200),
		}),
	]),
);
export type FixItem = z.infer<typeof FixItemSchema>;

/** The evidence goes to the agent after the message (context.addendum), never in it. */
export const FIX_EVIDENCE_MAX = 60_000;

export const FixThreadInputSchema = /* @__PURE__ */ lazySchema(() =>
	UnlinkPullRequestSchema.extend({
		items: z.array(FixItemSchema).min(1).max(FIX_BATCH_MAX),
	}),
);
export type FixThreadInput = z.infer<typeof FixThreadInputSchema>;

export const FIX_REFUSALS = [
	"no-project",
	"plain-folder",
	"fork-branch",
	"no-head",
	"closed",
	"missing-commit",
	"not-failing",
	"cancelled",
	"resolved",
	"status-off",
] as const;
export type FixRefusal = (typeof FIX_REFUSALS)[number];

export const FixPlaceSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		projectId: z.string().uuid(),
		projectName: z.string().max(200),
		source: z.enum(["folder", "url"]),
		headRef: z.string().max(300),
		headSha: z.string().regex(/^[0-9a-f]{40,64}$/),
		/** The head commit is missing from the folder and Start fetches it first. */
		fetch: z.boolean(),
		push: z.enum(["branch", "none"]),
		/** The one push URL as shown, never with userinfo; null with push "none". */
		pushUrl: z.string().max(2000).nullable(),
		pushNote: z.enum(["clone", "push-elsewhere", "unsafe-ref"]).nullable(),
		own: z.boolean(),
		harness: z.string().nullable(),
		model: z.string().nullable(),
		effort: z.string().nullable(),
		accessLevel: AccessLevelSchema.nullable(),
	}),
);
export type FixPlace = z.infer<typeof FixPlaceSchema>;

export const FixPreviewItemSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		kind: z.enum(["check", "review"]),
		ident: z.string().max(300),
		label: z.string().max(200),
	}),
);
export type FixPreviewItem = z.infer<typeof FixPreviewItemSchema>;

export const FixPreviewSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		title: z.string().max(80),
		/** What Start will fix: the requested items no admitted fix thread covers yet. */
		items: z.array(FixPreviewItemSchema).max(FIX_BATCH_MAX),
		/** Requested items an admitted fix thread on this head already covers, newest link. */
		covered: z
			.array(
				z.object({
					ident: z.string().max(300),
					label: z.string().max(200),
					link: ThreadLinkSchema,
				}),
			)
			.max(FIX_BATCH_MAX),
		/** Fix threads on this head that failed: they cover nothing, so Start opens another. */
		failed: z.array(ThreadLinkSchema).max(FIX_BATCH_MAX).default([]),
		text: z.string().max(MESSAGE_TEXT_MAX).nullable(),
		evidence: z.string().max(FIX_EVIDENCE_MAX).nullable(),
		/** sha256 hex over canonical JSON of {text, evidence, title, items, place}. */
		digest: z.string().length(64).nullable(),
		place: FixPlaceSchema.nullable(),
		refusal: z
			.object({ reason: z.enum(FIX_REFUSALS), detail: z.string().max(300) })
			.nullable(),
	}),
);
export type FixPreview = z.infer<typeof FixPreviewSchema>;

export const StartFixThreadSchema = /* @__PURE__ */ lazySchema(() =>
	FixThreadInputSchema.extend({ digest: z.string().length(64) }),
);
export type StartFixThreadInput = z.infer<typeof StartFixThreadSchema>;
export const StartFixThreadResponseSchema = /* @__PURE__ */ lazySchema(
	() => StartThreadResponseSchema,
);

/** What a fork or side question carries over from its parent, in a few words (#1176). */
export const ForkPreviewSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		carried: z.string().max(300),
		omitted: z.string().max(300).nullable(),
	}),
);
export type ForkPreview = z.infer<typeof ForkPreviewSchema>;
