// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Threads that start threads (#1024 spec F): an agent starts sibling threads and messages
 * any thread it can read, as a person would, inside the user's caps (#1101 cat 10).
 */
import { z } from "zod";
import { lazySchema } from "../lazy-schema.js";
import { SUBAGENT_STATES } from "./investigation-values.js";
import { ThreadStatusSchema } from "./thread-status.js";
import {
	FIX_BATCH_MAX,
	STARTED_BY_VIAS,
	THREAD_MESSAGE_OUTCOMES,
} from "./thread-tree-values.js";

/** A message's stored type: plain `message` now; older rows carry a typed kind or a finished thread's `result`. */
export const ThreadMessageKindSchema = /* @__PURE__ */ lazySchema(() =>
	z.enum([
		"message",
		"handoff",
		"blocker",
		"fact",
		"question",
		"reply",
		"result",
	]),
);
export type ThreadMessageKind = z.infer<typeof ThreadMessageKindSchema>;

/** `steer` delivers now and cancels the receiver's step, from any sender, as a person's steer does. */
export const ThreadMessageModeSchema = /* @__PURE__ */ lazySchema(() =>
	z.enum(["queue", "steer"]),
);
export type ThreadMessageMode = z.infer<typeof ThreadMessageModeSchema>;

/** The longest message text, and the longest result excerpt a parent receives. */
export const THREAD_MESSAGE_CHARS = 2_000;

/** A linked thread's state, as its status mark rings it. */
export const ThreadNodeStateSchema = /* @__PURE__ */ lazySchema(() =>
	z.enum(["queued", "running", "answered", "failed", "stopped"]),
);
export type ThreadNodeState = z.infer<typeof ThreadNodeStateSchema>;

/** Who started a thread, or the thread a person forked, asked aside or fixed from. */
export const StartedByViaSchema = /* @__PURE__ */ lazySchema(() =>
	z.enum(STARTED_BY_VIAS),
);
export type StartedByVia = z.infer<typeof StartedByViaSchema>;

/** What a fix thread was started for: a PR head and the checks or review threads on it. */
export const FixRefSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		prId: z.string(),
		headSha: z.string().max(64),
		items: z
			.array(
				z.object({
					kind: z.enum(["check", "review"]),
					/** check: `${appId ?? "status"}:${group ?? ""}:${name}`, at most 100+100+300+2; review: the review thread id. */
					ident: z.string().max(512),
				}),
			)
			.min(1)
			.max(FIX_BATCH_MAX),
	}),
);
export type FixRef = z.infer<typeof FixRefSchema>;

/** A thread at one end of a start: the one that started this one, or one it started. */
export const ThreadLinkSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		id: z.string(),
		title: z.string().nullable(),
		/** The thread's path in the app, never an id alone. */
		link: z.string(),
		state: ThreadNodeStateSchema,
		/** Its one status in the list's closed set (asking, limited, blocked and the rest); `state` when unknown. */
		status: ThreadStatusSchema.optional(),
		harness: z.string().nullable().optional(),
		startedAt: z.string().nullable().optional(),
		/** Messages to it not yet delivered. */
		unread: z.number().int().min(0),
		via: StartedByViaSchema.optional(),
		fix: FixRefSchema.optional(),
		endedAt: z.string().nullable().optional(),
	}),
);
export type ThreadLink = z.infer<typeof ThreadLinkSchema>;

/** A sub-agent the thread's agent ran inside its session, from stored state (#1176). */
export const SubagentSummarySchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		sessionId: z.string().max(200),
		parentSessionId: z.string().max(200).nullable(),
		title: z.string().max(200),
		state: z.enum(SUBAGENT_STATES),
		startedAt: z.string(),
		endedAt: z.string().nullable(),
	}),
);
export type SubagentSummary = z.infer<typeof SubagentSummarySchema>;

/** Settings → Agent → Agent-started threads, as a thread runs under them. */
export const ThreadLimitsSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		agentsStartThreads: z.enum(["ask", "allow", "never"]),
		perStarter: z.number().int(),
		total: z.number().int(),
		turnsPerDay: z.number().int(),
		pairPerDay: z.number().int(),
	}),
);

/** A thread's start links (#1101 cat 10): threads are flat siblings, never a tree. */
export const ThreadLinksSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		/** Null for a thread a person started. */
		startedBy: ThreadLinkSchema.extend({ via: StartedByViaSchema }).nullable(),
		/** Every thread started from it, oldest first: agent starts, forks, side questions and fix threads. */
		started: z.array(ThreadLinkSchema),
		/** Sub-agents its agent ran, oldest first, read from stored state. */
		subagents: z.array(SubagentSummarySchema).max(200).optional(),
		/** "Allow for this chain" is in force (host only, revocable); keyed by where the chain began. */
		allowance: z.object({ grantedAt: z.string() }).nullable(),
		/** Where the start chain began: the allowance's key. */
		chainId: z.string(),
		limits: ThreadLimitsSchema,
	}),
);
export type ThreadLinks = z.infer<typeof ThreadLinksSchema>;

/** What `pl_propose_action` may propose; the user's click applies it through the normal API. */
export const PROPOSAL_KINDS = [
	"setting",
	"schedule",
	"service_link",
	"project_add",
] as const;
export const ProposalKindSchema = /* @__PURE__ */ lazySchema(() =>
	z.enum(PROPOSAL_KINDS),
);
export type ProposalKind = z.infer<typeof ProposalKindSchema>;

/** What each numeric threads setting accepts; the settings schema and a proposal to change one share it. */
export const THREAD_TREE_RANGES = {
	children: { min: 1, max: 20 },
	perTree: { min: 2, max: 50 },
	turnsPerDay: { min: 10, max: 1000 },
	pairPerDay: { min: 2, max: 200 },
} as const;

