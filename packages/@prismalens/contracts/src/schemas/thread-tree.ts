// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Threads that start threads (#1024 spec F): a run's agent starts child threads,
 * messages its tree, and is woken when a child finishes, inside the user's caps.
 */
import { z } from "zod";

/** What a tree member's message is; there is no status type, by design. */
export const THREAD_MESSAGE_TYPES = [
	"handoff",
	"blocker",
	"fact",
	"question",
	"reply",
] as const;
export const ThreadMessageTypeSchema = z.enum(THREAD_MESSAGE_TYPES);
export type ThreadMessageType = z.infer<typeof ThreadMessageTypeSchema>;

/** A child's end, as its parent hears it. */
export const ThreadMessageKindSchema = z.enum([
	...THREAD_MESSAGE_TYPES,
	"result",
]);
export type ThreadMessageKind = z.infer<typeof ThreadMessageKindSchema>;

/** `steer` delivers now and cancels the receiver's step: a parent's blocker to its child only. */
export const ThreadMessageModeSchema = z.enum(["queue", "steer"]);
export type ThreadMessageMode = z.infer<typeof ThreadMessageModeSchema>;

/** The longest message text, and the longest result excerpt a parent receives. */
export const THREAD_MESSAGE_CHARS = 2_000;

export const ThreadRoleSchema = z
	.string()
	.trim()
	.min(1)
	.max(40)
	.regex(/^[a-z0-9][a-z0-9 _-]*$/i, "letters, digits, space, - and _");

/** A tree member's state, as the panel rings it. */
export const ThreadNodeStateSchema = z.enum([
	"queued",
	"running",
	"answered",
	"failed",
	"stopped",
]);
export type ThreadNodeState = z.infer<typeof ThreadNodeStateSchema>;

export const ThreadTreeNodeSchema = z.object({
	id: z.string(),
	/** The thread's number in its tree, root first: `#1`, `#2`… */
	number: z.number().int().min(1),
	title: z.string().nullable(),
	/** Null on the root. */
	role: z.string().nullable(),
	parentId: z.string().nullable(),
	depth: z.number().int().min(0),
	state: ThreadNodeStateSchema,
	/** Messages to this thread not yet delivered. */
	unread: z.number().int().min(0),
	/** The thread's path in the app, never an id alone. */
	link: z.string(),
});
export type ThreadTreeNode = z.infer<typeof ThreadTreeNodeSchema>;

export const ThreadTreeSchema = z.object({
	rootId: z.string(),
	nodes: z.array(ThreadTreeNodeSchema),
	/** "Allow for this thread tree" is in force (host only, revocable). */
	allowance: z.object({ grantedAt: z.string() }).nullable(),
});
export type ThreadTree = z.infer<typeof ThreadTreeSchema>;

export const ThreadMessageSchema = z.object({
	id: z.string(),
	fromId: z.string(),
	toId: z.string(),
	type: ThreadMessageKindSchema,
	text: z.string().max(THREAD_MESSAGE_CHARS * 2),
	mode: ThreadMessageModeSchema,
	state: z.enum(["queued", "delivered", "withdrawn"]),
	createdAt: z.string(),
	deliveredAt: z.string().nullable().optional(),
});
export type ThreadMessage = z.infer<typeof ThreadMessageSchema>;

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
		/** A thread-tree setting; other rows are the user's to change in Settings. */
		key: z.enum(["agentsStartThreads", "depth", "children", "perTree"]),
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

/** Settings → Agent → "Agents may start threads", and its Advanced caps (#932). */
export const AgentsStartThreadsSchema = z.enum(["ask", "allow", "never"]);
export type AgentsStartThreads = z.infer<typeof AgentsStartThreadsSchema>;

export const ThreadTreeSettingsSchema = z.object({
	agentsStartThreads: AgentsStartThreadsSchema,
	/** A thread's children may start children up to this depth below the root. */
	depth: z.number().int().min(1).max(5),
	/** Live children one thread may have. */
	children: z.number().int().min(1).max(20),
	/** Live threads in one tree, the root included. */
	perTree: z.number().int().min(2).max(50),
});
export type ThreadTreeSettings = z.infer<typeof ThreadTreeSettingsSchema>;

export const THREAD_TREE_DEFAULTS: ThreadTreeSettings = {
	agentsStartThreads: "ask",
	depth: 2,
	children: 4,
	perTree: 10,
};

export const ThreadTreeIdSchema = z.object({ id: z.string().min(1) });
export const ProposalIdSchema = z.object({
	id: z.string().min(1),
	pid: z.string().min(1),
});

/** The transcript's tree nodes, on both ends of each exchange. */
export const ThreadStartedShape = {
	childId: z.string(),
	role: z.string(),
	title: z.string(),
	link: z.string(),
};
export const ThreadMessageEventShape = {
	direction: z.enum(["sent", "received"]),
	peerId: z.string(),
	peerRole: z.string(),
	peerLink: z.string(),
	type: ThreadMessageKindSchema,
	text: z.string(),
	mode: ThreadMessageModeSchema,
	/** The `operator_message` that carried it to the agent, when one did. */
	messageId: z.string().optional(),
};
export const ChildFinishedShape = {
	childId: z.string(),
	link: z.string(),
	role: z.string(),
	outcome: z.enum(["answered", "failed", "stopped", "limited"]),
	excerpt: z.string(),
};
