// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A thread's subscription to one PR's events (#1179): which events, from whom, and how
 * they reach the agent. Every word here is PrismaLens's own or the caller's input; host
 * text never passes through these helpers.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { z } from "zod";
import { lazySchema } from "../lazy-schema.js";
import { DateStringSchema } from "./common.js";
import { type PrHost, PrHostSchema } from "./pull-request.js";
import { prHostTerms } from "./pull-request-values.js";

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

export const PrSubscriptionFilterSchema = /* @__PURE__ */ lazySchema(() =>
	z
		.object({
			authors: z
				.object({
					minAssociation: z.enum(PR_AUTHOR_LEVELS).default("collaborator"),
					reviewersOnly: z.boolean().default(false),
					include: z.array(z.string().regex(LOGIN_RE)).max(20).default([]),
					exclude: z.array(z.string().regex(LOGIN_RE)).max(20).default([]),
					bots: z.boolean().default(false),
				})
				.strict()
				.prefault({}),
			reviews: z
				.object({
					verdicts: z
						.array(
							z.enum([
								"approved",
								"changes_requested",
								"commented",
								"dismissed",
							]),
						)
						.min(1)
						.default([
							"approved",
							"changes_requested",
							"commented",
							"dismissed",
						]),
				})
				.strict()
				.prefault({}),
			checks: z
				.object({
					/** `passing` is a check that recovered after failing. */
					conclusions: z
						.array(z.enum(["failing", "passing", "neutral"]))
						.max(3)
						.default(["failing"]),
					names: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
					summary: z.boolean().default(true),
				})
				.strict()
				.prefault({}),
			pushes: z
				.object({ forcedOnly: z.boolean().default(true) })
				.strict()
				.prefault({}),
		})
		.strict()
		.prefault({}),
);
export type PrSubscriptionFilter = z.infer<typeof PrSubscriptionFilterSchema>;

export const PrSubscriptionSpecSchema = /* @__PURE__ */ lazySchema(() =>
	z
		.object({
			events: z
				.array(z.enum(PR_EVENT_GROUPS))
				.min(1)
				.max(7)
				.default([...PR_EVENT_GROUPS]),
			filter: PrSubscriptionFilterSchema,
			delivery: z.enum(PR_DELIVERY_MODES).default("wake"),
			batchMinutes: z.number().int().min(2).max(120).optional(),
			once: z.boolean().default(false),
		})
		.strict()
		.superRefine((s, ctx) => {
			if (s.batchMinutes !== undefined && s.delivery !== "batch")
				ctx.addIssue({
					code: "custom",
					path: ["batchMinutes"],
					message: "batchMinutes goes with delivery: batch",
				});
		}),
);
export interface PrSubscriptionSpec {
	events: PrEventGroup[];
	filter: {
		authors: {
			minAssociation: PrAuthorLevel;
			reviewersOnly: boolean;
			include: string[];
			exclude: string[];
			bots: boolean;
		};
		reviews: {
			verdicts: (
				| "approved"
				| "changes_requested"
				| "commented"
				| "dismissed"
			)[];
		};
		checks: {
			conclusions: ("failing" | "passing" | "neutral")[];
			names: string[];
			summary: boolean;
		};
		pushes: { forcedOnly: boolean };
	};
	delivery: PrDeliveryMode;
	batchMinutes?: number | undefined;
	once: boolean;
}
export type PrSubscriptionSpecInput = z.input<typeof PrSubscriptionSpecSchema>;

/** The spec a creator gets when it names nothing: people hear what #1024's feed delivered (R1). */
export function defaultSpec(createdBy: PrSubCreator): PrSubscriptionSpec {
	const base = PrSubscriptionSpecSchema.parse({});
	if (createdBy === "agent") return base;
	return {
		...base,
		filter: {
			...base.filter,
			authors: { ...base.filter.authors, minAssociation: "any", bots: true },
			checks: { ...base.filter.checks, conclusions: ["failing", "passing"] },
		},
	};
}

/** A migrated `pl_pr_watch`'s spec, for display only: D22 decides when it fires. */
export function oneShotSpec(
	until: "checks_done" | "review" | "merged",
): PrSubscriptionSpec {
	const d = defaultSpec("agent");
	if (until === "checks_done")
		return {
			...d,
			events: ["checks", "merge_close"],
			filter: {
				...d.filter,
				checks: { conclusions: [], names: [], summary: true },
			},
			once: true,
		};
	if (until === "review")
		return {
			...d,
			events: ["reviews", "merge_close"],
			filter: {
				...d.filter,
				authors: { ...d.filter.authors, minAssociation: "any", bots: true },
				reviews: { verdicts: ["approved", "changes_requested"] },
			},
			once: true,
		};
	return { ...d, events: ["merge_close"], once: true };
}

