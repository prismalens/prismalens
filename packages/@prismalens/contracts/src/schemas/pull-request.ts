// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Pull requests a thread found (#1024, surface D): from the agent's text, the
 * workspace branch, or a URL the user pasted. State comes from the git host.
 */
import { z } from "zod";

export const PR_STATES = [
	"open",
	"draft",
	"merged",
	"closed",
	"unknown",
] as const;
export const PrStateSchema = z.enum(PR_STATES);
export type PrState = z.infer<typeof PrStateSchema>;

export const PR_REVIEWS = [
	"approved",
	"changes_requested",
	"review_required",
	"none",
	"unknown",
] as const;
export const PrReviewSchema = z.enum(PR_REVIEWS);
export type PrReview = z.infer<typeof PrReviewSchema>;

export const PR_CHECK_STATES = [
	"passing",
	"failing",
	"pending",
	"none",
	"unknown",
] as const;
export const PrChecksSchema = z.object({
	state: z.enum(PR_CHECK_STATES),
	total: z.number().int().nonnegative(),
	failed: z.number().int().nonnegative(),
	pending: z.number().int().nonnegative(),
});
export type PrChecks = z.infer<typeof PrChecksSchema>;

export const PR_SOURCES = ["agent", "branch", "user"] as const;
export const PrSourceSchema = z.enum(PR_SOURCES);
export type PrSource = z.infer<typeof PrSourceSchema>;

/** `unknown` is a host PrismaLens reads no state from; it shows the neutral icon. */
export const PR_TONES = [
	"ready",
	"open",
	"draft",
	"attention",
	"failing",
	"merged",
	"closed",
	"unknown",
] as const;
export const PrToneSchema = z.enum(PR_TONES);
export type PrTone = z.infer<typeof PrToneSchema>;

/** The one design token each tone paints with: the glyph, the panel section, links and search rows. */
export const PR_TONE_TOKEN: Record<
	PrTone,
	"success" | "info" | "neutral" | "warning" | "danger" | "done" | "muted"
> = {
	ready: "success",
	open: "info",
	draft: "neutral",
	attention: "warning",
	failing: "danger",
	merged: "done",
	closed: "muted",
	unknown: "neutral",
};

/** An image URL as the host's API gave it; the UI loads it only through the image proxy (#1024 decision 11). */
const HostImageUrlSchema = z.string().url().max(2000);

export const PrPersonSchema = z.object({
	login: z.string().max(200),
	avatarUrl: HostImageUrlSchema.optional(),
});
export type PrPerson = z.infer<typeof PrPersonSchema>;

export const PrReviewerSchema = PrPersonSchema.extend({
	state: z.enum(["approved", "changes_requested", "commented", "requested"]),
});
export type PrReviewer = z.infer<typeof PrReviewerSchema>;

export const PrCheckRunSchema = z.object({
	name: z.string().max(300),
	state: z.enum(["passing", "failing", "pending", "neutral"]),
	appName: z.string().max(200).optional(),
	appAvatarUrl: HostImageUrlSchema.optional(),
});
export type PrCheckRun = z.infer<typeof PrCheckRunSchema>;
/** Check runs kept per PR; the summary counts still cover all of them. */
export const PR_CHECK_RUNS_MAX = 50;

/** Who and what the host shows beside a PR, stored as one JSON column. */
export const PrDetailSchema = z.object({
	author: PrPersonSchema.optional(),
	reviewers: z.array(PrReviewerSchema).max(50).optional(),
	checkRuns: z.array(PrCheckRunSchema).max(PR_CHECK_RUNS_MAX).optional(),
});
export type PrDetail = z.infer<typeof PrDetailSchema>;

export const PR_HOSTS = ["github", "gitlab", "other"] as const;
export const PrHostSchema = z.enum(PR_HOSTS);
export type PrHost = z.infer<typeof PrHostSchema>;

export const PullRequestSchema = z.object({
	id: z.string(),
	url: z.string().url(),
	host: PrHostSchema,
	/** `owner/repo` (GitLab: the full project path). */
	repo: z.string(),
	number: z.number().int().positive(),
	title: z.string().nullable(),
	state: PrStateSchema,
	review: PrReviewSchema,
	checks: PrChecksSchema,
	/** null while the host has not worked it out. */
	conflicts: z.boolean().nullable(),
	tone: PrToneSchema,
	source: PrSourceSchema,
	/** null until the host answered once. */
	fetchedAt: z.string().nullable(),
	...PrDetailSchema.shape,
});
export type PullRequest = z.infer<typeof PullRequestSchema>;

export type PrToneInput = Pick<
	PullRequest,
	"state" | "review" | "checks" | "conflicts"
>;

/**
 * One tone per PR (#1024 item 16). A failed check outranks everything an open
 * PR can show; ready needs passing or no checks, approval or no review asked, and no conflicts.
 */
export function prTone(pr: PrToneInput): PrTone {
	switch (pr.state) {
		case "merged":
		case "closed":
		case "draft":
		case "unknown":
			return pr.state;
	}
	if (pr.checks.state === "failing") return "failing";
	if (
		pr.review === "changes_requested" ||
		pr.conflicts === true ||
		pr.checks.state === "pending"
	)
		return "attention";
	if (
		(pr.checks.state === "passing" || pr.checks.state === "none") &&
		(pr.review === "approved" || pr.review === "none") &&
		pr.conflicts === false
	)
		return "ready";
	return "open";
}

export const NO_CHECKS: PrChecks = {
	state: "none",
	total: 0,
	failed: 0,
	pending: 0,
};

export const ThreadPullRequestsSchema = z.object({
	pullRequests: z.array(PullRequestSchema),
	/** Settings → Sources → "Show pull request status"; off means no host is called. */
	statusEnabled: z.boolean(),
});
export type ThreadPullRequests = z.infer<typeof ThreadPullRequestsSchema>;

export const LinkPullRequestSchema = z.object({
	id: z.string().uuid(),
	url: z.string().trim().url().max(2000),
});

export const UnlinkPullRequestSchema = z.object({
	id: z.string().uuid(),
	prId: z.string().uuid(),
});

/** The feed row's glyph: number and tone only (#1024 decision 9). */
export const ThreadRowPrSchema = z.object({
	number: z.number().int().positive(),
	tone: PrToneSchema,
});
export type ThreadRowPr = z.infer<typeof ThreadRowPrSchema>;

/** An issue or PR found by number or title for the `#` menu (#1024 decision 2), under the same trust rules. */
export const WorkItemSchema = z.object({
	kind: z.enum(["issue", "pull_request"]),
	number: z.number().int().positive(),
	title: z.string(),
	state: z.enum(["open", "draft", "merged", "closed"]),
	/** A PR's tone from what a list answer carries; an issue reads open or closed. */
	tone: PrToneSchema,
	url: z.string().url(),
	author: PrPersonSchema.optional(),
});
export type WorkItem = z.infer<typeof WorkItemSchema>;
/** Results a work-item search returns at most. */
export const WORK_ITEM_SEARCH_MAX = 20;
