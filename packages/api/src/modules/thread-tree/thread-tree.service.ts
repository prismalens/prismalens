// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
	Injectable,
	type OnApplicationBootstrap,
	type OnModuleDestroy,
	Optional,
} from "@nestjs/common";
import { ACCESS_LEVELS, type AccessLevel } from "@prismalens/config/harness";
import {
	isWorkflowTerminal,
	LIVE_WORKFLOW_STATUSES,
	RunWorkspaceSchema,
	THREAD_MESSAGE_CHARS,
	type ThreadLink,
	type ThreadLinks,
	type ThreadMessageMode,
	type ThreadNodeState,
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
import { storedUseDefault } from "../../core/harness/harness.service.js";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { DispatchService } from "../../infrastructure/dispatch/dispatch.service.js";
import { InvestigationsService } from "../investigations/investigations.service.js";
import { isSettled } from "../threads/settled.js";
import { SIDE_QUESTION } from "../threads/side-question.js";
import { actionReason, ThreadsService } from "../threads/threads.service.js";
import { InboxService } from "../wakes/inbox.service.js";
import { PendingActionsService } from "./pending-actions.service.js";
import { PutOff } from "./put-off.js";
import { isDuplicate, TreeIo } from "./tree-io.service.js";
import { TreeSettings } from "./tree-settings.service.js";
import { threadLink, treeMessageText } from "./tree-text.js";

export { threadLink };

const git = promisify(execFile);
const logger = new Logger({ context: "ThreadTree" });

/** How often queued messages and approved actions are looked at. */
const TICK_MS = 2_000;
/** Queued messages one delivery pass reads. */
const MESSAGE_BATCH = 100;

export type WorkspaceKind =
	| "new_from_parent"
	| "new_from_ref"
	| "same_project_fresh";

export interface StartArgs {
	title: string;
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
	| "startedAt"
	| "harness"
	| "settledAt"
	| "lastActivityAt"
	| "updatedAt"
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
	startedAt: true,
	harness: true,
	settledAt: true,
	lastActivityAt: true,
	updatedAt: true,
} as const;

const LIVE = [...LIVE_WORKFLOW_STATUSES];

/** A person's fork and a side question also carry `parentId`; neither was started by an agent. */
const NOT_AGENT_STARTED = ["fork", SIDE_QUESTION];
const AGENT_ROLE = {
	OR: [{ role: null }, { role: { notIn: NOT_AGENT_STARTED } }],
};
const AGENT_STARTED = { parentId: { not: null }, ...AGENT_ROLE };

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

const cap = (text: string, n = THREAD_MESSAGE_CHARS) =>
	text.length > n ? `${text.slice(0, n - 1)}…` : text;

const rank = (level: AccessLevel) => ACCESS_LEVELS.indexOf(level);

const DAY_MS = 24 * 60 * 60 * 1000;

const nameOf = (row: { title: string | null }) =>
	row.title?.trim() || "a thread";

/** Answers whether `runId` may read `threadId`: its subject's records, or a thread linked to it. */
export type CanRead = (runId: string, threadId: string) => Promise<boolean>;

/**
 * Threads that start threads (#1101 cat 10): flat siblings. An agent starts a thread and
 * messages any thread it can read, as a person would, inside the user's caps.
 */
@Injectable()
export class ThreadTreeService
	implements OnApplicationBootstrap, OnModuleDestroy
{
	private timer: ReturnType<typeof setInterval> | undefined;
	private ticking: Promise<void> | null = null;
	private readonly putOff = new PutOff();
	private draining: Promise<void> = Promise.resolve();
	/** Set by the gateway binding; until then only linked threads are readable. */
	canRead: CanRead = (a, b) => this.linked(a, b);

	constructor(
		private readonly prisma: PrismaService,
		private readonly threads: ThreadsService,
		private readonly dispatch: DispatchService,
		private readonly investigations: InvestigationsService,
		private readonly settings: TreeSettings,
		private readonly actions: PendingActionsService,
		private readonly io: TreeIo,
		@Optional() private readonly inbox?: InboxService,
	) {
		actions.register("pl_thread_start", {
			check: (caller) => this.startRefusal(caller),
			run: (caller, args, actionId) =>
				this.startThread(caller, args as StartArgs, actionId),
			already: async (_caller, _args, actionId) =>
				!!(await this.prisma.investigation.findFirst({
					where: { triggerReason: actionReason(actionId) },
					select: { id: true },
				})),
			describe: (args) => {
				const a = args as StartArgs;
				return {
					title: `Start a thread: ${a.title}`,
					detail: cap(a.brief, 1_000),
				};
			},
			done: (_args, value) =>
				`started ${(value as { link: string }).link}. Nothing comes back by itself: it messages you only if its brief asks it to.`,
		});
		actions.register("pl_thread_cancel", {
			check: (caller, args) =>
				this.cancelRefusal(caller, (args as { id: string }).id),
			run: (caller, args) =>
				this.cancelThread(caller, args as { id: string; reason: string }),
			// A stop that landed before a crash leaves its target ended; the rerun only reports it.
			already: async (caller, args) => {
				const target = await this.resolve(caller, (args as { id: string }).id);
				return !!target && isWorkflowTerminal(target.status);
			},
			describe: (args) => {
				const a = args as { id: string; reason: string };
				return { title: "Stop a thread", detail: a.reason };
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

	/** One pass: cancelled callers, every queued delivery, then approved actions. */
	tick(): Promise<void> {
		this.ticking ??= (async () => {
			try {
				await this.sweepCancelled();
				await this.drain();
				await this.actions.deliverOutcomes();
				await this.settleAllowances();
			} catch (e) {
				logger.warn(`Thread tick failed: ${(e as Error).message}`);
			}
		})().finally(() => {
			this.ticking = null;
		});
		return this.ticking;
	}

	private row(id: string): Promise<Row | null> {
		return this.prisma.investigation.findUnique({ where: { id }, select: ROW });
	}

	/** Where a thread's start chain began: the allowance's key. */
	chainOf(row: Pick<Row, "id" | "rootId">): string {
		return row.rootId ?? row.id;
	}

	/** One started by the other, or a message between them either way. */
	async linked(a: string, b: string): Promise<boolean> {
		if (a === b) return true;
		const [started, messaged] = await Promise.all([
			this.prisma.investigation.count({
				where: {
					OR: [
						{ id: a, parentId: b },
						{ id: b, parentId: a },
					],
				},
			}),
			this.prisma.threadMessage.count({
				where: {
					OR: [
						{ fromId: a, toId: b },
						{ fromId: b, toId: a },
					],
				},
			}),
		]);
		return started + messaged > 0;
	}

	private async linkOf(m: Row): Promise<ThreadLink> {
		return {
			id: m.id,
			title: m.title,
			link: threadLink(m),
			state: nodeState(m),
			harness: m.harness,
			startedAt: (m.startedAt ?? m.createdAt).toISOString(),
			unread: await this.prisma.threadMessage.count({
				where: { toId: m.id, state: "queued" },
			}),
		};
	}

	/** Who started a thread and the threads it started, for its details card. */
	async links(id: string): Promise<ThreadLinks | null> {
		const row = await this.row(id);
		if (!row) return null;
		const starter = row.parentId ? await this.row(row.parentId) : null;
		const started = await this.prisma.investigation.findMany({
			where: { parentId: id, ...AGENT_ROLE },
			orderBy: { createdAt: "asc" },
			select: ROW,
		});
		const chainId = this.chainOf(row);
		const allowance = await this.prisma.treeAllowance.findUnique({
			where: { rootId: chainId },
		});
		const s = await this.settings.get();
		return {
			startedBy: starter
				? {
						...(await this.linkOf(starter)),
						via:
							row.role && NOT_AGENT_STARTED.includes(row.role)
								? "fork"
								: "agent",
					}
				: null,
			started: await Promise.all(started.map((m) => this.linkOf(m))),
			allowance: allowance
				? { grantedAt: allowance.grantedAt.toISOString() }
				: null,
			chainId,
			limits: {
				agentsStartThreads: s.agentsStartThreads,
				perStarter: s.children,
				total: s.perTree,
				turnsPerDay: s.turnsPerDay,
				pairPerDay: s.pairPerDay,
			},
		};
	}

	/** One thread as a link row. */
	async self(id: string): Promise<ThreadLink> {
		return this.linkOf((await this.row(id)) as Row);
	}

	/** Resolves `to` from an agent: a link, an id, or `starter`. */
	async resolve(selfId: string, to: string): Promise<Row | null> {
		const key = to.trim();
		if (key.toLowerCase() === "starter") {
			const self = await this.row(selfId);
			return self?.parentId ? this.row(self.parentId) : null;
		}
		const id = key.match(/[0-9a-f]{8}-[0-9a-f-]{27}/i)?.[0];
		return id ? this.row(id) : null;
	}

	// ---------- pl_thread_start ----------

	private async startRefusal(callerId: string): Promise<Failure | null> {
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
		// A plain folder has no commits to branch from, so a new thread would share this thread's folder.
		const project = await this.prisma.investigation.findUnique({
			where: { id: callerId },
			select: { repository: { select: { plain: true } } },
		});
		if (project?.repository?.plain)
			return fail(
				"invalid_input",
				"This project is a plain folder with no git, so a new thread would work in the same folder as this one.",
				"Do the work in this thread, or tell the user that Start git on the project gives each thread its own worktree.",
			);
		const mine = await this.prisma.investigation.count({
			where: { parentId: callerId, ...AGENT_ROLE, status: { in: LIVE } },
		});
		if (mine >= s.children)
			return fail(
				"limit_reached",
				`This thread already has ${mine} running threads it started, the cap.`,
				"Wait for one to finish or cancel one; the cap is Settings → Agent-started threads → At once per starter.",
			);
		const live = await this.prisma.investigation.count({
			where: { ...AGENT_STARTED, status: { in: LIVE } },
		});
		if (live >= s.perTree)
			return fail(
				"limit_reached",
				`Agents already have ${live} threads running, the cap.`,
				"Wait for one to finish; the cap is Settings → Agent-started threads → At once in total.",
			);
		return this.turnsToday(s.turnsPerDay);
	}

	/** Settings → Agent-started threads → A day: starts and delivered-or-queued messages in 24 hours. */
	private async turnsToday(limit: number): Promise<Failure | null> {
		const since = new Date(Date.now() - DAY_MS);
		const [starts, messages] = await Promise.all([
			this.prisma.investigation.count({
				where: { ...AGENT_STARTED, createdAt: { gte: since } },
			}),
			this.prisma.threadMessage.count({
				where: { createdAt: { gte: since }, state: { not: "held" } },
			}),
		]);
		if (starts + messages < limit) return null;
		return fail(
			"limit_reached",
			`Agents have started or messaged ${starts + messages} threads in the last 24 hours, the daily cap.`,
			"Finish with what you have; the cap is Settings → Agent-started threads → A day.",
		);
	}

	/** The new thread's subject: the starter's project or service; an incident's gets its service. */
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

	/** The commit each repo starts at, by the workspace kind; the starter's uncommitted work is never copied. */
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
			// A folder's worktree shares its objects, so a commit the starter made is reachable.
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

	private async startThread(
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
		// A retried start finds the thread the first attempt made.
		const existing = await this.prisma.investigation.findFirst({
			where: { triggerReason: actionReason(actionId) },
			select: ROW,
		});
		let startedId = existing?.id;
		let queued = false;
		const { row: starter, subject } = await this.subjectFor(callerId);
		const starterLevel =
			(starter.accessLevel as AccessLevel | null) ?? "supervised";
		const asked = args.access ?? starterLevel;
		const access = rank(asked) > rank(starterLevel) ? starterLevel : asked;
		if (!startedId) {
			const pins = await this.pinsFor(
				starter.workspace,
				args.workspace.kind,
				args.workspace.ref,
			);
			// Settings → Models → Delegate wins over the starter's own; the agent's ask wins over both.
			const use = await storedUseDefault(this.prisma, "delegate");
			const agent = args.agent ?? use?.harness ?? starter.harness;
			const model =
				args.model ??
				(use && agent === use.harness ? use.model : undefined) ??
				(agent === starter.harness ? starter.model : undefined);
			const started = await this.threads.start(
				{
					subject,
					text: firstPrompt(caller, args.brief),
					accessLevel: access,
					...(agent ? { harness: agent as never } : {}),
					...(model ? { model } : {}),
					...((args.effort ?? starter.effort)
						? { effort: args.effort ?? starter.effort }
						: {}),
				},
				{
					parentId: callerId,
					rootId: this.chainOf(caller),
					role: null,
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
			startedId = started.investigationId;
			queued = started.queued;
			const made = (await this.row(startedId)) as Row;
			await this.io.record(callerId, {
				kind: "thread_started",
				childId: startedId,
				role: "thread",
				title: made.title ?? args.title,
				link: threadLink(made),
			});
		}
		const made = (await this.row(startedId)) as Row;
		return {
			value: {
				status: "started",
				id: startedId,
				link: threadLink(made),
				state: nodeState(made),
				access,
				...(access !== asked
					? {
							note: `Access was clamped to ${access}: a thread never gets more than the one that starts it.`,
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

	// ---------- pl_thread_send ----------

	async send(callerId: string, args: SendArgs): Promise<ToolOutcome> {
		const self = await this.row(callerId);
		if (!self)
			return fail("run_ended", "This thread is gone.", "Stop messaging.");
		const to = await this.resolve(callerId, args.to);
		if (!to || to.id === callerId || !(await this.canRead(callerId, to.id)))
			return fail(
				"not_found",
				args.to.trim().toLowerCase() === "starter"
					? "No thread started this one."
					: `No thread "${args.to}" that this thread can read.`,
				"Pass a link from pl_thread_list, or `starter`.",
			);
		const seen = await this.prisma.threadMessage.findUnique({
			where: {
				fromId_requestId: { fromId: callerId, requestId: args.requestId },
			},
		});
		if (seen) return this.sent(seen, to);
		if (isSettled(to))
			return fail(
				"invalid_input",
				`${threadLink(to)} is settled; a message would stay unread.`,
				"Tell the user instead, or start a new thread.",
			);
		const s = await this.settings.get();
		const today = await this.turnsToday(s.turnsPerDay);
		if (today) return today;
		const since = new Date(Date.now() - DAY_MS);
		const pair = await this.prisma.threadMessage.count({
			where: {
				createdAt: { gte: since },
				OR: [
					{ fromId: callerId, toId: to.id },
					{ fromId: to.id, toId: callerId },
				],
			},
		});
		const held = pair >= s.pairPerDay;
		let message: ThreadMessageRow;
		try {
			message = await this.prisma.threadMessage.create({
				data: {
					rootId: this.chainOf(self),
					fromId: callerId,
					toId: to.id,
					type: "message",
					text: args.text,
					mode: args.mode,
					requestId: args.requestId,
					...(held ? { state: "held" } : {}),
				},
			});
		} catch (e) {
			if (!isDuplicate(e)) throw e;
			const again = await this.prisma.threadMessage.findUniqueOrThrow({
				where: {
					fromId_requestId: { fromId: callerId, requestId: args.requestId },
				},
			});
			return this.sent(again, to);
		}
		await this.io.record(callerId, {
			kind: "thread_message",
			direction: "sent",
			peerId: to.id,
			peerRole: "thread",
			peerTitle: nameOf(to),
			peerLink: threadLink(to),
			type: "message",
			text: args.text,
			mode: args.mode,
			...(held ? { held: true } : {}),
		});
		if (held) {
			// Both ends show the cap; the receiver's agent is not woken for it.
			await this.io.record(to.id, {
				kind: "thread_message",
				direction: "received",
				peerId: self.id,
				peerRole: "thread",
				peerTitle: nameOf(self),
				peerLink: threadLink(self),
				type: "message",
				text: args.text,
				mode: args.mode,
				held: true,
			});
			return {
				value: {
					status: "held",
					messageId: message.id,
					link: threadLink(to),
					note: `You and ${threadLink(to)} have sent each other ${pair} messages in 24 hours, the cap. It stays unread and wakes nothing; finish with what you have.`,
				},
			};
		}
		await this.inbox?.arrived(to.id, {
			messageId: message.id,
			source: "thread",
			arrivedAt: message.createdAt,
			from: { id: callerId, name: nameOf(self), link: threadLink(self) },
			text: args.text,
		});
		await this.drain();
		const now = await this.prisma.threadMessage.findUniqueOrThrow({
			where: { id: message.id },
		});
		return this.sent(now, to);
	}

	/** What the sender hears: delivered, reopened, or kept unread, and why. */
	private async sent(m: ThreadMessageRow, to: Row): Promise<ToolOutcome> {
		const link = threadLink((await this.row(m.toId)) ?? to);
		const status =
			m.state === "delivered" && isWorkflowTerminal(to.status)
				? "reopened"
				: m.state;
		return {
			value: {
				status,
				messageId: m.id,
				link,
				...(m.state === "queued"
					? {
							note: isSettled(to)
								? `${link} is settled: it stays unread until someone reopens it.`
								: isWorkflowTerminal(to.status)
									? `${link} can't reopen now (a usage limit or a stop); it gets this when it next runs.`
									: `${link} gets this at its next pause.`,
						}
					: {}),
			},
		};
	}

	/** Tick and send both drain; passes run one after another, so no message is sent twice. */
	drain(): Promise<void> {
		const pass = this.draining.then(
			() => this.drainOnce(),
			() => this.drainOnce(),
		);
		this.draining = pass.catch(() => {});
		return pass;
	}

	/** Hands every queued message to its receiver: at a running one's next pause, reopening an idle one. */
	private async drainOnce(): Promise<void> {
		const receivers = (
			await this.prisma.threadMessage.findMany({
				where: { state: "queued" },
				distinct: ["toId"],
				select: { toId: true },
			})
		).map((r) => r.toId);
		if (!receivers.length) return;
		const rows = await this.prisma.investigation.findMany({
			where: { id: { in: receivers } },
			select: ROW,
		});
		// A settled thread keeps its messages unread; nothing reopens it.
		const open = rows.filter((r) => !isSettled(r)).map((r) => r.id);
		const queued = await this.prisma.threadMessage.findMany({
			where: {
				state: "queued",
				id: { notIn: this.putOff.skip() },
				toId: { in: open },
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

	private async deliverEach(queued: ThreadMessageRow[]): Promise<void> {
		for (const m of queued) {
			try {
				await this.deliverMessage(m);
			} catch (e) {
				// One failing delivery is put off and logged; the rest of the pass goes on.
				logger.warn(
					`Could not deliver message ${m.id} to ${m.toId}: ${(e as Error).message}`,
				);
				this.putOff.defer(m.id);
			}
		}
	}

	private async deliverMessage(m: ThreadMessageRow): Promise<void> {
		const text = await treeMessageText(this.prisma, m);
		// A limit's resume may have carried it since this pass read it.
		const fresh = await this.prisma.threadMessage.findUnique({
			where: { id: m.id },
			select: { state: true },
		});
		if (fresh?.state !== "queued") return;
		const got = await this.io.deliver(m.toId, text, {
			steer: m.mode === "steer",
			reopen: true,
			messageId: m.id,
		});
		if (got.state !== "delivered") {
			this.putOff.defer(m.id);
			return;
		}
		await this.prisma.threadMessage.updateMany({
			where: { id: m.id, state: "queued" },
			data: { state: "delivered", deliveredAt: new Date() },
		});
		const from = await this.row(m.fromId);
		if (!from) return;
		await this.io.record(m.toId, {
			kind: "thread_message",
			direction: "received",
			peerId: from.id,
			peerRole: "thread",
			peerTitle: nameOf(from),
			peerLink: threadLink(from),
			type: "message",
			text: m.text,
			mode: m.mode as ThreadMessageMode,
			messageId: got.messageId,
		});
	}

	/** An allowance ends when its chain settles: nothing in it runs. */
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

	async revokeAllowance(chainId: string): Promise<void> {
		await this.prisma.treeAllowance.deleteMany({ where: { rootId: chainId } });
	}

	// ---------- pl_thread_cancel ----------

	/** Any thread the user could stop from its page, if this one can read it (#1101 cat 10). */
	private async cancelRefusal(
		callerId: string,
		id: string,
	): Promise<Failure | null> {
		const target = await this.resolve(callerId, id);
		if (!target || !(await this.canRead(callerId, target.id)))
			return fail(
				"not_found",
				`No thread "${id}" that this thread can read.`,
				"Pass a link from pl_thread_list, or `starter`.",
			);
		if (target.id === callerId)
			return fail(
				"invalid_input",
				"A thread can't stop itself.",
				"End your turn instead.",
			);
		if (isWorkflowTerminal(target.status))
			return fail(
				"invalid_input",
				`${threadLink(target)} has already ended.`,
				"Nothing to cancel; continue.",
			);
		return null;
	}

	private async cancelThread(
		callerId: string,
		args: { id: string; reason: string },
	): Promise<ToolOutcome> {
		const target = (await this.resolve(callerId, args.id)) as Row;
		const caller = await this.row(callerId);
		await this.stop(
			target.id,
			`Stopped by ${caller ? nameOf(caller) : "a thread"}: ${cap(args.reason, 200)}`,
		);
		await this.actions.cancelFor(target.id);
		return { value: { status: "stopping", link: threadLink(target) } };
	}

	/** Stops a thread as the Stop button does. */
	private async stop(id: string, why: string): Promise<void> {
		const row = await this.row(id);
		if (!row || isWorkflowTerminal(row.status)) return;
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

/** The started thread's only context: who started it, then the brief. */
export function firstPrompt(
	starter: { id: string; title: string | null } & Parameters<
		typeof threadLink
	>[0],
	brief: string,
): string {
	return [
		`Started by ${nameOf(starter)} (${threadLink(starter)}). If the brief asks you to report back, message it with pl_thread_send. Nothing is sent on your behalf.`,
		"",
		brief,
	].join("\n");
}