/** A spec merged over a creator's defaults, one level deep per filter part. */
export function resolveSpec(
	createdBy: PrSubCreator,
	input: PrSubscriptionSpecInput | undefined,
): PrSubscriptionSpec {
	const d = defaultSpec(createdBy);
	const f = input?.filter;
	const delivery = input?.delivery ?? d.delivery;
	const batchMinutes =
		input?.batchMinutes ??
		(delivery === "batch" ? PR_SUB.batchMinutes : undefined);
	return PrSubscriptionSpecSchema.parse({
		events: input?.events ?? d.events,
		delivery,
		...(batchMinutes !== undefined ? { batchMinutes } : {}),
		once: input?.once ?? d.once,
		filter: {
			authors: { ...d.filter.authors, ...(f?.authors ?? {}) },
			reviews: { ...d.filter.reviews, ...(f?.reviews ?? {}) },
			checks: { ...d.filter.checks, ...(f?.checks ?? {}) },
			pushes: { ...d.filter.pushes, ...(f?.pushes ?? {}) },
		},
	});
}

const list = (parts: string[]): string =>
	parts.length <= 1
		? (parts[0] ?? "")
		: `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;

const AUTHOR_WORDS: Record<PrAuthorLevel, string> = {
	any: "anyone",
	contributor: "contributors",
	collaborator: "collaborators",
	owner: "owners",
};

/** One line from enums and the spec's own logins and check names, never host text. */
export function subscriptionSummary(
	spec: PrSubscriptionSpec,
	host?: PrHost | null,
): string {
	const t = prHostTerms(host);
	const on = new Set(spec.events);
	const parts: string[] = [];
	if (on.has("checks")) {
		const c = spec.filter.checks;
		const kinds = c.conclusions.map((k) =>
			k === "failing" ? "failing" : k === "passing" ? "recovered" : "neutral",
		);
		if (kinds.length)
			parts.push(
				`${capital(list(kinds))} ${t.checks}${c.names.length ? ` named ${c.names.join(", ")}` : ""}`,
			);
		if (c.summary) parts.push(`${t.checks} summary`);
	}
	const said: string[] = [];
	if (on.has("comments")) said.push("comments");
	if (on.has("reviews")) said.push("reviews");
	if (on.has("review_threads")) said.push("threads");
	if (said.length) {
		const a = spec.filter.authors;
		const who = a.reviewersOnly ? "reviewers" : AUTHOR_WORDS[a.minAssociation];
		const plus = a.include.length ? ` plus @${a.include.join(", @")}` : "";
		const bots = a.bots ? "" : a.minAssociation === "any" ? ", no bots" : "";
		parts.push(`${list(said)} from ${who}${plus}${bots}`);
	}
	if (on.has("pushes"))
		parts.push(spec.filter.pushes.forcedOnly ? "force-pushes" : "pushes");
	if (on.has("merge_close")) parts.push("merge, close");
	if (on.has("conflicts")) parts.push("conflicts");
	const how =
		spec.delivery === "wake"
			? "Wakes the thread."
			: spec.delivery === "batch"
				? `Every ${spec.batchMinutes ?? PR_SUB.batchMinutes} minutes.`
				: "At the next pause.";
	const line = `${capital(parts.join(", "))}. ${how}${spec.once ? " Once." : ""}`;
	return line.length > 300 ? `${line.slice(0, 299)}…` : line;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The hash #1131's ledger stores of a posted body: line endings normalized, trimmed. */
export function ownTextHash(text: string): string {
	return bytesToHex(sha256(utf8ToBytes(text.replace(/\r\n/g, "\n").trim())));
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses.
const UNSAFE_LINK = /[\s\u0000-\u001f\u007f]/;

/** A host link the agent may see: https on the PR's own web origin, no userinfo, else null (D10). */
export function safeLink(
	link: string | null | undefined,
	prUrl: string,
): string | null {
	if (!link || link.length > 2000 || UNSAFE_LINK.test(link)) return null;
	try {
		const u = new URL(link);
		const pr = new URL(prUrl);
		if (u.protocol !== "https:" || u.origin !== pr.origin) return null;
		if (u.username || u.password) return null;
		return u.href;
	} catch {
		return null;
	}
}

const PR_SUB_STATES = ["active", "disconnected", "ended"] as const;

/** Named, so the combined contract's declaration stays under TypeScript's size limit. */
export interface PrSubscriptionView {
	id: string;
	threadId: string;
	prId: string;
	pr: string;
	url: string;
	host: PrHost;
	createdBy: PrSubCreator;
	spec: PrSubscriptionSpec;
	summary: string;
	state: (typeof PR_SUB_STATES)[number];
	paused: { reason: PrSubPause; until: string | null } | null;
	hostError: string | null;
	deliveryFailing: {
		parked: number;
		lastError: string | null;
		at: string;
	} | null;
	endReason: PrSubEndReason | null;
	endNote: string | null;
	counts: {
		delivered: number;
		waiting: number;
		filtered: number;
		withdrawn: number;
		alreadySent: number;
	};
	since: string;
	lastDeliveredAt: string | null;
	lastReadAt: string | null;
	endedAt: string | null;
}

export interface PrSubscriptionList {
	subscriptions: PrSubscriptionView[];
	statusEnabled: boolean;
}

export const PrSubscriptionViewSchema: z.ZodType<PrSubscriptionView> =
	/* @__PURE__ */ lazySchema(() =>
		z.object({
			id: z.string(),
			threadId: z.string(),
			prId: z.string(),
			/** `owner/repo#7`. */
			pr: z.string().max(300),
			url: z.string(),
			host: PrHostSchema,
			createdBy: z.enum(PR_SUB_CREATORS),
			spec: PrSubscriptionSpecSchema,
			summary: z.string().max(300),
			state: z.enum(PR_SUB_STATES),
			/** Why nothing is delivered now; precedence in PR_SUB_PAUSES order. */
			paused: z
				.object({
					reason: z.enum(PR_SUB_PAUSES),
					until: DateStringSchema.nullable(),
				})
				.nullable(),
			hostError: z.string().max(300).nullable(),
			/** Parked deliveries (D21); null once nothing of it is parked. */
			deliveryFailing: z
				.object({
					parked: z.number().int(),
					lastError: z.string().max(300).nullable(),
					at: DateStringSchema,
				})
				.nullable(),
			endReason: z.enum(PR_SUB_END_REASONS).nullable(),
			endNote: z.string().max(300).nullable(),
			counts: z.object({
				delivered: z.number().int(),
				waiting: z.number().int(),
				filtered: z.number().int(),
				withdrawn: z.number().int(),
				alreadySent: z.number().int(),
			}),
			since: DateStringSchema,
			lastDeliveredAt: DateStringSchema.nullable(),
			lastReadAt: DateStringSchema.nullable(),
			endedAt: DateStringSchema.nullable(),
		}),
	);

