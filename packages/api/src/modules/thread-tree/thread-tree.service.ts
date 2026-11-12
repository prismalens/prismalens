// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
	Injectable,
	type OnApplicationBootstrap,
	type OnModuleDestroy,
} from "@nestjs/common";
import { ACCESS_LEVELS, type AccessLevel } from "@prismalens/config/harness";
import {
	isWorkflowTerminal,
	LIVE_WORKFLOW_STATUSES,
	RunWorkspaceSchema,
	THREAD_MESSAGE_CHARS,
	type ThreadMessageKind,
	type ThreadMessageMode,
	type ThreadMessageType,
	type ThreadNodeState,
	type ThreadTree,
	type ThreadTreeNode,
} from "@prismalens/contracts";
import type {
	Investigation,
	ThreadMessage as ThreadMessageRow,
} from "@prismalens/database";
import {
	type Failure,
	fail,
	type ToolOutcome,
} from "@prismalens/integrations/harness";
import { Logger } from "@prismalens/logger";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { DispatchService } from "../../infrastructure/dispatch/dispatch.service.js";
import { InvestigationsService } from "../investigations/investigations.service.js";
import { SIDE_QUESTION } from "../threads/side-question.js";
import { actionReason, ThreadsService } from "../threads/threads.service.js";
import { PendingActionsService } from "./pending-actions.service.js";
import { PutOff } from "./put-off.js";
import { isDuplicate, TreeIo } from "./tree-io.service.js";
import { TreeSettings } from "./tree-settings.service.js";

const git = promisify(execFile);
const logger = new Logger({ context: "ThreadTree" });

/** How often queued messages, finished children and approved actions are looked at. */
const TICK_MS = 2_000;
/** Refused reopens of a waiting parent before its wait is dropped: about a minute of ticks. */
const REOPEN_TRIES = 30;
/** Queued messages one delivery pass reads. */
const MESSAGE_BATCH = 100;
/** The roster lines a child's first prompt lists; a bigger tree is cut with a count. */
const ROSTER_LINES = 20;

export type WorkspaceKind =
	| "new_from_parent"
	| "new_from_ref"
	| "same_project_fresh";

export interface StartArgs {
	title: string;
	role: string;
	brief: string;
	agent?: string;
	model?: string;
	effort?: string;
	access?: AccessLevel;
	workspace: { kind: WorkspaceKind; ref?: string };
	requestId: string;
}

export interface SendArgs {
	to: string;
	type: ThreadMessageType;
	text: string;
	mode: ThreadMessageMode;
	requestId: string;
}

type Row = Pick<
	Investigation,
	| "id"
	| "title"
	| "role"
	| "parentId"
	| "rootId"
	| "depth"
	| "status"
	| "incidentId"
	| "scheduleId"
	| "createdAt"
	| "endReason"
>;

const ROW = {
	id: true,
	title: true,
	role: true,
	parentId: true,
	rootId: true,
	depth: true,
	status: true,
	incidentId: true,
	scheduleId: true,
	createdAt: true,
	endReason: true,
} as const;

const LIVE = [...LIVE_WORKFLOW_STATUSES];

type Queued = ThreadMessageRow;

/** The thread's path in the app: what the agent shows the user, never an id alone. */
export function threadLink(row: {
	id: string;
	incidentId: string | null;
	scheduleId: string | null;
}): string {
	if (row.incidentId)
		return `/incidents/${row.incidentId}/conversation?investigation=${row.id}`;
	if (row.scheduleId) return `/schedules/${row.scheduleId}/runs/${row.id}`;
	return `/threads/${row.id}`;
}

export function nodeState(row: { status: string }): ThreadNodeState {
	switch (row.status) {
		case "pending":
			return "queued";
		case "completed":
			return "answered";
		case "failed":
			return "failed";
		case "cancelled":
			return "stopped";
		default:
			return "running";
	}
}

/** How a child ended, as its parent reads it. */
function outcomeOf(row: { status: string; endReason: string | null }) {
	if (row.status === "completed") return "answered" as const;
	if (row.status === "cancelled") return "stopped" as const;
	return row.endReason === "limited" || row.endReason === "blocked"
		? ("limited" as const)
		: ("failed" as const);
}

/** A thread with no children and no parent has nobody to message, wait on or stop. */
const NO_TREE = () =>
	fail(
		"invalid_input",
		"This thread is not in a tree yet: it has started no threads and none started it.",
		"Start a child with thread_start first, or do the work here.",
	);

const cap = (text: string, n = THREAD_MESSAGE_CHARS) =>
	text.length > n ? `${text.slice(0, n - 1)}…` : text;

const rank = (level: AccessLevel) => ACCESS_LEVELS.indexOf(level);

/**
 * Threads that start threads (#1024 spec F): a tree of full threads, its caps, its typed
 * messages and the wake on a child's finish. Completion wakes; nothing polls an agent.
 */

