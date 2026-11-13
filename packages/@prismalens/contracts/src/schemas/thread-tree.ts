// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Threads that start threads (#1024 spec F): an agent starts sibling threads and messages
 * any thread it can read, as a person would, inside the user's caps (#1101 cat 10).
 */
import { z } from "zod";

/** A message's stored type: plain `message` now; older rows carry a typed kind or a finished thread's `result`. */
export const ThreadMessageKindSchema = z.enum([
	"message",
	"handoff",
	"blocker",
	"fact",
	"question",
	"reply",
	"result",
]);
export type ThreadMessageKind = z.infer<typeof ThreadMessageKindSchema>;

/** `steer` delivers now and cancels the receiver's step, from any sender, as a person's steer does. */
export const ThreadMessageModeSchema = z.enum(["queue", "steer"]);
export type ThreadMessageMode = z.infer<typeof ThreadMessageModeSchema>;

/** The longest message text, and the longest result excerpt a parent receives. */
export const THREAD_MESSAGE_CHARS = 2_000;

/** A linked thread's state, as its status mark rings it. */
export const ThreadNodeStateSchema = z.enum([
	"queued",
	"running",
	"answered",
	"failed",
	"stopped",
]);
export type ThreadNodeState = z.infer<typeof ThreadNodeStateSchema>;

/** A thread at one end of a start: the one that started this one, or one it started. */
export const ThreadLinkSchema = z.object({
	id: z.string(),
	title: z.string().nullable(),
	/** The thread's path in the app, never an id alone. */
	link: z.string(),
	state: ThreadNodeStateSchema,
	harness: z.string().nullable().optional(),
	startedAt: z.string().nullable().optional(),
	/** Messages to it not yet delivered. */
	unread: z.number().int().min(0),
});
export type ThreadLink = z.infer<typeof ThreadLinkSchema>;

/** Who started a thread, or the thread a person forked it from. */
export const StartedByViaSchema = z.enum(["agent", "fork"]);
export type StartedByVia = z.infer<typeof StartedByViaSchema>;

/** Settings → Agent → Agent-started threads, as a thread runs under them. */
export const ThreadLimitsSchema = z.object({
	agentsStartThreads: z.enum(["ask", "allow", "never"]),
	perStarter: z.number().int(),
	total: z.number().int(),
	turnsPerDay: z.number().int(),
	pairPerDay: z.number().int(),
});

/** A thread's start links (#1101 cat 10): threads are flat siblings, never a tree. */
export const ThreadLinksSchema = z.object({
	/** Null for a thread a person started. */
	startedBy: ThreadLinkSchema.extend({ via: StartedByViaSchema }).nullable(),
	/** Threads its agent started, oldest first; forks and side questions are not listed. */
	started: z.array(ThreadLinkSchema),
	/** "Allow for this chain" is in force (host only, revocable); keyed by where the chain began. */
	allowance: z.object({ grantedAt: z.string() }).nullable(),
	/** Where the start chain began: the allowance's key. */
	chainId: z.string(),
	limits: ThreadLimitsSchema,
});
export type ThreadLinks = z.infer<typeof ThreadLinksSchema>;

/** What `pl_propose_action` may propose; the user's click applies it through the normal API. */
export const PROPOSAL_KINDS = [
	"setting",
	"schedule",
	"service_link",
	"project_add",
] as const;
export const ProposalKindSchema = z.enum(PROPOSAL_KINDS);
export type ProposalKind = z.infer<typeof ProposalKindSchema>;

/** One change per kind, validated before the card is shown. */
export const ProposalChangeSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("setting"),
		/** An agent-started threads setting; other rows are the user's to change in Settings. */
		key: z.enum([
			"agentsStartThreads",
			"children",
			"perTree",
			"turnsPerDay",
			"pairPerDay",
		]),
		value: z.union([z.string().max(40), z.number().int().min(0).max(100)]),
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
]);
export type ProposalChange = z.infer<typeof ProposalChangeSchema>;

/** `applying`: claimed by one click while its change runs, so a second click changes nothing. */
export const ProposalStateSchema = z.enum([
	"open",
	"applying",
	"applied",
	"dismissed",
]);

export const ProposalSchema = z.object({
	id: z.string(),
	threadId: z.string(),
	kind: ProposalKindSchema,
	change: ProposalChangeSchema,
	why: z.string().max(1000),
	state: ProposalStateSchema,
	createdAt: z.string(),
	/** Set once applied: what the normal API returned, or why it refused. */
	outcome: z.string().nullable().optional(),
});
export type Proposal = z.infer<typeof ProposalSchema>;

/** Settings → Agent → Agent-started threads: may start, and its caps (#1101 cat 18). */
export const AgentsStartThreadsSchema = z.enum(["ask", "allow", "never"]);
export type AgentsStartThreads = z.infer<typeof AgentsStartThreadsSchema>;

export const ThreadTreeSettingsSchema = z.object({
	agentsStartThreads: AgentsStartThreadsSchema,
	/** At once per starter: running threads one thread's agent started. The key is kept from v0.5. */
	children: z.number().int().min(1).max(20),
	/** At once in total: running threads any agent started. The key is kept from v0.5. */
	perTree: z.number().int().min(2).max(50),
	/** Thread starts and messages agents send each other in 24 hours (#1101 cat 18); each one costs a turn. */
	turnsPerDay: z.number().int().min(10).max(1000),
	/** Messages between one pair of threads in 24 hours; past it they stay unread and wake nothing. */
	pairPerDay: z.number().int().min(2).max(200).default(20),
});
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

export const ThreadTreeIdSchema = z.object({ id: z.string().min(1) });
export const ProposalIdSchema = z.object({
	id: z.string().min(1),
	pid: z.string().min(1),
});

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
};