export const PrSubscriptionListSchema: z.ZodType<PrSubscriptionList> =
	/* @__PURE__ */ lazySchema(() =>
		z.object({
			subscriptions: z.array(PrSubscriptionViewSchema),
			statusEnabled: z.boolean(),
		}),
	);

export const PrSubscriptionListInputSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({ id: z.string().uuid(), prId: z.string().min(1).optional() }),
);
export const PrSubscriptionCreateSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		id: z.string().uuid(),
		prId: z.string().min(1),
		spec: z.unknown().optional(),
		/** An ended subscription to start again as a fresh one. */
		fromId: z.string().min(1).optional(),
	}),
);
export const PrSubscriptionCancelSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({ id: z.string().uuid(), subscriptionId: z.string().min(1) }),
);
export const PrSubscriptionThreadSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({ id: z.string().uuid() }),
);
export const PrSubscriptionReleasedSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({ released: z.number().int() }),
);
export const PrSubscriptionPolledSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({ polled: z.number().int() }),
);

/** Where each item of a PR bundle came from (#1179): ids, kinds and logins, no host text. */
export const PrInboundEventsSchema = /* @__PURE__ */ lazySchema(() =>
	z
		.array(
			z.object({
				prId: z.string().max(200),
				pr: z.string().max(300),
				url: z.string().url().max(2000),
				host: PrHostSchema.optional(),
				subscriptionIds: z.array(z.string().max(200)).max(10),
				delivery: z.enum(PR_DELIVERY_MODES),
				items: z
					.array(
						z.object({
							id: z.number().int(),
							kind: z.enum(PR_EVENT_KINDS),
							author: z.string().max(60).optional(),
							association: z.string().max(20).optional(),
							agentPosted: z.boolean().optional(),
							link: z.string().url().max(2000).optional(),
							sha: z.string().max(40).optional(),
							at: DateStringSchema,
						}),
					)
					.max(20),
				/** Delivery ids counted, not detailed. */
				more: z.array(z.number().int()).max(5000),
				superseded: z.number().int().min(0),
			}),
		)
		.max(10),
);
export type PrInboundEvents = z.infer<typeof PrInboundEventsSchema>;

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