/** A tree of agents messaging each other in a loop stops here, not at the disk. */
export const TREE_MESSAGE_CAP = 500;
@Injectable()
export class ThreadTreeService
	implements OnApplicationBootstrap, OnModuleDestroy
{
	private timer: ReturnType<typeof setInterval> | undefined;
	private ticking: Promise<void> | null = null;
	private readonly reopenTries = new Map<string, number>();
	private readonly putOff = new PutOff();
	private draining: Promise<void> = Promise.resolve();
	/** Children that ended after this were not yet looked at; the first tick reads all. */
	private sweptTo = new Date(0);

	constructor(
		private readonly prisma: PrismaService,
		private readonly threads: ThreadsService,
		private readonly dispatch: DispatchService,
		private readonly investigations: InvestigationsService,
		private readonly settings: TreeSettings,
		private readonly actions: PendingActionsService,
		private readonly io: TreeIo,
	) {
		actions.register("thread_start", {
			check: (caller, args) => this.startRefusal(caller, args as StartArgs),
			run: (caller, args, actionId) =>
				this.startChild(caller, args as StartArgs, actionId),
			already: async (_caller, _args, actionId) =>
				!!(await this.prisma.investigation.findFirst({
					where: { triggerReason: actionReason(actionId) },
					select: { id: true },
				})),
			describe: (args) => {
				const a = args as StartArgs;
				return {
					title: `Start a thread: ${a.title} (${a.role})`,
					detail: cap(a.brief, 1_000),
				};
			},
			done: (_args, value) => {
				const v = value as { role: string; number: number; link: string };
				return `started ${v.role} #${v.number}, ${v.link}. Its result arrives as a message when it finishes.`;
			},
		});
		actions.register("thread_cancel", {
			check: (caller, args) =>
				this.cancelRefusal(caller, (args as { id: string }).id),
			run: (caller, args) =>
				this.cancelMember(caller, args as { id: string; reason: string }),
			// A stop that landed before a crash leaves its target ended; the rerun only reports it.
			already: async (caller, args) => {
				const target = await this.resolveMember(
					caller,
					(args as { id: string }).id,
				);
				return !!target && isWorkflowTerminal(target.status);
			},
			describe: (args) => {
				const a = args as { id: string; reason: string };
				return { title: "Stop a thread in this tree", detail: a.reason };
			},
			done: (_args, value) =>
				`${(value as { link: string }).link} was asked to stop.`,
		});
	}

	onApplicationBootstrap(): void {
		void this.actions
			.resume()
			.catch((e) => logger.warn(`Resuming pending actions failed: ${e}`));
		this.timer = setInterval(() => void this.tick(), TICK_MS);
		this.timer.unref?.();
	}

	onModuleDestroy(): void {
		clearInterval(this.timer);
		this.actions.stop();
	}

	/** One pass: finished children, cancelled callers, then every queued delivery. */
	tick(): Promise<void> {
		this.ticking ??= (async () => {
			try {
				await this.sweepFinished();
				await this.sweepCancelled();
				await this.drain();
				await this.actions.deliverOutcomes();
			} catch (e) {
				logger.warn(`Thread tree tick failed: ${(e as Error).message}`);
			}
		})().finally(() => {
			this.ticking = null;
		});
		return this.ticking;
	}

	private row(id: string): Promise<Row | null> {
		return this.prisma.investigation.findUnique({ where: { id }, select: ROW });
	}

	/**
	 * Every member of a tree, root first, in the order they started. A side question is
	 * hidden from all but itself until it is kept as a fork (#1101 sheet §2).
	 */
	async members(rootId: string, self?: string): Promise<Row[]> {
		const all = await this.prisma.investigation.findMany({
			where: { OR: [{ id: rootId }, { rootId }] },
			orderBy: { createdAt: "asc" },
			select: ROW,
		});
		return all.filter((m) => m.role !== SIDE_QUESTION || m.id === self);
	}

	/** The thread's tree root: itself when no agent started it. */
	rootOf(row: Pick<Row, "id" | "rootId">): string {
		return row.rootId ?? row.id;
	}

	/** True when both threads are members of one tree. */
	async sameTree(a: string, b: string): Promise<boolean> {
		const [x, y] = await Promise.all([this.row(a), this.row(b)]);
		if (!x || !y) return false;
		if (!x.rootId && !y.rootId) return false;
		return this.rootOf(x) === this.rootOf(y);
	}

	async tree(id: string): Promise<ThreadTree | null> {
		const row = await this.row(id);
		if (!row) return null;
		const rootId = this.rootOf(row);
		const members = await this.members(rootId, id);
		const unread = await this.prisma.threadMessage.groupBy({
			by: ["toId"],
			where: { rootId, state: "queued" },
			_count: { _all: true },
		});
		const count = new Map(unread.map((u) => [u.toId, u._count._all]));
		const allowance = await this.prisma.treeAllowance.findUnique({
			where: { rootId },
		});
		return {
			rootId,
			nodes: members.map(
				(m, i): ThreadTreeNode => ({
					id: m.id,
					number: i + 1,
					title: m.title,
					role: m.id === rootId ? null : m.role,
					parentId: m.parentId,
					depth: m.depth,
					state: nodeState(m),
					unread: count.get(m.id) ?? 0,
					link: threadLink(m),
				}),
			),
			allowance: allowance
				? { grantedAt: allowance.grantedAt.toISOString() }
				: null,
		};
	}

	/** A member's name in messages: its role, `root` for the root. */
	private nameOf(m: Row, rootId: string): string {
		return m.id === rootId ? "root" : (m.role ?? "thread");
	}

	/** The roster an agent reads: each member with its relation to `selfId`. */
	async roster(selfId: string) {
		const self = await this.row(selfId);
		if (!self) return null;
		const rootId = this.rootOf(self);
		const members = await this.members(rootId, selfId);
		return {
			self: { number: members.findIndex((m) => m.id === selfId) + 1 },
			members: members.map((m, i) => ({
				number: i + 1,
				role: this.nameOf(m, rootId),
				relation:
					m.id === selfId
						? "you"
						: m.id === self.parentId
							? "parent"
							: m.parentId === selfId
								? "child"
								: m.parentId && m.parentId === self.parentId
									? "sibling"
									: m.id === rootId
										? "root"
										: "member",
				title: m.title,
				state: nodeState(m),
				link: threadLink(m),
			})),
		};
	}

	/** Resolves `to` from an agent: a role, `parent`, `root`, a link or an id, inside the tree. */
	async resolveMember(selfId: string, to: string): Promise<Row | null> {
		const self = await this.row(selfId);
		if (!self) return null;
		const rootId = this.rootOf(self);
		const members = await this.members(rootId, selfId);
		const key = to.trim();
		const byId = key.match(/[0-9a-f]{8}-[0-9a-f-]{27}/i)?.[0];
		if (byId) return members.find((m) => m.id === byId) ?? null;
		const lower = key.toLowerCase();
		if (lower === "parent")
			return members.find((m) => m.id === self.parentId) ?? null;
		if (lower === "root") return members.find((m) => m.id === rootId) ?? null;
		const numbered = lower.match(/^#?(\d+)$/);
		if (numbered) return members[Number(numbered[1]) - 1] ?? null;
		// A role can be reused once its holder ends: the running one wins, then the nearest, then the newest.
		const rank = (m: Row) => [
			isWorkflowTerminal(m.status) ? 1 : 0,
			m.parentId === selfId ? 0 : m.parentId === self.parentId ? 1 : 2,
			-m.createdAt.getTime(),
		];
		const [best] = members
			.filter((m) => m.id !== selfId && m.role?.toLowerCase() === lower)
			.sort((a, b) => {
				const [x, y] = [rank(a), rank(b)];
				return (
					(x[0] ?? 0) - (y[0] ?? 0) ||
					(x[1] ?? 0) - (y[1] ?? 0) ||
					(x[2] ?? 0) - (y[2] ?? 0)
				);
			});
		return best ?? null;
	}

	// ---------- thread_start ----------

	private async startRefusal(
		callerId: string,
		args: StartArgs,
	): Promise<Failure | null> {
		const s = await this.settings.get();
		if (s.agentsStartThreads === "never")
			return fail(
				"disabled",
				"The user turned off starting threads.",
				"Do the work yourself in this thread.",
			);
		const caller = await this.row(callerId);
		if (!caller)
			return fail(
				"run_ended",
				"This thread is gone.",
				"Stop starting threads.",
			);
		// A plain folder has no commits to branch from, so a child would share this thread's folder.
		const project = await this.prisma.investigation.findUnique({
			where: { id: callerId },
			select: { repository: { select: { plain: true } } },
		});
		if (project?.repository?.plain)
			return fail(
				"invalid_input",
				"This project is a plain folder with no git, so a child thread would work in the same folder as this one.",
				"Do the work in this thread, or tell the user that Start git on the project gives children their own worktrees.",
			);
		if (caller.depth + 1 > s.depth)
			return fail(
				"limit_reached",
				`A thread ${caller.depth} levels down may not start threads: the depth cap is ${s.depth}.`,
				"Do the work in this thread, or tell the user the cap is Settings → Agent → Advanced → Thread depth.",
			);
		const children = await this.prisma.investigation.count({
			where: { parentId: callerId, status: { in: LIVE } },
		});
		if (children >= s.children)
			return fail(
				"limit_reached",
				`This thread already has ${children} running children, the cap.`,
				"Wait for one to finish (thread_wait), or cancel one; the cap is Settings → Agent → Advanced → Children per thread.",
			);
		const rootId = this.rootOf(caller);
		const live = await this.prisma.investigation.count({
			where: { OR: [{ id: rootId }, { rootId }], status: { in: LIVE } },
		});
		if (live >= s.perTree)
			return fail(
				"limit_reached",
				`This tree already has ${live} running threads, the cap.`,
				"Wait for one to finish (thread_wait); the cap is Settings → Agent → Advanced → Threads per tree.",
			);
		const taken = await this.prisma.investigation.findFirst({
			where: {
				parentId: callerId,
				role: args.role,
				status: { in: LIVE },
			},
			select: { id: true },
		});
		if (taken)
			return fail(
				"invalid_input",
				`A running child already has the role "${args.role}".`,
				"Pick a role no running child has, or message that child with thread_send.",
			);
		return null;
	}

	/** The child's subject: the parent's project or service; an incident's child gets its service. */
	private async subjectFor(callerId: string) {
		const row = await this.prisma.investigation.findUniqueOrThrow({
			where: { id: callerId },
			select: {
				repositoryId: true,
				serviceId: true,
				accessLevel: true,
				harness: true,
				model: true,
				effort: true,
				workspace: true,
				incident: { select: { serviceId: true } },
			},
		});
		const serviceId = row.incident ? row.incident.serviceId : row.serviceId;
		const subject = row.repositoryId
			? { kind: "project" as const, repositoryId: row.repositoryId }
			: serviceId
				? { kind: "service" as const, serviceId }
				: { kind: "none" as const };
		return { row, subject };
	}

	/** The commit each repo starts at, by the workspace kind; the parent's uncommitted work is never copied. */
	private async pinsFor(
		workspace: string | null,
		kind: WorkspaceKind,
		ref?: string,
	): Promise<Map<string, string> | string | undefined> {
		if (kind === "same_project_fresh") return undefined;
		if (kind === "new_from_ref") return ref;
		const ws = workspace
			? RunWorkspaceSchema.safeParse(JSON.parse(workspace))
			: null;
		if (!ws?.success) return undefined;
		const pins = new Map<string, string>();
		for (const repo of ws.data.repos) {
			let head = repo.head;
			// A folder's worktree shares its objects, so a commit the parent made is reachable.
			if (repo.sourceKind === "folder")
				head =
					(
						await git("git", ["-C", repo.dir, "rev-parse", "HEAD"], {
							timeout: 5_000,
						}).catch(() => ({ stdout: head }))
					).stdout.trim() || head;
			pins.set(repo.url, head);
		}
		return pins;
	}

	private async startChild(
		callerId: string,
		args: StartArgs,
		actionId: string,
	): Promise<ToolOutcome> {
		const caller = await this.row(callerId);
		if (!caller)
			return fail(
				"run_ended",
				"This thread is gone.",
				"Stop starting threads.",
			);
		const rootId = this.rootOf(caller);
		// A retried start finds the thread the first attempt made.
		const existing = await this.prisma.investigation.findFirst({
			where: { triggerReason: actionReason(actionId) },
			select: ROW,
		});
		let childId = existing?.id;
		let queued = false;
		const { row: parent, subject } = await this.subjectFor(callerId);
		const parentLevel =
			(parent.accessLevel as AccessLevel | null) ?? "supervised";
		const asked = args.access ?? parentLevel;
		const access = rank(asked) > rank(parentLevel) ? parentLevel : asked;
		if (!childId) {
			if (!caller.rootId)
				await this.prisma.investigation.update({
					where: { id: callerId },
					data: { rootId: callerId },
				});
			const pins = await this.pinsFor(
				parent.workspace,
				args.workspace.kind,
				args.workspace.ref,
			);
			const brief = await this.firstPrompt(callerId, rootId, args);
			const started = await this.threads.start(
				{
					subject,
					text: brief,
					accessLevel: access,
					...((args.agent ?? parent.harness)
						? { harness: (args.agent ?? parent.harness) as never }
						: {}),
					...((args.model ?? parent.model)
						? { model: args.model ?? parent.model }
						: {}),
					...((args.effort ?? parent.effort)
						? { effort: args.effort ?? parent.effort }
						: {}),
				},
				{
					parentId: callerId,
					rootId,
					role: args.role,
					depth: caller.depth + 1,
					title: args.title,
					actionId,
					...(pins
						? {
								at: (r) => (typeof pins === "string" ? pins : pins.get(r.url)),
							}
						: {}),
				},
			);
			childId = started.investigationId;
			queued = started.queued;
			await this.joined(callerId, rootId, childId);
		}
		const child = (await this.row(childId)) as Row;
		const members = await this.members(rootId, callerId);
		const number = members.findIndex((m) => m.id === childId) + 1;
		const link = threadLink(child);
		// A wait on the pending start now waits on the thread it made.
		const waits = await this.prisma.threadWait.findMany({
			where: { targetId: actionId },
		});
		for (const w of waits) {
			await this.prisma.threadWait
				.create({
					data: { waiterId: w.waiterId, targetId: childId, mode: w.mode },
				})
				.catch((e) => {
					if (!isDuplicate(e)) throw e;
				});
			await this.prisma.threadWait.delete({
				where: {
					waiterId_targetId: { waiterId: w.waiterId, targetId: actionId },
				},
			});
		}
		return {
			value: {
				status: "started",
				childId,
				number,
				role: args.role,
				link,
				state: nodeState(child),
				access,
				...(access !== asked
					? {
							note: `Access was clamped to ${access}: a child never gets more than its parent.`,
						}
					: {}),
				...(args.workspace.kind === "new_from_parent"
					? {
							workspace:
								"A new worktree at your current commit; your uncommitted changes are not in it.",
						}
					: {}),
				...(queued ? { queued: true } : {}),
			},
		};
	}

	/** Records the start on the parent and tells the running siblings. */
	private async joined(parentId: string, rootId: string, childId: string) {
		const child = (await this.row(childId)) as Row;
		const link = threadLink(child);
		await this.io.record(parentId, {
			kind: "thread_started",
			childId,
			role: child.role ?? "thread",
			title: child.title ?? "",
			link,
		});
		const members = await this.members(rootId, parentId);
		const number = members.findIndex((m) => m.id === childId) + 1;
		for (const sib of members) {
			if (sib.parentId !== parentId || sib.id === childId) continue;
			if (!LIVE.includes(sib.status as never)) continue;
			await this.prisma.threadMessage
				.create({
					data: {
						rootId,
						fromId: parentId,
						toId: sib.id,
						type: "fact",
						text: `${child.role} #${number} joined the tree: ${child.title ?? ""} (${link}).`,
						requestId: `joined:${childId}`,
					},
				})
				.catch((e) => {
					if (!isDuplicate(e)) throw e;
				});
		}
	}

	/** The child's only context: the roster, the messaging rules, then the parent's brief. */
	private async firstPrompt(
		callerId: string,
		rootId: string,
		args: StartArgs,
	): Promise<string> {
		const members = await this.members(rootId, callerId);
		const parentNo = members.findIndex((m) => m.id === callerId) + 1;
		const lines = members.slice(0, ROSTER_LINES).map((m, i) => {
			const relation =
				m.id === callerId
					? "your parent"
					: m.parentId === callerId
						? "sibling"
						: m.id === rootId
							? "root"
							: "member";
			return `- ${this.nameOf(m, rootId)} #${i + 1} (${relation}): ${m.title ?? "untitled"} — ${nodeState(m)} — ${threadLink(m)}`;
		});
		if (members.length > ROSTER_LINES)
			lines.push(
				`- and ${members.length - ROSTER_LINES} more; thread_roster lists them.`,
			);
		return [
			`You are "${args.role}", #${members.length + 1} in a tree of threads PrismaLens runs for the user. Your parent is #${parentNo}.`,
			"Members:",
			...lines,
			"Messaging: thread_send to a member's role, `parent` or `root`. Send only what changes the receiver's work (handoff, blocker, fact, question, reply); never acknowledge; reply only to a question. Your final answer goes to your parent when you finish. Show the user links, not ids.",
			"",
			args.brief,
		].join("\n");
	}

	// ---------- thread_send ----------

	async send(callerId: string, args: SendArgs): Promise<ToolOutcome> {
		const self = await this.row(callerId);
		if (!self)
			return fail("run_ended", "This thread is gone.", "Stop messaging.");
		if (!self.rootId) return NO_TREE();
		const rootId = this.rootOf(self);
		const to = await this.resolveMember(callerId, args.to);
		if (!to || to.id === callerId)
			return fail(
				"not_found",
				`No member "${args.to}" in this thread's tree.`,
				"Call thread_roster and pass a role, `parent` or `root` exactly as it lists them.",
			);
		if (
			args.mode === "steer" &&
			!(args.type === "blocker" && to.parentId === callerId)
		)
			return fail(
				"invalid_input",
				"Only a parent's blocker to its own child may steer.",
				"Send it again with mode `queue`.",
			);
		const sent = await this.prisma.threadMessage.count({ where: { rootId } });
		const retried =
			sent >= TREE_MESSAGE_CAP &&
			(await this.prisma.threadMessage.findUnique({
				where: {
					fromId_requestId: { fromId: callerId, requestId: args.requestId },
				},
			}));
		if (retried)
			return {
				value: {
					status: retried.state,
					messageId: retried.id,
					link: threadLink((await this.row(retried.toId)) ?? to),
				},
			};
		if (sent >= TREE_MESSAGE_CAP)
			return fail(
				"limit_reached",
				`This thread tree has sent ${TREE_MESSAGE_CAP} messages, its limit.`,
				"Finish with what you have, and put anything left in your result.",
			);
		let message: { id: string; createdAt: Date };
		try {
			message = await this.prisma.threadMessage.create({
				data: {
					rootId,
					fromId: callerId,
					toId: to.id,
					type: args.type,
					text: args.text,
					mode: args.mode,
					requestId: args.requestId,
				},
			});
		} catch (e) {
			if (!isDuplicate(e)) throw e;
			const seen = await this.prisma.threadMessage.findUniqueOrThrow({
				where: {
					fromId_requestId: { fromId: callerId, requestId: args.requestId },
				},
			});
			return {
				value: {
					status: seen.state,
					messageId: seen.id,
					// The stored recipient: a role reused since the first send names someone else now.
					link: threadLink((await this.row(seen.toId)) ?? to),
				},
			};
		}
		await this.io.record(callerId, {
			kind: "thread_message",
			direction: "sent",
			peerId: to.id,
			peerRole: this.nameOf(to, rootId),
			peerLink: threadLink(to),
			type: args.type,
			text: args.text,
			mode: args.mode,
		});
		await this.drain();
		const now = await this.prisma.threadMessage.findUniqueOrThrow({
			where: { id: message.id },
		});
		return {
			value: {
				status: now.state,
				messageId: now.id,
				link: threadLink(to),
				...(now.state === "queued" && isWorkflowTerminal(to.status)
					? {
							note: `${this.nameOf(to, rootId)} has ended; it gets this when it next runs.`,
						}
					: {}),
			},
		};
	}

	/** The text an agent receives for a message. */
	private async formatted(m: {
		fromId: string;
		rootId: string;
		type: string;
		text: string;
	}): Promise<string> {
		const members = await this.members(m.rootId, m.fromId);
		const i = members.findIndex((x) => x.id === m.fromId);
		const from = members[i];
		const name = from ? this.nameOf(from, m.rootId) : "thread";
		return `[FROM ${name} #${i + 1}] ${m.type}: ${m.text}`;
	}

	/** Hands every queued message to its receiver; a result reopens a parent that waits on it. */
	/** Tick and send both drain; passes run one after another, so no message is sent twice. */
	drain(): Promise<void> {
		const pass = this.draining.then(
			() => this.drainOnce(),
			() => this.drainOnce(),
		);
		this.draining = pass.catch(() => {});
		return pass;
	}

	private async drainOnce(): Promise<void> {
		// Only receivers that can take a message now: a message parked on an ended thread waits for its next run.
		const receivers = (
			await this.prisma.threadMessage.findMany({
				where: { state: "queued" },
				distinct: ["toId"],
				select: { toId: true },
			})
		).map((r) => r.toId);
		if (!receivers.length) return;
		const [running, waiting] = await Promise.all([
			this.prisma.investigation.findMany({
				where: { id: { in: receivers }, status: { in: LIVE } },
				select: { id: true },
			}),
			this.prisma.threadWait.findMany({
				where: { waiterId: { in: receivers } },
				distinct: ["waiterId"],
				select: { waiterId: true },
			}),
		]);
		const queued = await this.prisma.threadMessage.findMany({
			where: {
				state: "queued",
				id: { notIn: this.putOff.skip() },
				OR: [
					{ toId: { in: running.map((r) => r.id) } },
					{ toId: { in: waiting.map((w) => w.waiterId) }, type: "result" },
				],
			},
			orderBy: { createdAt: "asc" },
			take: MESSAGE_BATCH,
		});
		try {
			await this.deliverEach(queued);
		} finally {
			this.putOff.settle(queued.length, MESSAGE_BATCH);
		}
	}

	private async deliverEach(queued: Queued[]): Promise<void> {
		for (const m of queued) {
			try {
				await this.deliverMessage(m);
			} catch (e) {
				// One failing delivery is put off and logged; the rest of the pass goes on.
				logger.warn(
					`Could not deliver tree message ${m.id} to ${m.toId}: ${(e as Error).message}`,
				);
				this.putOff.defer(m.id);
				// A result's failed reopen counts like a refused one, so it is given up after REOPEN_TRIES.
				if (m.type === "result") await this.refusedReopen(m).catch(() => {});
			}
		}
	}

	private async deliverMessage(m: Queued): Promise<void> {
		const reopen = m.type === "result" && (await this.wakes(m.toId, m.fromId));
		const got = await this.io.deliver(m.toId, await this.formatted(m), {
			steer: m.mode === "steer",
			reopen,
		});
		if (reopen && got.state === "later") await this.refusedReopen(m);
		if (got.state !== "delivered") {
			this.putOff.defer(m.id);
			return;
		}
		this.reopenTries.delete(m.id);
		await this.prisma.threadMessage.update({
			where: { id: m.id },
			data: { state: "delivered", deliveredAt: new Date() },
		});
		if (reopen)
			await this.prisma.threadWait.deleteMany({
				where: { waiterId: m.toId },
			});
		if (m.type === "result") return;
		const from = await this.row(m.fromId);
		if (!from) return;
		await this.io.record(m.toId, {
			kind: "thread_message",
			direction: "received",
			peerId: from.id,
			peerRole: this.nameOf(from, m.rootId),
			peerLink: threadLink(from),
			type: m.type as ThreadMessageKind,
			text: m.text,
			mode: m.mode as ThreadMessageMode,
			messageId: got.messageId,
		});
	}

	/** After REOPEN_TRIES refused reopens the parent stops waiting; its result stays for its next run. */
	private async refusedReopen(m: { id: string; toId: string; fromId: string }) {
		const tries = (this.reopenTries.get(m.id) ?? 0) + 1;
		this.reopenTries.set(m.id, tries);
		if (tries < REOPEN_TRIES) return;
		this.reopenTries.delete(m.id);
		logger.info(
			`Gave up reopening ${m.toId} for a child's result after ${tries} tries`,
		);
		await this.prisma.threadWait.deleteMany({
			where: { waiterId: m.toId, targetId: m.fromId },
		});
	}

	/** Whether a result from `childId` reopens `parentId`: it waits on it, and on all when `all`. */
	private async wakes(parentId: string, childId: string): Promise<boolean> {
		const waits = await this.prisma.threadWait.findMany({
			where: { waiterId: parentId },
		});
		if (!waits.some((w) => w.targetId === childId)) return false;
		if (!waits.some((w) => w.mode === "all")) return true;
		const ids = waits.map((w) => w.targetId);
		const [threads, starts] = await Promise.all([
			this.prisma.investigation.findMany({
				where: { id: { in: ids } },
				select: { id: true, status: true },
			}),
			this.prisma.pendingAction.findMany({
				where: { id: { in: ids } },
				select: { id: true, state: true },
			}),
		]);
		// A start still waiting is not over; one that ended without a thread will never finish.
		return ids.every((id) => {
			const thread = threads.find((t) => t.id === id);
			if (thread) return isWorkflowTerminal(thread.status);
			const start = starts.find((s) => s.id === id);
			return (
				!!start &&
				["denied", "expired", "cancelled", "failed"].includes(start.state)
			);
		});
	}

	// ---------- finishing ----------

	/** Each child that ended since the last pass sends its parent a result, once per end. */
	async sweepFinished(): Promise<void> {
		const since = this.sweptTo;
		const now = new Date();
		const ended = await this.prisma.investigation.findMany({
			where: {
				parentId: { not: null },
				status: { in: ["completed", "failed", "cancelled"] },
				completedAt: { gte: new Date(since.getTime() - 60_000) },
			},
			select: { ...ROW, completedAt: true, summary: true },
		});
		for (const child of ended) {
			// A side question answers beside its parent: never into its transcript or its agent (#1101 sheet §2).
			if (child.role === SIDE_QUESTION) continue;
			const parentId = child.parentId as string;
			const rootId = this.rootOf(child);
			const outcome = outcomeOf(child);
			const excerpt = cap(
				(await this.finalText(child.id)) ?? child.summary ?? "",
			);
			const link = threadLink(child);
			try {
				await this.prisma.threadMessage.create({
					data: {
						rootId,
						fromId: child.id,
						toId: parentId,
						type: "result",
						text: `${link} finished: ${outcome}.${excerpt ? `\n${excerpt}` : ""}`,
						requestId: `result:${child.completedAt?.toISOString()}`,
					},
				});
			} catch (e) {
				if (isDuplicate(e)) continue;
				throw e;
			}
			await this.io.record(parentId, {
				kind: "child_finished",
				childId: child.id,
				link,
				role: child.role ?? "thread",
				outcome,
				excerpt,
			});
		}
		this.sweptTo = now;
		await this.settleAllowances();
	}

	/** The agent's last words in a thread, from its events. */
	private async finalText(id: string): Promise<string | null> {
		const rows = await this.prisma.investigationEvent.findMany({
			where: {
				investigationId: id,
				event: { contains: '"kind":"agent_step"' },
			},
			orderBy: { seq: "desc" },
			take: 5,
			select: { event: true },
		});
		for (const r of rows) {
			try {
				const e = JSON.parse(r.event) as { text?: string };
				if (e.text?.trim()) return e.text.trim();
			} catch {}
		}
		return null;
	}

	/** An allowance ends when its tree settles: nothing in it runs. */
	private async settleAllowances(): Promise<void> {
		const all = await this.prisma.treeAllowance.findMany();
		for (const a of all) {
			const live = await this.prisma.investigation.count({
				where: {
					OR: [{ id: a.rootId }, { rootId: a.rootId }],
					status: { in: LIVE },
				},
			});
			if (!live)
				await this.prisma.treeAllowance.deleteMany({
					where: { rootId: a.rootId },
				});
		}
	}

	/** A cancelled caller's actions wait on nobody. */
	private async sweepCancelled(): Promise<void> {
		const open = await this.prisma.pendingAction.findMany({
			where: { state: "pending" },
			select: { callerId: true },
			distinct: ["callerId"],
		});
		if (!open.length) return;
		const cancelled = await this.prisma.investigation.findMany({
			where: { id: { in: open.map((o) => o.callerId) }, status: "cancelled" },
			select: { id: true },
		});
		for (const c of cancelled) await this.actions.cancelFor(c.id);
	}

	// ---------- thread_wait ----------

	async wait(
		callerId: string,
		ids: string[],
		mode: "any" | "all",
	): Promise<ToolOutcome> {
		const self = await this.row(callerId);
		if (!self)
			return fail("run_ended", "This thread is gone.", "Stop waiting.");
		// A first start still waiting for approval is worth a wait before any tree exists.
		if (
			!self.rootId &&
			!(await this.prisma.pendingAction.count({
				where: {
					callerId,
					tool: "thread_start",
					state: { in: ["pending", "approved", "executing"] },
				},
			}))
		)
			return NO_TREE();
		const targets: {
			key: string;
			targetId: string;
			state: string;
			link?: string;
		}[] = [];
		for (const key of ids) {
			const action = await this.prisma.pendingAction.findFirst({
				where: {
					callerId,
					tool: "thread_start",
					OR: [{ requestId: key }, { id: key }],
				},
			});
			if (action) {
				const childId = action.result
					? (JSON.parse(action.result) as { childId?: string }).childId
					: undefined;
				if (childId) {
					const child = await this.row(childId);
					if (child) {
						targets.push({
							key,
							targetId: child.id,
							state: nodeState(child),
							link: threadLink(child),
						});
						continue;
					}
				}
				if (
					action.state === "pending" ||
					action.state === "approved" ||
					action.state === "executing"
				) {
					targets.push({ key, targetId: action.id, state: "pending_approval" });
					continue;
				}
				return fail(
					"not_found",
					`The start "${key}" ended without a thread (${action.state}).`,
					"Drop it from `ids` and call thread_wait again.",
				);
			}
			const member = await this.resolveMember(callerId, key);
			if (!member || member.parentId !== callerId)
				return fail(
					"not_found",
					`"${key}" is not a child of this thread.`,
					"Pass a child's role or link from thread_roster, or a thread_start requestId.",
				);
			targets.push({
				key,
				targetId: member.id,
				state: nodeState(member),
				link: threadLink(member),
			});
		}
		for (const t of targets)
			await this.prisma.threadWait.upsert({
				where: {
					waiterId_targetId: { waiterId: callerId, targetId: t.targetId },
				},
				create: { waiterId: callerId, targetId: t.targetId, mode },
				update: { mode },
			});
		return {
			value: {
				waiting: targets.map(({ key, state, link }) => ({
					id: key,
					state,
					...(link ? { link } : {}),
				})),
				mode,
				next: "Registered. Do not poll: each result arrives as a message at your next pause, and if you have ended, your thread reopens for it.",
			},
		};
	}

	async revokeAllowance(rootId: string): Promise<void> {
		await this.prisma.treeAllowance.deleteMany({ where: { rootId } });
	}

	// ---------- thread_cancel ----------

	private async cancelRefusal(
		callerId: string,
		id: string,
	): Promise<Failure | null> {
		if (!(await this.row(callerId))?.rootId) return NO_TREE();
		const target = await this.resolveMember(callerId, id);
		if (!target || !(await this.isDescendant(target, callerId)))
			return fail(
				"not_found",
				`"${id}" is not a thread this one started.`,
				"Pass the role or link of a child from thread_roster.",
			);
		if (isWorkflowTerminal(target.status))
			return fail(
				"invalid_input",
				`${threadLink(target)} has already ended.`,
				"Nothing to cancel; continue.",
			);
		return null;
	}

	private async isDescendant(row: Row, ancestorId: string): Promise<boolean> {
		let cur: Row | null = row;
		for (let i = 0; cur && i < 10; i++) {
			if (cur.parentId === ancestorId) return true;
			cur = cur.parentId ? await this.row(cur.parentId) : null;
		}
		return false;
	}

	private async cancelMember(
		callerId: string,
		args: { id: string; reason: string },
	): Promise<ToolOutcome> {
		const target = (await this.resolveMember(callerId, args.id)) as Row;
		await this.stop(target.id, args.reason);
		await this.actions.cancelFor(target.id);
		return { value: { status: "stopping", link: threadLink(target) } };
	}

	/** Stops a thread as the Stop button does. */
	private async stop(id: string, reason: string): Promise<void> {
		const row = await this.row(id);
		if (!row || isWorkflowTerminal(row.status)) return;
		const why = `Stopped by its parent: ${cap(reason, 200)}`;
		if (
			row.status === "pending" &&
			(await this.dispatch.cancelPendingJob(id))
		) {
			await this.investigations.cancelPending(id, row.incidentId, why);
			return;
		}
		await this.investigations.markStopRequested(id);
		if ((await this.dispatch.requestCancel(id)) === 0) {
			await this.dispatch.cancelOrphanedRun(id);
			await this.investigations.cancelPending(id, row.incidentId, why);
		}
	}
}
