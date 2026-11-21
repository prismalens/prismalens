// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { randomUUID } from "node:crypto";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { HARNESS_IDS, HARNESS_REGISTRY } from "@prismalens/config/harness";
import {
	type CanonicalEvent,
	CanonicalEventSchema,
	CONVERSATION_BRANCHES,
	deliveryEnvelope,
	forkPointOf,
	INVESTIGATION_REPORT_BRANCH,
	type JobAttachment,
	type JobMessageContext,
	type KeepWhy,
	type PriorSessions,
	REWIND_BRANCH,
	type RewindBlock,
	type RewindBy,
	type RewindExpect,
	type RewindKept,
	type RewindPath,
	type RewindPreview,
	type RewindRepoPreview,
	type RewindRestorePreview,
	type RewindRestoreResult,
	type RewindResult,
	type RewindUndoResult,
	type RunWorkspace,
	RunWorkspaceSchema,
} from "@prismalens/contracts";
import type { Prisma } from "@prismalens/database";
import { Logger } from "@prismalens/logger";
import { HarnessService } from "../../core/harness/harness.service.js";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import {
	DispatchService,
	FollowUpRefused,
} from "../../infrastructure/dispatch/dispatch.service.js";
import {
	EVENT_BUS,
	type EventBus,
	type RelayMessage,
	runEventsTopic,
} from "../../infrastructure/dispatch/event-bus.js";
import { AttachmentsService } from "../investigations/attachments.service.js";
import { agentSessionsOf } from "../investigations/follow-up-route.js";
import { InvestigationsService } from "../investigations/investigations.service.js";
import {
	interruptedWritten,
	markOp,
	markStoreOp,
	type NamedPaths,
	previewRestoreFiles,
	previewRewindFiles,
	type RepoOpResult,
	restoreFiles,
	rewindFiles,
	type ScopeContext,
	snapshotNow,
	storeOps,
	undoRewindFiles,
} from "../investigations/worktree-scopes.js";
import {
	snapshotStores,
	storeGit,
} from "../investigations/worktree-snapshots.js";
import { ReferencesService } from "../references/references.service.js";
import { treeMessageText } from "../thread-tree/tree-text.js";
import { tryExclusive } from "./thread-gate.js";

const logger = new Logger({ context: "Rewind" });

/** What a rewind never undoes; the dialog lists them under "Stays". */
const STAYS = [
	"Commands' effects outside the worktree",
	"Pushes and other threads",
	"Watches, links and the thread's PRs",
];

/** Keys a tool call names a file by: the handoff's own list (engine `run/handoff.ts`). */
const PATH_KEYS = ["path", "file_path", "filePath", "abs_path", "file"];

const LIVE = ["pending", "running"];
const UNFINISHED_JOBS = ["pending", "running"];

interface Row {
	ordinal: number;
	branchId: string;
	seq: number;
	event: CanonicalEvent;
}

type Thread = {
	id: string;
	status: string;
	harness: string | null;
	workspace: string | null;
	incidentId: string | null;
	acpSessionId: string | null;
	agentSessions: string | null;
};

class Refuse extends Error {
	constructor(readonly reason: "running") {
		super(reason);
	}
}

const pathsOf = (repo: string, ps: readonly string[]): RewindPath[] =>
	ps.map((path) => ({ repo, path }));
const keptOf = (
	repo: string,
	ks: readonly { path: string; why: KeepWhy }[],
): RewindKept[] => ks.map((k) => ({ repo, ...k }));

/**
 * Edit a sent message and run it again (#1193, the #1128 items). Later turns fold (never
 * deleted), the agent's files go back with a full backup first, the user's edits stay, the
 * sessions past the cut are cleared, and the whole rewind can be undone.
 */
