// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Pull requests a thread found (#1024, surface D): from the agent's text, the
 * workspace branch, or a URL the user pasted. State comes from the git host.
 */
import { z } from "zod";
import { lazySchema } from "../lazy-schema.js";

export const PR_STATES = [
	"open",
	"draft",
	"merged",
	"closed",
	"unknown",
] as const;
export const PrStateSchema = /* @__PURE__ */ lazySchema(() =>
	z.enum(PR_STATES),
);
export type PrState = z.infer<typeof PrStateSchema>;

export const PR_REVIEWS = [
	"approved",
	"changes_requested",
	"review_required",
	"none",
	"unknown",
] as const;
export const PrReviewSchema = /* @__PURE__ */ lazySchema(() =>
	z.enum(PR_REVIEWS),
);
export type PrReview = z.infer<typeof PrReviewSchema>;

export const PR_CHECK_STATES = [
	"passing",
	"failing",
	"pending",
	"none",
	"unknown",
] as const;
export const PrChecksSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		state: z.enum(PR_CHECK_STATES),
		total: z.number().int().nonnegative(),
		failed: z.number().int().nonnegative(),
		pending: z.number().int().nonnegative(),
	}),
);
export type PrChecks = z.infer<typeof PrChecksSchema>;

/** One pushed PR change as marks, so the transcript draws it without parsing its sentence (#1101). */
export const PrStatusMarkSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		kind: z.enum(["check", "review", "comment", "conflict", "end"]),
		state: z
			.enum([
				"failing",
				"passing",
				"approved",
				"changes_requested",
				"commented",
				"merged",
				"closed",
			])
			.optional(),
		/** The head a check ran on. */
		sha: z.string().max(64).optional(),
		/** A check's name or a reviewer's login. */
		name: z.string().max(200).optional(),
	}),
);
export type PrStatusMark = z.infer<typeof PrStatusMarkSchema>;

export const PR_SOURCES = ["agent", "branch", "user"] as const;
export const PrSourceSchema = /* @__PURE__ */ lazySchema(() =>
	z.enum(PR_SOURCES),
);
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
export const PrToneSchema = /* @__PURE__ */ lazySchema(() => z.enum(PR_TONES));
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

/**
 * The host's image URL as stored, or the signed `/api/images/{key}` path a
 * read serves instead: the UI loads host images only through the proxy (#1024).
 */
const HostImageUrlSchema = /* @__PURE__ */ lazySchema(() =>
	z.union([
		z.string().url().max(2000),
		z
			.string()
			.max(4096)
			.regex(/^\/api\/images\/[\w-]+\.[\w-]+$/),
	]),
);

export const PrPersonSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		login: z.string().max(200),
		avatarUrl: HostImageUrlSchema.optional(),
	}),
);
export type PrPerson = z.infer<typeof PrPersonSchema>;

export const PrReviewerSchema = /* @__PURE__ */ lazySchema(() =>
	PrPersonSchema.extend({
		state: z.enum(["approved", "changes_requested", "commented", "requested"]),
	}),
);
export type PrReviewer = z.infer<typeof PrReviewerSchema>;

export const PrCheckRunSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		name: z.string().max(300),
		state: z.enum(["passing", "failing", "pending", "neutral"]),
		appName: z.string().max(200).optional(),
		appAvatarUrl: HostImageUrlSchema.optional(),
		/** The host's id for this execution; a same-SHA rerun gets a new one. */
		id: z.string().max(100).optional(),
		/** With the name, the logical check; absent for a commit status context. */
		appId: z.string().max(100).optional(),
		headSha: z.string().max(64).optional(),
		/** The check's log or details page. */
		url: z.string().url().max(2000).optional(),
		/** False when the host merges without it: an optional check, a job allowed to fail. */
		required: z.boolean().optional(),
	}),
);
export type PrCheckRun = z.infer<typeof PrCheckRunSchema>;
/** Check runs kept per PR; the summary counts still cover all of them. */
export const PR_CHECK_RUNS_MAX = 50;

/** Whether the host would merge it now, beyond conflicts (#1101 category 15). */
export const PR_MERGE_STATES = [
	"clean",
	"blocked",
	"behind",
	"conflicts",
	"unstable",
	"draft",
	"unknown",
] as const;
export const PrMergeStateSchema = /* @__PURE__ */ lazySchema(() =>
	z.enum(PR_MERGE_STATES),
);
export type PrMergeState = z.infer<typeof PrMergeStateSchema>;

