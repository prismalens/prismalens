// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Zod-free, so the thread page reads these without loading a schema (#1130, #1179).

export const PR_EVENT_GROUPS = [
	"comments",
	"reviews",
	"review_threads",
	"checks",
	"pushes",
	"merge_close",
	"conflicts",
] as const;
export type PrEventGroup = (typeof PR_EVENT_GROUPS)[number];

export const PR_EVENT_KINDS = [
	"comment",
	"review",
	"review_comment",
	"thread_resolved",
	"thread_reopened",
	"check",
	"checks_done",
	"push",
	"merged",
	"closed",
	"reopened",
	"conflict",
	"subscription_ended",
	"legacy",
] as const;
export type PrEventKind = (typeof PR_EVENT_KINDS)[number];

/** The group a kind belongs to; `subscription_ended` and `legacy` have none and always pass. */
export const PR_EVENT_GROUP_OF: Record<PrEventKind, PrEventGroup | null> = {
	comment: "comments",
	review: "reviews",
	review_comment: "comments",
	thread_resolved: "review_threads",
	thread_reopened: "review_threads",
	check: "checks",
	checks_done: "checks",
	push: "pushes",
	merged: "merge_close",
	closed: "merge_close",
	reopened: "merge_close",
	conflict: "conflicts",
	subscription_ended: null,
	legacy: null,
};

/** Urgency: wake > batch > next_pause. */
export const PR_DELIVERY_MODES = ["wake", "next_pause", "batch"] as const;
export type PrDeliveryMode = (typeof PR_DELIVERY_MODES)[number];
export const PR_DELIVERY_URGENCY: Record<PrDeliveryMode, number> = {
	wake: 2,
	batch: 1,
	next_pause: 0,
};

export const PR_AUTHOR_LEVELS = [
	"any",
	"contributor",
	"collaborator",
	"owner",
] as const;
export type PrAuthorLevel = (typeof PR_AUTHOR_LEVELS)[number];
export const PR_AUTHOR_LEVEL_RANK: Record<PrAuthorLevel, number> = {
	any: 0,
	contributor: 2,
	collaborator: 3,
	owner: 4,
};

/** GitHub's `author_association` as a rank; unknown is null (D16a). */
export function associationRank(a: string | null | undefined): number | null {
	switch (a) {
		case "OWNER":
			return 4;
		case "MEMBER":
		case "COLLABORATOR":
			return 3;
		case "CONTRIBUTOR":
			return 2;
		case "FIRST_TIME_CONTRIBUTOR":
		case "FIRST_TIMER":
			return 1;
		case "NONE":
		case "MANNEQUIN":
			return 0;
		default:
			return null;
	}
}

export const PR_SUB_CREATORS = ["agent", "user", "auto"] as const;
export type PrSubCreator = (typeof PR_SUB_CREATORS)[number];

export const PR_SUB_END_REASONS = [
	"merged",
	"closed",
	"loop_guard",
	"comment_cap",
	"once",
	"cancelled_by_user",
	"cancelled_by_agent",
	"run_stopped",
	"settled",
	"expired",
] as const;
export type PrSubEndReason = (typeof PR_SUB_END_REASONS)[number];

/** What each end reason reads as, after "Ended: ". */
export const PR_SUB_END_WORDS: Record<PrSubEndReason, string> = {
	merged: "merged",
	closed: "closed",
	loop_guard: "a check kept failing on 3 pushes",
	comment_cap: "5 bot or agent rounds in a row",
	once: "delivered once",
	cancelled_by_user: "cancelled by you",
	cancelled_by_agent: "cancelled by the agent",
	run_stopped: "thread stopped",
	settled: "thread settled",
	expired: "expired",
};

export const PR_SUB_PAUSES = [
	"setting_off",
	"settling",
	"rate_limited",
	"provider_limit",
	"ceiling",
] as const;
export type PrSubPause = (typeof PR_SUB_PAUSES)[number];

export const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,38})(?:\[bot\])?$/;
export const PR_AGENT_MARKER = "_Posted by an agent via PrismaLens";

/** Limits a subscription keeps (#1179). */
export const PR_SUB = {
	/** Active subscriptions per thread. */
	perThread: 10,
	/** PRs and detailed items per bundle; the rest wait or are listed by id. */
	bundlePrs: 10,
	bundleItems: 20,
	/** Deliveries in a row of only quiet items that end a subscription. */
	quietCap: 5,
	/** Resends before a delivery parks, and their backoff. */
	resendMinutes: [2, 10, 30] as readonly number[],
	/** An agent's re-subscribe after these ends waits this long. */
	lockoutMs: 24 * 60 * 60_000,
	/** A batch's default wait. */
	batchMinutes: 10,
	/** Ended rows the panel lists. */
	listEndedMs: 7 * 24 * 60 * 60_000,
} as const;

/** Plain words for a kind, outside the fence and in the UI. */
export const PR_EVENT_KIND_WORDS: Record<PrEventKind, string> = {
	comment: "comment",
	review: "review",
	review_comment: "review comment",
	thread_resolved: "thread resolved",
	thread_reopened: "thread reopened",
	check: "check",
	checks_done: "checks finished",
	push: "push",
	merged: "merged",
	closed: "closed",
	reopened: "reopened",
	conflict: "merge conflict",
	subscription_ended: "subscription ended",
	legacy: "earlier update",
};