/** One change per kind, validated before the card is shown. */
export const ProposalChangeSchema = /* @__PURE__ */ lazySchema(() =>
	z.discriminatedUnion("kind", [
		z
			.object({
				kind: z.literal("setting"),
				/** An agent-started threads setting; other rows are the user's to change in Settings. */
				key: z.enum([
					"agentsStartThreads",
					"children",
					"perTree",
					"turnsPerDay",
					"pairPerDay",
				]),
				value: z.union([z.string().max(40), z.number().int()]),
			})
			.superRefine((change, ctx) => {
				if (
					typeof change.value !== "number" ||
					change.key === "agentsStartThreads"
				)
					return;
				const { min, max } = THREAD_TREE_RANGES[change.key];
				if (change.value < min || change.value > max)
					ctx.addIssue({
						code: "custom",
						path: ["value"],
						message: `${change.key} takes a value from ${min} to ${max}.`,
					});
			}),
		z.object({
			kind: z.literal("schedule"),
			name: z.string().trim().min(1).max(120),
			brief: z.string().trim().min(1).max(4000),
			/** Five-field cron, in `timezone`. */
			cron: z.string().trim().min(9).max(100),
			timezone: z.string().trim().min(1).max(64).default("UTC"),
		}),
		z.object({
			kind: z.literal("service_link"),
			serviceId: z.string().min(1).max(100),
			repositoryId: z.string().min(1).max(100),
		}),
		z.object({
			kind: z.literal("project_add"),
			/** A folder path or a git URL, as the Add a project dialog takes it. */
			source: z.string().trim().min(1).max(1000),
		}),
	]),
);
export type ProposalChange = z.infer<typeof ProposalChangeSchema>;

/** `applying`: claimed by one click while its change runs, so a second click changes nothing. */
export const ProposalStateSchema = /* @__PURE__ */ lazySchema(() =>
	z.enum(["open", "applying", "applied", "dismissed"]),
);

export const ProposalSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		id: z.string(),
		threadId: z.string(),
		kind: ProposalKindSchema,
		change: ProposalChangeSchema,
		why: z.string().max(1000),
		state: ProposalStateSchema,
		createdAt: z.string(),
		/** Set once applied: what the normal API returned, or why it refused. */
		outcome: z.string().nullable().optional(),
	}),
);
export type Proposal = z.infer<typeof ProposalSchema>;

/** Settings → Agent → Agent-started threads: may start, and its caps (#1101 cat 18). */
export const AgentsStartThreadsSchema = /* @__PURE__ */ lazySchema(() =>
	z.enum(["ask", "allow", "never"]),
);
export type AgentsStartThreads = z.infer<typeof AgentsStartThreadsSchema>;

export const ThreadTreeSettingsSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		agentsStartThreads: AgentsStartThreadsSchema,
		/** At once per starter: running threads one thread's agent started. The key is kept from v0.5. */
		children: z
			.number()
			.int()
			.min(THREAD_TREE_RANGES.children.min)
			.max(THREAD_TREE_RANGES.children.max),
		/** At once in total: running threads any agent started. The key is kept from v0.5. */
		perTree: z
			.number()
			.int()
			.min(THREAD_TREE_RANGES.perTree.min)
			.max(THREAD_TREE_RANGES.perTree.max),
		/** Thread starts and messages agents send each other in 24 hours (#1101 cat 18); each one costs a turn. */
		turnsPerDay: z
			.number()
			.int()
			.min(THREAD_TREE_RANGES.turnsPerDay.min)
			.max(THREAD_TREE_RANGES.turnsPerDay.max),
		/** Messages between one pair of threads in 24 hours; past it they stay unread and wake nothing. */
		pairPerDay: z
			.number()
			.int()
			.min(THREAD_TREE_RANGES.pairPerDay.min)
			.max(THREAD_TREE_RANGES.pairPerDay.max)
			.default(20),
	}),
);
export type ThreadTreeSettings = z.infer<typeof ThreadTreeSettingsSchema>;
/** What a caller sends: a key with a default may be left out. */
export type ThreadTreeSettingsInput = z.input<typeof ThreadTreeSettingsSchema>;

export const THREAD_TREE_DEFAULTS: ThreadTreeSettings = {
	agentsStartThreads: "ask",
	children: 4,
	perTree: 10,
	turnsPerDay: 200,
	pairPerDay: 20,
};

export const ThreadTreeIdSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({ id: z.string().min(1) }),
);
export const ProposalIdSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		id: z.string().min(1),
		pid: z.string().min(1),
	}),
);

/** The transcript's start and message nodes, on both ends of each exchange. */
export const ThreadStartedShape = {
	childId: z.string(),
	/** Older events carry the role a thread was started with. */
	role: z.string().optional(),
	title: z.string(),
	link: z.string(),
};
export const ThreadMessageEventShape = {
	direction: z.enum(["sent", "received"]),
	peerId: z.string(),
	/** Older events name the peer by its role; newer ones by `peerTitle`. */
	peerRole: z.string().optional(),
	peerLink: z.string(),
	type: ThreadMessageKindSchema.optional(),
	text: z.string(),
	mode: ThreadMessageModeSchema,
	/** The peer's title when the event was written; older events carry only its role. */
	peerTitle: z.string().optional(),
	/** Past the pair cap: kept unread, woke nothing (#1101 cat 10). */
	held: z.boolean().optional(),
	/** The `operator_message` that carried it to the agent, when one did. */
	messageId: z.string().optional(),
	/** On the sender's side: what the message did when it was sent (#1101 - cat 10.4). */
	outcome: z.enum(THREAD_MESSAGE_OUTCOMES).optional(),
};