@Injectable()
export class RewindService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly dispatch: DispatchService,
		private readonly investigations: InvestigationsService,
		private readonly harness: HarnessService,
		private readonly attachments: AttachmentsService,
		@Inject(EVENT_BUS) private readonly bus: EventBus,
		@Optional() private readonly references?: ReferencesService,
	) {
		dispatch.onBoot(() => this.markInterrupted());
	}

	private async thread(id: string): Promise<Thread | null> {
		return this.prisma.investigation.findUnique({
			where: { id },
			select: {
				id: true,
				status: true,
				harness: true,
				workspace: true,
				incidentId: true,
				acpSessionId: true,
				agentSessions: true,
			},
		});
	}

	/** The unfolded record, in commit order: a fold reader. */
	private async rows(id: string): Promise<Row[]> {
		const raw = await this.prisma.investigationEvent.findMany({
			where: { investigationId: id, foldedBy: null },
			orderBy: { ordinal: "asc" },
			select: { ordinal: true, branchId: true, seq: true, event: true },
		});
		return raw.flatMap((r) => {
			const parsed = CanonicalEventSchema.safeParse(
				(() => {
					try {
						return JSON.parse(r.event);
					} catch {
						return null;
					}
				})(),
			);
			return parsed.success
				? [
						{
							ordinal: r.ordinal,
							branchId: r.branchId,
							seq: r.seq,
							event: parsed.data,
						},
					]
				: [];
		});
	}

	private ws(t: Thread): RunWorkspace | null {
		if (!t.workspace) return null;
		try {
			const parsed = RunWorkspaceSchema.safeParse(JSON.parse(t.workspace));
			return parsed.success ? parsed.data : null;
		} catch {
			return null;
		}
	}

	private ctx(t: Thread, canWrite: boolean): ScopeContext {
		return { runId: t.id, running: LIVE.includes(t.status), canWrite };
	}

	/** The edited message's row: a user's own `operator_message` on its branch. */
	private messageOf(rows: Row[], seq: number): Row | undefined {
		return rows.find(
			(r) =>
				r.event.kind === "operator_message" &&
				r.seq === seq &&
				r.branchId !== REWIND_BRANCH,
		);
	}

	private async blockOf(
		t: Thread,
		rows: Row[],
		m: Row,
		canWrite: boolean,
	): Promise<RewindBlock | null> {
		if (!canWrite) return "view-only";
		const e = m.event;
		if (
			e.kind !== "operator_message" ||
			deliveryEnvelope(e.text) ||
			e.via?.restart ||
			e.via?.cause
		)
			return "not-yours";
		if (await this.running(t)) return "running";
		if (queuedOf(rows).length) return "queued";
		const report = rows.find((r) => r.branchId === INVESTIGATION_REPORT_BRANCH);
		if (report && report.ordinal > m.ordinal) return "before-report";
		return null;
	}

	private async running(t: Thread): Promise<boolean> {
		if (LIVE.includes(t.status)) return true;
		return !!(await this.prisma.job.findFirst({
			where: { investigationId: t.id, status: { in: UNFINISHED_JOBS } },
			select: { id: true },
		}));
	}

	/** Paths each tool call named, by its event's seq (`during-turn` is what none named). */
	private named(rows: Row[], m: Row): NamedPaths[] {
		const out: NamedPaths[] = [];
		for (const r of rows) {
			if (r.ordinal < m.ordinal || r.event.kind !== "agent_step") continue;
			const paths: string[] = [];
			for (const c of r.event.toolCalls) {
				for (const k of PATH_KEYS)
					if (typeof c.args[k] === "string") paths.push(c.args[k] as string);
				const locs = c.args.locations;
				if (Array.isArray(locs))
					for (const l of locs)
						if (typeof (l as { path?: unknown })?.path === "string")
							paths.push((l as { path: string }).path);
				const diff = c.args.diff as { path?: unknown } | undefined;
				if (typeof diff?.path === "string") paths.push(diff.path);
			}
			if (paths.length) out.push({ seq: r.seq, paths });
		}
		return out;
	}

	private async sessionOf(
		t: Thread,
		rows: Row[],
		m: Row,
	): Promise<{
		via: "fork" | "replay" | "new";
		why: string | null;
		fork: {
			from: string;
			messageId: string;
			adapter: string;
			tail: { prompts: number; text: string };
		} | null;
	}> {
		const before = rows.filter(
			(r) =>
				r.branchId === m.branchId &&
				r.ordinal < m.ordinal &&
				r.event.kind === "operator_message" &&
				r.event.delivered,
		);
		if (!before.length) return { via: "new", why: null, fork: null };
		const settings = await this.harness.getSettings().catch(() => null);
		const replay = (why: string) => ({
			via: "replay" as const,
			why,
			fork: null,
		});
		if (settings?.rewindSession === "replay")
			return replay("Settings start a new session on an edit");
		const harness = HARNESS_IDS.find((h) => h === t.harness);
		const fact = harness
			? HARNESS_REGISTRY[harness].facts?.rewindVia
			: undefined;
		if (
			!harness ||
			fact?.value !== "fork-at-message" ||
			!fact.verifiedAt.adapter
		)
			return replay(
				`${harness ? HARNESS_REGISTRY[harness].label : "This agent"} can't cut its session at a message`,
			);
		const from =
			agentSessionsOf(t.agentSessions)[harness]?.acpSessionId ?? t.acpSessionId;
		if (!from) return replay("the agent kept no session to cut");
		const point = forkPointOf(
			rows.map((r) => r.event),
			m.seq,
			m.branchId,
		);
		if (!point.point) return replay(point.why ?? "no point to cut at");
		return {
			via: "fork",
			why: null,
			fork: { from, adapter: fact.verifiedAt.adapter, ...point.point },
		};
	}

	/** The thread's sent messages a rewind may target, newest first, by seq. */
	async sentMessages(id: string): Promise<number[]> {
		const rows = await this.rows(id);
		return rows
			.filter(
				(r) =>
					r.event.kind === "operator_message" &&
					r.event.delivered &&
					r.branchId !== REWIND_BRANCH,
			)
			.map((r) => r.seq)
			.reverse();
	}

	/** What editing message `seq` would undo, with nothing changed. */
	async preview(
		id: string,
		seq: number,
		canWrite: boolean,
	): Promise<RewindPreview> {
		const t = await this.thread(id);
		if (!t) throw new FollowUpRefused("This thread is gone.");
		const rows = await this.rows(id);
		const m = this.messageOf(rows, seq);
		if (!m) throw new FollowUpRefused("That message is not in the thread.");
		return (await this.look(t, rows, m, canWrite)).preview;
	}

	private async look(t: Thread, rows: Row[], m: Row, canWrite: boolean) {
		const branches = CONVERSATION_BRANCHES(m.branchId);
		const block = await this.blockOf(t, rows, m, canWrite);
		const turns = rows.filter(
			(r) =>
				r.branchId === m.branchId &&
				r.ordinal >= m.ordinal &&
				r.event.kind === "operator_message" &&
				r.event.delivered,
		).length;
		const revision = Math.max(
			0,
			...rows
				.filter((r) => branches.includes(r.branchId))
				.map((r) => r.ordinal),
		);
		const ws = this.ws(t);
		const named = this.named(rows, m);
		const repos = ws
			? await previewRewindFiles(ws, m.seq, named, this.ctx(t, canWrite))
			: [];
		const session = await this.sessionOf(t, rows, m);
		const commits = repos.reduce(
			(n, r) => n + (r.state === "ok" ? r.commits : 0),
			0,
		);
		const preview: RewindPreview = {
			seq: m.seq,
			messageOrdinal: m.ordinal,
			revision,
			block,
			turns,
			repos,
			stays: [
				...STAYS,
				...(commits
					? [`${commits} commit${commits === 1 ? "" : "s"} on the branch`]
					: []),
			],
			session: { via: session.via, why: session.why },
		};
		return { preview, session, named, ws, branches };
	}

	private stale(preview: RewindPreview, expect: RewindExpect): boolean {
		if (
			preview.messageOrdinal !== expect.messageOrdinal ||
			preview.revision !== expect.revision
		)
			return true;
		const ok = preview.repos.filter(
			(r): r is Extract<RewindRepoPreview, { state: "ok" }> => r.state === "ok",
		);
		if (ok.length !== Object.keys(expect.repos).length) return true;
		return ok.some(
			(r) =>
				expect.repos[r.repo]?.head !== r.head ||
				expect.repos[r.repo]?.tree !== r.tree,
		);
	}

	/** Edit message `seq` (#1193): the whole flow holds the gate, then the thread's admission. */
	async rewind(
		input: {
			id: string;
			seq: number;
			text: string;
			expect: RewindExpect;
			include: RewindPath[];
			rewindId?: string;
		},
		by: RewindBy,
		canWrite: boolean,
	): Promise<RewindResult> {
		const release = tryExclusive(input.id);
		if (!release) return { state: "refused", reason: "running", paths: [] };
		try {
			return await this.dispatch.withAdmission(input.id, () =>
				this.rewindHeld(input, by, canWrite),
			);
		} finally {
			release();
		}
	}

	private async rewindHeld(
		input: {
			id: string;
			seq: number;
			text: string;
			expect: RewindExpect;
			include: RewindPath[];
			rewindId?: string;
		},
		by: RewindBy,
		canWrite: boolean,
	): Promise<RewindResult> {
		const refused = (
			reason: Extract<RewindResult, { state: "refused" }>["reason"],
			paths: RewindPath[] = [],
		): RewindResult => ({ state: "refused", reason, paths });
		const t = await this.thread(input.id);
		if (!t) return refused("stale");
		const rows = await this.rows(input.id);
		const m = this.messageOf(rows, input.seq);
		if (!m || m.event.kind !== "operator_message") return refused("stale");
		const look = await this.look(t, rows, m, canWrite);
		if (look.preview.block) return refused(look.preview.block);
		if (this.stale(look.preview, input.expect)) return refused("stale");
		for (const inc of input.include) {
			const repo = look.preview.repos.find((r) => r.repo === inc.repo);
			if (repo?.state !== "ok" || !repo.duringTurn.includes(inc.path))
				return refused("stale", [inc]);
		}
		const rewindId = input.rewindId ?? randomUUID();
		const ws = look.ws;
		const ctx = this.ctx(t, canWrite);
		const done: Extract<RepoOpResult, { state: "done" }>[] = [];
		const compensate = async () => {
			for (const d of done) {
				if (!ws) break;
				const back = await undoRewindFiles(ws, d.repo, ctx, {
					op: randomUUID(),
					of: d.op,
					rewindId,
					afterSeq: Number.POSITIVE_INFINITY,
				}).catch(() => null);
				await markOp(ws, d.repo, ctx, d.op, "dropped").catch(() => {});
				if (back?.state === "done")
					await markOp(ws, d.repo, ctx, back.op, "dropped").catch(() => {});
			}
		};
		for (const repo of look.preview.repos) {
			if (repo.state !== "ok" || !ws) continue;
			const op = randomUUID();
			const r = await rewindFiles(ws, repo.repo, ctx, {
				op,
				rewindId,
				fromSeq: m.seq,
				named: look.named,
				include: new Set(
					input.include.filter((i) => i.repo === repo.repo).map((i) => i.path),
				),
				expect: input.expect.repos[repo.repo] as { head: string; tree: string },
			}).catch((e: unknown) => {
				logger.warn(`Rewind of ${repo.repo} failed: ${(e as Error).message}`);
				return {
					state: "refused",
					repo: repo.repo,
					reason: "gone",
					paths: [],
				} as RepoOpResult;
			});
			if (r.state === "refused") {
				await markOp(ws, repo.repo, ctx, op, "dropped").catch(() => {});
				await compensate();
				return refused(
					r.reason === "stale" ? "stale" : "conflict",
					pathsOf(repo.repo, r.paths),
				);
			}
			done.push(r);
		}
		const reverted = done.flatMap((d) => pathsOf(d.repo, d.reverted));
		const kept = done.flatMap((d) => keptOf(d.repo, d.kept));
		const journals = Object.fromEntries(done.map((d) => [d.repo, d.op]));
		let marker: CanonicalEvent[];
		try {
			marker = await this.prisma.$transaction(async (tx) => {
				const now = await tx.investigation.findUnique({
					where: { id: t.id },
					select: {
						status: true,
						eventOrdinal: true,
						acpSessionId: true,
						agentSessions: true,
					},
				});
				if (!now || LIVE.includes(now.status)) throw new Refuse("running");
				const job = await tx.job.findFirst({
					where: { investigationId: t.id, status: { in: UNFINISHED_JOBS } },
					select: { id: true },
				});
				if (job) throw new Refuse("running");
				const range = {
					investigationId: t.id,
					foldedBy: null,
					branchId: { in: look.branches },
					ordinal: { gte: m.ordinal, lte: now.eventOrdinal },
				};
				const out = await this.supersede(tx, t.id, range);
				await tx.investigationEvent.updateMany({
					where: range,
					data: { foldedBy: rewindId },
				});
				const priorSessions: PriorSessions = {
					acpSessionId: now.acpSessionId,
					agentSessions: now.agentSessions,
				};
				out.push(
					await appendIn(tx, t.id, REWIND_BRANCH, {
						kind: "thread_rewound",
						rewindId,
						fromSeq: m.seq,
						turns: look.preview.turns,
						messageOrdinal: m.ordinal,
						throughOrdinal: now.eventOrdinal,
						journals,
						reverted: reverted.slice(0, 200),
						kept: kept.slice(0, 200),
						priorSessions,
						session: look.session.via,
						by,
					}),
				);
				await tx.investigation.update({
					where: { id: t.id },
					data: {
						acpSessionId: null,
						agentSessions: null,
						eventGeneration: { increment: 1 },
					},
				});
				return out;
			});
		} catch (e) {
			await compensate();
			if (e instanceof Refuse) return refused("running");
			throw e;
		}
		for (const d of done)
			if (ws) await markOp(ws, d.repo, ctx, d.op, "committed").catch(() => {});
		this.published(t.id, marker);
		const sent = await this.send(t, m.event, input.text, by, {
			rewindId,
			fork: look.session.fork,
			why: look.session.why,
		});
		return {
			state: "done",
			rewindId,
			reverted,
			kept,
			sent: sent === null,
			why: sent,
		};
	}

	/** Admits the edited message under the held admission; the refusal's words, or null when sent. */
	private async send(
		t: Thread,
		m: Extract<CanonicalEvent, { kind: "operator_message" }>,
		text: string,
		by: RewindBy,
		rewind: NonNullable<Parameters<DispatchService["admitHeld"]>[7]>["rewind"],
	): Promise<string | null> {
		const ids = (m.attachments ?? []).map((a) => a.id);
		const files: JobAttachment[] = !ids.length
			? []
			: await (t.incidentId
					? this.attachments.forJob(t.incidentId, ids)
					: this.attachments.forRun(t.id, ids)
				).catch(() => []);
		const context: JobMessageContext | undefined = await this.references
			?.compose(
				{
					...(m.quotes ? { quotes: m.quotes } : {}),
					...(m.references ? { references: m.references } : {}),
				},
				{ threadId: t.id },
			)
			.catch(() => undefined);
		const said =
			by.kind === "thread" ? await senderLine(this.prisma, by.id, text) : text;
		try {
			const ok = await this.dispatch.admitHeld(
				t.id,
				said,
				"queue",
				"chat",
				files,
				{},
				context,
				{ cause: "rewind", ...(rewind ? { rewind } : {}) },
			);
			return ok ? null : "A follow-up is already running.";
		} catch (e) {
			if (e instanceof FollowUpRefused) return e.message;
			throw e;
		}
	}

	/**
	 * In the fold transaction: pending approvals asked in the folded range end `cancelled`
	 * (never reopening their caller), and its open tool asks close `superseded`, appended
	 * after the fold so they stay visible (R13, R15).
	 */
	private async supersede(
		tx: Prisma.TransactionClient,
		id: string,
		range: Prisma.InvestigationEventWhereInput,
	): Promise<CanonicalEvent[]> {
		const opened = await tx.investigationEvent.findMany({
			where: { ...range, event: { contains: '"kind":"ask_opened"' } },
			select: { event: true },
		});
		const askIds = opened.flatMap((r) => {
			try {
				const e = JSON.parse(r.event) as { ask?: { askId?: unknown } };
				return typeof e.ask?.askId === "string" ? [e.ask.askId] : [];
			} catch {
				return [];
			}
		});
		if (!askIds.length) return [];
		const at = new Date();
		await tx.pendingAction.updateMany({
			where: { askId: { in: askIds }, state: "pending" },
			data: { state: "cancelled", decidedAt: at, deliveredAt: at },
		});
		const open = await tx.toolAsk.findMany({
			where: { askId: { in: askIds }, threadId: id, status: "open" },
			select: { askId: true },
		});
		const out: CanonicalEvent[] = [];
		for (const a of open) {
			await tx.toolAsk.update({
				where: { askId: a.askId },
				data: { status: "closed", outcome: "superseded", closedAt: at },
			});
			out.push(
				await appendIn(tx, id, "asks", {
					kind: "ask_closed",
					askId: a.askId,
					outcome: "superseded",
				}),
			);
		}
		return out;
	}

	private published(id: string, events: CanonicalEvent[]): void {
		this.investigations.notifyCommit(id, "reset");
		for (const event of events)
			this.bus.publish<RelayMessage>(runEventsTopic(id), {
				kind: "event",
				event,
			});
	}

	/** The thread's live rewinds, newest last: each marker with whether it was undone. */
	private rewinds(rows: Row[]) {
		const undone = new Set(
			rows.flatMap((r) =>
				r.event.kind === "rewind_undone" ? [r.event.rewindId] : [],
			),
		);
		return rows.flatMap((r) =>
			r.event.kind === "thread_rewound"
				? [{ row: r, event: r.event, undone: undone.has(r.event.rewindId) }]
				: [],
		);
	}

	/** Undo the thread's latest live rewind: files, turns and sessions come back. */
	async undo(
		id: string,
		rewindId: string,
		canWrite: boolean,
	): Promise<RewindUndoResult> {
		if (!canWrite) return { state: "refused", reason: "view-only", paths: [] };
		const release = tryExclusive(id);
		if (!release) return { state: "refused", reason: "running", paths: [] };
		try {
			return await this.dispatch.withAdmission(id, () =>
				this.undoHeld(id, rewindId, canWrite),
			);
		} finally {
			release();
		}
	}

	private async undoHeld(
		id: string,
		rewindId: string,
		canWrite: boolean,
	): Promise<RewindUndoResult> {
		const refused = (
			reason: Extract<RewindUndoResult, { state: "refused" }>["reason"],
			paths: RewindPath[] = [],
		): RewindUndoResult => ({ state: "refused", reason, paths });
		const t = await this.thread(id);
		if (!t) return refused("stale");
		if (await this.running(t)) return refused("running");
		const rows = await this.rows(id);
		const all = this.rewinds(rows);
		const mine = all.find((r) => r.event.rewindId === rewindId);
		if (!mine) return refused("stale");
		if (mine.undone) return refused("already-undone");
		if (all.at(-1)?.event.rewindId !== rewindId) return refused("superseded");
		const marker = mine.event;
		const ws = this.ws(t);
		const ctx = this.ctx(t, canWrite);
		const done: Extract<RepoOpResult, { state: "done" }>[] = [];
		for (const [repo, of] of Object.entries(marker.journals)) {
			if (!ws) break;
			const op = randomUUID();
			const r = await undoRewindFiles(ws, repo, ctx, {
				op,
				of,
				rewindId,
				afterSeq: mine.row.seq,
			}).catch(
				() =>
					({
						state: "refused",
						repo,
						reason: "gone",
						paths: [],
					}) as RepoOpResult,
			);
			if (r.state === "refused") {
				await markOp(ws, repo, ctx, op, "dropped").catch(() => {});
				if (r.reason === "gone" || r.reason === "no-snapshot") continue;
				return refused("stale", pathsOf(repo, r.paths));
			}
			done.push(r);
		}
		const restored = done.flatMap((d) => pathsOf(d.repo, d.reverted));
		const kept = done.flatMap((d) => keptOf(d.repo, d.kept));
		const edited = await this.prisma.investigationEvent.findFirst({
			// The edited message itself is folded: read it on purpose for its branch.
			where: { investigationId: id, ordinal: marker.messageOrdinal },
			select: { branchId: true },
		});
		const branches = CONVERSATION_BRANCHES(edited?.branchId ?? "run");
		let events: CanonicalEvent[];
		try {
			events = await this.prisma.$transaction(async (tx) => {
				const now = await tx.investigation.findUnique({
					where: { id },
					select: {
						status: true,
						eventOrdinal: true,
						acpSessionId: true,
						agentSessions: true,
					},
				});
				if (!now || LIVE.includes(now.status)) throw new Refuse("running");
				const replacement = {
					investigationId: id,
					foldedBy: null,
					branchId: { in: branches },
					ordinal: { gt: marker.throughOrdinal, lte: now.eventOrdinal },
					// A superseded ask stays closed whichever way the fold goes.
					NOT: { event: { contains: '"outcome":"superseded"' } },
				};
				const out = await this.supersede(tx, id, replacement);
				await tx.investigationEvent.updateMany({
					where: replacement,
					data: { foldedBy: `undo:${rewindId}` },
				});
				await tx.investigationEvent.updateMany({
					where: { investigationId: id, foldedBy: rewindId },
					data: { foldedBy: null },
				});
				out.push(
					await appendIn(tx, id, REWIND_BRANCH, {
						kind: "rewind_undone",
						rewindId,
						journals: Object.fromEntries(done.map((d) => [d.repo, d.op])),
						restored: restored.slice(0, 200),
						kept: kept.slice(0, 200),
						replacedSessions: {
							acpSessionId: now.acpSessionId,
							agentSessions: now.agentSessions,
						},
					}),
				);
				await tx.investigation.update({
					where: { id },
					data: {
						acpSessionId: marker.priorSessions.acpSessionId,
						agentSessions: marker.priorSessions.agentSessions,
						eventGeneration: { increment: 1 },
					},
				});
				return out;
			});
		} catch (e) {
			// The files went back but the record did not: put them where the rewind left them.
			for (const d of done)
				if (ws) await markOp(ws, d.repo, ctx, d.op, "dropped").catch(() => {});
			if (e instanceof Refuse) return refused("running");
			throw e;
		}
		for (const d of done)
			if (ws) await markOp(ws, d.repo, ctx, d.op, "committed").catch(() => {});
		this.published(id, events);
		return { state: "done", restored, kept };
	}

	/** A rewind's folded rows, for the fold row's Show: muted and read-only. */
	async folded(id: string, rewindId: string): Promise<CanonicalEvent[]> {
		// Reads folded rows on purpose (Fold readers: "Show folded turns").
		const rows = await this.prisma.investigationEvent.findMany({
			where: {
				investigationId: id,
				foldedBy: { in: [rewindId, `undo:${rewindId}`] },
			},
			orderBy: { ordinal: "asc" },
			select: { event: true },
		});
		return rows.flatMap((r) => {
			try {
				const p = CanonicalEventSchema.safeParse(JSON.parse(r.event));
				return p.success ? [p.data] : [];
			} catch {
				return [];
			}
		});
	}

	private async interrupted(id: string, op: string) {
		const rows = await this.rows(id);
		const ev = rows.find(
			(r) => r.event.kind === "rewind_interrupted" && r.event.op === op,
		)?.event;
		const restored = rows.some(
			(r) => r.event.kind === "rewind_restored" && r.event.of === op,
		);
		return ev?.kind === "rewind_interrupted" ? { ev, restored } : null;
	}

	/** What Restore of an interrupted operation would write, worked out fresh (R16). */
	async restorePreview(
		id: string,
		op: string,
		canWrite: boolean,
	): Promise<RewindRestorePreview> {
		const t = await this.thread(id);
		const found = t ? await this.interrupted(id, op) : null;
		const ws = t ? this.ws(t) : null;
		const empty = {
			op,
			repo: found?.ev.repo ?? "",
			overwrite: [],
			created: [],
			damaged: [],
			head: "",
			tree: "",
			backup: found?.ev.backup ?? "",
			now: "",
		};
		if (!t || !found || !ws) return { ...empty, block: null };
		if (!canWrite) return { ...empty, block: "view-only" };
		if (await this.running(t)) return { ...empty, block: "running" };
		const plan = await previewRestoreFiles(
			ws,
			found.ev.repo,
			this.ctx(t, canWrite),
			op,
		);
		if (typeof plan === "string")
			return {
				...empty,
				block: plan === "running" || plan === "view-only" ? plan : null,
			};
		return {
			op,
			repo: found.ev.repo,
			block: null,
			overwrite: plan.overwrite.slice(0, 200),
			created: plan.created.slice(0, 200),
			damaged: plan.damaged.slice(0, 200),
			head: plan.head,
			tree: plan.tree,
			backup: plan.backup,
			now: plan.now,
		};
	}

	/** Restore an interrupted operation's backup: a normal, locked operation of its own. */
	async restore(
		input: {
			id: string;
			op: string;
			expect: { head: string; tree: string };
			include: string[];
		},
		canWrite: boolean,
	): Promise<RewindRestoreResult> {
		const refused = (
			reason: Extract<RewindRestoreResult, { state: "refused" }>["reason"],
		): RewindRestoreResult => ({ state: "refused", reason, paths: [] });
		if (!canWrite) return refused("view-only");
		const release = tryExclusive(input.id);
		if (!release) return refused("running");
		try {
			return await this.dispatch.withAdmission(input.id, async () => {
				const t = await this.thread(input.id);
				const found = t ? await this.interrupted(input.id, input.op) : null;
				const ws = t ? this.ws(t) : null;
				if (!t || !found || !ws || found.restored) return refused("gone");
				if (await this.running(t)) return refused("running");
				const ctx = this.ctx(t, canWrite);
				const op = randomUUID();
				const r = await restoreFiles(ws, found.ev.repo, ctx, {
					op,
					of: input.op,
					expect: input.expect,
					include: new Set(input.include),
				});
				if (r.state === "refused") {
					await markOp(ws, found.ev.repo, ctx, op, "dropped").catch(() => {});
					return refused(r.reason === "stale" ? "stale" : "gone");
				}
				const restored = pathsOf(r.repo, r.reverted);
				const kept = keptOf(r.repo, r.kept);
				const events = await this.prisma.$transaction(async (tx) => [
					await appendIn(tx, input.id, REWIND_BRANCH, {
						kind: "rewind_restored",
						op,
						of: input.op,
						journals: { [r.repo]: op },
						restored: restored.slice(0, 200),
						kept: kept.slice(0, 200),
					}),
				]);
				await markOp(ws, r.repo, ctx, op, "committed").catch(() => {});
				this.published(input.id, events);
				return { state: "done", restored, kept };
			});
		} finally {
			release();
		}
	}

	/**
	 * At boot, before any run can start (R7): every operation in every store that never
	 * reached `committed` is marked. One whose event did commit gets `committed`; any other
	 * gets its `interrupted` ref and a `rewind_interrupted` event. Writes no worktree file.
	 */
	async markInterrupted(): Promise<void> {
		for (const store of await snapshotStores()) {
			const ops = await storeOps(store.gitDir);
			if (
				![...ops.values()].some(
					(o) => !o.refs.has("committed") && !o.refs.has("dropped"),
				)
			)
				continue;
			const t = await this.thread(store.runId).catch(() => null);
			const markers = t
				? (
						await this.prisma.investigationEvent.findMany({
							// Markers live on their own branch, which never folds.
							where: { investigationId: store.runId, branchId: REWIND_BRANCH },
							select: { event: true },
						})
					).flatMap((r) => {
						try {
							const p = CanonicalEventSchema.safeParse(JSON.parse(r.event));
							return p.success ? [p.data] : [];
						} catch {
							return [];
						}
					})
				: [];
			for (const [op, { refs, meta }] of ops) {
				if (refs.has("committed") || refs.has("dropped")) continue;
				const repo = typeof meta?.repo === "string" ? meta.repo : "";
				const committed = markers.some(
					(e) =>
						(e.kind === "thread_rewound" ||
							e.kind === "rewind_undone" ||
							e.kind === "rewind_restored") &&
						e.journals[repo] === op,
				);
				try {
					if (committed) {
						await markStoreOp(store.gitDir, op, "committed");
						continue;
					}
					if (!refs.has("backup")) {
						// Nothing is written before the backup: there is nothing to restore.
						await markStoreOp(store.gitDir, op, "committed");
						continue;
					}
					if (!refs.has("interrupted"))
						await markStoreOp(store.gitDir, op, "interrupted");
					if (!t) continue;
					const seen = markers.some(
						(e) =>
							e.kind === "rewind_interrupted" && e.op === op && e.repo === repo,
					);
					if (seen) continue;
					const ws = this.ws(t);
					const now = ws
						? await snapshotNow(ws, repo, this.ctx(t, false))
						: null;
					const written = await interruptedWritten(store.gitDir, op, now);
					const [backup, receipt] = await Promise.all(
						["backup", "receipt"].map((k) => this.refIn(store.gitDir, op, k)),
					);
					const kind =
						meta?.kind === "undo" || meta?.kind === "restore"
							? meta.kind
							: "rewind";
					const events = await this.prisma.$transaction(async (tx) => [
						await appendIn(tx, t.id, REWIND_BRANCH, {
							kind: "rewind_interrupted",
							op,
							repo,
							opKind: kind,
							rewindId:
								typeof meta?.rewindId === "string" ? meta.rewindId : null,
							backup: backup ?? "",
							receipt,
							written: pathsOf(repo, written.slice(0, 200)),
						}),
					]);
					this.published(t.id, events);
				} catch (e) {
					logger.warn(
						`Could not mark interrupted operation ${op}: ${(e as Error).message}`,
					);
				}
			}
		}
	}

	private async refIn(gitDir: string, op: string, k: string) {
		return storeGit(gitDir, [
			"rev-parse",
			"--verify",
			"-q",
			`refs/pl/op/${op}/${k}`,
		])
			.then((o) => o.trim() || null)
			.catch(() => null);
	}
}