/** One review conversation anchored to a line (#1101 category 15). */
export const PrReviewThreadSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		id: z.string().max(200),
		path: z.string().max(1000),
		/** null on a thread whose line the newer commits removed. */
		line: z.number().int().positive().nullable(),
		author: z.string().max(200),
		resolved: z.boolean(),
		/** The diff moved on since the comment. */
		outdated: z.boolean(),
		excerpt: z.string().max(600),
		replies: z.number().int().nonnegative(),
		url: z.string().url().max(2000).optional(),
		/** The newest reply, so the row shows the conversation's end (#1101 category 15). */
		last: z
			.object({
				author: z.string().max(200),
				excerpt: z.string().max(600),
				url: z.string().url().max(2000).optional(),
			})
			.optional(),
	}),
);
export type PrReviewThread = z.infer<typeof PrReviewThreadSchema>;
export const PR_REVIEW_THREADS_MAX = 50;

/** A check's log tail, read when asked and kept per head commit (#1101 category 15). */
export const PrCheckLogSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		runId: z.string().max(100),
		headSha: z.string().max(64).nullable(),
		/** The step that failed, when the host names steps. */
		step: z.string().max(300).nullable(),
		lines: z.array(z.string().max(400)).max(60),
		/** Why there is no tail, in plain words; null when `lines` holds it. */
		unavailable: z.string().max(300).nullable(),
		fetchedAt: z.string().datetime(),
	}),
);
export type PrCheckLog = z.infer<typeof PrCheckLogSchema>;
export const PR_CHECK_LOGS_MAX = 10;

/** Who and what the host shows beside a PR, stored as one JSON column. */
export const PrDetailSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		author: PrPersonSchema.optional(),
		reviewers: z.array(PrReviewerSchema).max(50).optional(),
		checkRuns: z.array(PrCheckRunSchema).max(PR_CHECK_RUNS_MAX).optional(),
		/** The branch pair: the PR's head merges into its base. */
		headRef: z.string().max(300).optional(),
		baseRef: z.string().max(300).optional(),
		mergeState: PrMergeStateSchema.optional(),
		reviewThreads: z
			.array(PrReviewThreadSchema)
			.max(PR_REVIEW_THREADS_MAX)
			.optional(),
		/** Why review threads could not be read; absent when they were. */
		reviewThreadsNote: z.string().max(300).optional(),
		checkLogs: z.array(PrCheckLogSchema).max(PR_CHECK_LOGS_MAX).optional(),
		/** Comments a person posted from PrismaLens, by activity id: the watch never reports them. */
		own: z
			.array(z.object({ source: z.string().max(40), id: z.number().int() }))
			.max(200)
			.optional(),
	}),
);
export type PrDetail = z.infer<typeof PrDetailSchema>;

export const PR_HOSTS = ["github", "gitlab", "other"] as const;
export const PrHostSchema = /* @__PURE__ */ lazySchema(() => z.enum(PR_HOSTS));
export type PrHost = z.infer<typeof PrHostSchema>;

/** A git host's own words for its change requests and their CI, lower case (#1122). */
export const PrHostTermsSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		/** `pull request`, `merge request`. */
		changeRequest: z.string(),
		/** `PR`, `MR`. */
		short: z.string(),
		/** What a number is written after: `#12`, `!12`. */
		numberPrefix: z.string(),
		/** One CI result: `check`, `job`. */
		check: z.string(),
		checks: z.string(),
		/** The CI view as a whole: `checks`, `pipeline`. */
		ci: z.string(),
	}),
);
export type PrHostTerms = z.infer<typeof PrHostTermsSchema>;

/** Each host kind's terms; the UI renders these and never hard-codes a host's word. */
export const PR_HOST_TERMS: Record<PrHost, PrHostTerms> = {
	github: {
		changeRequest: "pull request",
		short: "PR",
		numberPrefix: "#",
		check: "check",
		checks: "checks",
		ci: "checks",
	},
	gitlab: {
		changeRequest: "merge request",
		short: "MR",
		numberPrefix: "!",
		check: "job",
		checks: "jobs",
		ci: "pipeline",
	},
	other: {
		changeRequest: "pull request",
		short: "PR",
		numberPrefix: "#",
		check: "check",
		checks: "checks",
		ci: "checks",
	},
};

/** A host's terms; an absent or unknown host reads as a pull request with checks. */
export function prHostTerms(host: PrHost | null | undefined): PrHostTerms {
	return PR_HOST_TERMS[host ?? "other"] ?? PR_HOST_TERMS.other;
}

/** `PR #12`, `MR !12`. */
export function prLabel(host: PrHost | null | undefined, n: number): string {
	const t = prHostTerms(host);
	return `${t.short} ${t.numberPrefix}${n}`;
}