/** Queued messages still waiting: queued, never delivered, edited away or withdrawn. */
function queuedOf(rows: Row[]): string[] {
	const queued = new Set<string>();
	for (const { event: e } of rows) {
		if (e.kind === "message_queued") queued.add(e.messageId);
		else if (e.kind === "message_withdrawn") queued.delete(e.messageId);
		else if (e.kind === "operator_message") {
			if (e.messageId) queued.delete(e.messageId);
			for (const d of e.delivers ?? []) queued.delete(d);
		}
	}
	return [...queued];
}

/** An agent's edit reads as that thread's message, never the user's. */
function senderLine(
	prisma: PrismaService,
	fromId: string,
	text: string,
): Promise<string> {
	return treeMessageText(prisma, { fromId, text });
}

type MarkerBody =
	| Omit<Extract<CanonicalEvent, { kind: "thread_rewound" }>, keyof Stream>
	| Omit<Extract<CanonicalEvent, { kind: "rewind_undone" }>, keyof Stream>
	| Omit<Extract<CanonicalEvent, { kind: "rewind_interrupted" }>, keyof Stream>
	| Omit<Extract<CanonicalEvent, { kind: "rewind_restored" }>, keyof Stream>
	| Omit<Extract<CanonicalEvent, { kind: "ask_closed" }>, keyof Stream>;
type Stream = {
	runId: string;
	branchId: string;
	path: string[];
	seq: number;
	label?: string | null;
	ts: string;
};

/** Appends one event inside a transaction; its seq follows every row's, folded ones too. */
async function appendIn(
	tx: Prisma.TransactionClient,
	id: string,
	branchId: string,
	body: MarkerBody,
): Promise<CanonicalEvent> {
	const { _max } = await tx.investigationEvent.aggregate({
		where: { investigationId: id },
		_max: { seq: true },
	});
	const event = {
		...body,
		runId: id,
		branchId,
		path: [],
		seq: (_max.seq ?? -1) + 1,
		label: null,
		ts: new Date().toISOString(),
	} as CanonicalEvent;
	await tx.investigationEvent.create({
		data: {
			investigationId: id,
			seq: event.seq,
			branchId,
			event: JSON.stringify(event),
		},
	});
	return event;
}