/** A term with its first letter upper case, for a label or a sentence start. */
export function capitalTerm(word: string): string {
	return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * A watch's lifecycle (#1024 surface F): `waiting` holds a batch for the agent;
 * `disconnected` is a failing host; `expired` is 7 idle days; `stopped` keeps why.
 */
export const PR_WATCH_STATES = [
	"watching",
	"waiting",
	"disconnected",
	"expired",
	"stopped",
] as const;
export const PrWatchStateSchema = /* @__PURE__ */ lazySchema(() =>
	z.enum(PR_WATCH_STATES),
);
export type PrWatchState = z.infer<typeof PrWatchStateSchema>;

export const PrWatchSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		state: PrWatchStateSchema,
		/** Why it is disconnected or stopped, in plain words. */
		reason: z.string().max(300).nullable(),
		since: z.string().datetime(),
		/** When an automatic watch lapses without new thread activity. */
		until: z.string().datetime().nullable(),
		/** Watched because the PR is on the thread's own branch, not by Watch or `pl_pr_watch`. */
		auto: z.boolean(),
	}),
);
export type PrWatch = z.infer<typeof PrWatchSchema>;

export const PullRequestSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
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
		/** The head commit the host last reported. */
		headSha: z.string().nullable().optional(),
		/** null when the thread does not watch this PR. */
		watch: PrWatchSchema.nullable().optional(),
		...PrDetailSchema.shape,
	}),
);
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

export const ThreadPullRequestsSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		pullRequests: z.array(PullRequestSchema),
		/** Settings → Sources → "Show pull request status"; off means no host is called. */
		statusEnabled: z.boolean(),
	}),
);
export type ThreadPullRequests = z.infer<typeof ThreadPullRequestsSchema>;

export const LinkPullRequestSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		id: z.string().uuid(),
		url: z.string().trim().url().max(2000),
	}),
);

export const UnlinkPullRequestSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		id: z.string().uuid(),
		prId: z.string().uuid(),
	}),
);

/** Watch or Stop watching one of the thread's PRs. */
export const WatchPullRequestSchema = /* @__PURE__ */ lazySchema(
	() => UnlinkPullRequestSchema,
);

/** One check's log tail on one of the thread's PRs. */
export const PrCheckLogInputSchema = /* @__PURE__ */ lazySchema(() =>
	UnlinkPullRequestSchema.extend({
		runId: z.string().min(1).max(100),
	}),
);

/**
 * A person's reply to one review thread, posted on the code host as them (#1101 category 15).
 * `clientKey` is the draft's own key: a second press or a retry with it never posts twice.
 */
export const PrReviewReplyInputSchema = /* @__PURE__ */ lazySchema(() =>
	UnlinkPullRequestSchema.extend({
		threadId: z.string().min(1).max(200),
		body: z.string().trim().min(1).max(20_000),
		clientKey: z.string().min(8).max(100),
	}),
);
export type PrReviewReplyInput = z.infer<typeof PrReviewReplyInputSchema>;

/** Why the host took no reply: the closed set the panel words (`PR_REPLY_FAILURES`). */
export const PR_REPLY_FAILURES = [
	"scope",
	"locked",
	"rejected",
	"unreachable",
] as const;
export type PrReplyFailure = (typeof PR_REPLY_FAILURES)[number];

export const PrReviewReplySchema = /* @__PURE__ */ lazySchema(() =>
	z.discriminatedUnion("ok", [
		z.object({
			ok: z.literal(true),
			thread: PrReviewThreadSchema,
			/** The posted comment's page on the host, when it gave one. */
			url: z.string().url().max(2000).optional(),
		}),
		z.object({
			ok: z.literal(false),
			failure: z.enum(PR_REPLY_FAILURES),
			/** The host's own words, shown under the panel's notice. */
			message: z.string().max(500),
		}),
	]),
);
export type PrReviewReply = z.infer<typeof PrReviewReplySchema>;

/** The feed row's glyph: number and tone only (#1024 decision 9). */
export const ThreadRowPrSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		number: z.number().int().positive(),
		tone: PrToneSchema,
		/** How many change requests the thread has; the row shows the newest and "+N". */
		count: z.number().int().positive().optional(),
		/** For the palette's PR results and preview (#1101 category 19). */
		title: z.string().nullable().optional(),
		checks: PrChecksSchema.optional(),
	}),
);
export type ThreadRowPr = z.infer<typeof ThreadRowPrSchema>;

/** An issue or PR found by number or title for the `#` menu (#1024 decision 2), under the same trust rules. */
export const WorkItemSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		kind: z.enum(["issue", "pull_request"]),
		number: z.number().int().positive(),
		title: z.string(),
		state: z.enum(["open", "draft", "merged", "closed"]),
		/** A PR's tone from what a list answer carries; an issue reads open or closed. */
		tone: PrToneSchema,
		url: z.string().url(),
		author: PrPersonSchema.optional(),
	}),
);
export type WorkItem = z.infer<typeof WorkItemSchema>;
/** Results a work-item search returns at most. */
export const WORK_ITEM_SEARCH_MAX = 20;
