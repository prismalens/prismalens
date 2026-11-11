// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import {
	Inject,
	Injectable,
	type OnModuleDestroy,
	type OnModuleInit,
} from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import {
	isWorkflowTerminal,
	LIVE_WORKFLOW_STATUSES,
	RunWorkspaceSchema,
	type SettlePreview,
	type WorktreeVerdict,
} from "@prismalens/contracts";
import { Logger } from "@prismalens/logger";
import { gitEnv } from "../../core/harness/git-env.js";
import {
	GIT_PROBE_TIMEOUT_MS,
	spawnGit,
} from "../../core/harness/git-spawn.js";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { DispatchService } from "../../infrastructure/dispatch/dispatch.service.js";
import {
	EVENT_BUS,
	type EventBus,
} from "../../infrastructure/dispatch/event-bus.js";
import { releaseSettledWorkspace } from "../../infrastructure/dispatch/investigation-run.js";
import { safeParseJsonObject } from "../../shared/utils/json-utils.js";
import { InvestigationsService } from "../investigations/investigations.service.js";
import { type Ended, endedLine, isSettled } from "./settled.js";
import { recordWatchEvent } from "./thread-watches.service.js";

export { type Ended, endedLine, endedNote, isSettled } from "./settled.js";

/** The teardown pass runs this often; a teardown fires at most this late after Undo's window. */
const TEARDOWN_EVERY_MS = 30_000;
/** Tree depth is capped well below this; the walk stops here whatever the data says. */
const TREE_DEPTH_MAX = 16;
const DAY_MS = 24 * 60 * 60_000;
const THREAD_SETTINGS_KEY = "threads.list";
const DEFAULT_SETTLE_AFTER_DAYS = 3;
const LIVE = [...LIVE_WORKFLOW_STATUSES] as string[];
const plural = (n: number, one: string, many = `${one}s`) =>
	`${n} ${n === 1 ? one : many}`;

/**
 * The thread lifecycle (#1024 surface F): what settling a block would end, the
 * stop it needs, and the teardown once Undo's window closes. Jobs live in the
 * database and run on the server's loops, never on a session or an open window.
 */
@Injectable()
export class ThreadLifecycleService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger({ context: "ThreadLifecycle" });
	private timer: ReturnType<typeof setInterval> | undefined;
	private ticking = false;

	constructor(
		private readonly prisma: PrismaService,
		private readonly dispatch: DispatchService,
		private readonly investigations: InvestigationsService,
		@Inject(EVENT_BUS) private readonly bus: EventBus,
	) {}

	onModuleInit(): void {
		// The boot pass ends what a restart inside an Undo window left waiting.
		const run = () =>
			void this.tick().catch((e) =>
				this.logger.warn(`A settle teardown pass failed: ${String(e)}`),
			);
		setTimeout(run, 1_000).unref?.();
		this.timer = setInterval(run, TEARDOWN_EVERY_MS);
		this.timer.unref?.();
	}

	onModuleDestroy(): void {
		if (this.timer) clearInterval(this.timer);
	}

	async tick(now: Date = new Date()): Promise<void> {
		if (this.ticking) return;
		this.ticking = true;
		try {
			await this.teardownDue(now);
			await this.autoSettle(now);
		} finally {
			this.ticking = false;
		}
	}

	/** The settle's block: the thread, or every thread of its incident. */
	async block(id: string): Promise<string[]> {
		const row = await this.prisma.investigation.findUnique({
			where: { id },
			select: { incidentId: true },
		});
		if (!row) return [];
		if (!row.incidentId) return [id];
		const rows = await this.prisma.investigation.findMany({
			where: { incidentId: row.incidentId },
			select: { id: true },
		});
		return rows.map((r) => r.id);
	}

	/** Every thread the block's threads started, at any depth, not in the block itself. */
	async descendants(ids: readonly string[]): Promise<string[]> {
		const seen = new Set(ids);
		const out: string[] = [];
		let frontier = [...ids];
		for (let depth = 0; frontier.length && depth < TREE_DEPTH_MAX; depth++) {
			const kids = await this.prisma.investigation.findMany({
				where: { parentId: { in: frontier } },
				select: { id: true },
			});
			frontier = kids.map((k) => k.id).filter((k) => !seen.has(k));
			for (const k of frontier) {
				seen.add(k);
				out.push(k);
			}
		}
		return out;
	}

	/** What settling `id`'s block would end, counted exactly, with a verdict per worktree. */
	async preview(id: string): Promise<SettlePreview> {
		const ids = await this.block(id);
		const children = await this.descendants(ids);
		const all = [...ids, ...children];
		const [wakes, feeds, agentWatches, crons, running, rows] =
			await Promise.all([
				this.prisma.threadWake.count({
					where: { investigationId: { in: all }, state: "pending" },
				}),
				this.prisma.prFeed.count({
					where: {
						investigationId: { in: all },
						state: { in: ["watching", "disconnected"] },
					},
				}),
				this.prisma.prWatch.count({ where: { investigationId: { in: all } } }),
				this.prisma.cronJob.count({ where: { investigationId: { in: all } } }),
				this.prisma.investigation.count({
					where: { id: { in: all }, status: { in: LIVE } },
				}),
				this.prisma.investigation.findMany({
					where: { id: { in: all } },
					select: { id: true, workspace: true },
				}),
			]);
		const worktrees: WorktreeVerdict[] = [];
		for (const r of rows) worktrees.push(...(await worktreeVerdicts(r)));
		return {
			wakes,
			watches: feeds + agentWatches,
			crons,
			children: children.length,
			running,
			worktrees,
		};
	}

	/** Live runs among these threads, for Settle's last look before it commits. */
	liveCount(ids: readonly string[]): Promise<number> {
		return this.prisma.investigation.count({
			where: { id: { in: [...ids] }, status: { in: LIVE } },
		});
	}

	/** How long Settle waits for a stopped run to reach a terminal state. */
	stopWaitMs = 10_000;

	/** Settle's stop: the run's process ends, and its last writes land, before this returns; its jobs wait for the teardown. */
	async stopRunning(ids: readonly string[]): Promise<number> {
		const live = await this.prisma.investigation.findMany({
			where: { id: { in: [...ids] }, status: { in: LIVE } },
			select: { id: true, status: true, incidentId: true },
		});
		const why = "Stopped when the thread was settled";
		const asked: string[] = [];
		for (const row of live) {
			if (
				row.status === "pending" &&
				(await this.dispatch.cancelPendingJob(row.id))
			) {
				if (
					!(await this.investigations.cancelPending(
						row.id,
						row.incidentId,
						why,
					))
				)
					asked.push(row.id);
				continue;
			}
			await this.investigations.markStopRequested(row.id);
			if ((await this.dispatch.requestCancel(row.id)) === 0) {
				await this.dispatch.cancelOrphanedRun(row.id);
				if (
					!(await this.investigations.cancelPending(
						row.id,
						row.incidentId,
						why,
					))
				)
					asked.push(row.id);
			} else asked.push(row.id);
		}
		await this.untilEnded(asked);
		return live.length;
	}

	/** A cancel only asks: the run's final usage flush lands after it, so Settle waits for the end, or refuses. */
	private async untilEnded(ids: string[]): Promise<void> {
		const deadline = Date.now() + this.stopWaitMs;
		let waiting = ids;
		while (waiting.length) {
			const live = await this.prisma.investigation.findMany({
				where: { id: { in: waiting }, status: { in: LIVE } },
				select: { id: true },
			});
			if (!live.length) return;
			if (Date.now() >= deadline)
				throw new ORPCError("CONFLICT", {
					message: `${plural(live.length, "run")} did not stop in time. Try again in a moment.`,
					data: { reason: "running", running: live.length },
				});
			waiting = live.map((r) => r.id);
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}

	/**
	 * Ends everything these threads started (#1024 surface F): every pending wake,
	 * PR watch, feed and cron job, open proposals, tree waits, and the tree allowance.
	 * The summary rides the thread's next turn and is written into the thread.
	 */
	async endThread(ids: readonly string[], children = 0): Promise<Ended> {
		const list = [...ids];
		if (!list.length)
			return { wakes: 0, watches: 0, crons: 0, cronNames: [], children: 0 };
		const now = new Date();
		const ended = await this.prisma.$transaction(async (tx) => {
			const crons = await tx.cronJob.findMany({
				where: { investigationId: { in: list } },
				select: { name: true },
			});
			const wakes = await tx.threadWake.updateMany({
				where: { investigationId: { in: list }, state: "pending" },
				data: { state: "cancelled", doneAt: now },
			});
			const feeds = await tx.prFeed.updateMany({
				where: {
					investigationId: { in: list },
					state: { in: ["watching", "disconnected"] },
				},
				data: { state: "stopped", reason: "settled", pending: null },
			});
			const watches = await tx.prWatch.deleteMany({
				where: { investigationId: { in: list } },
			});
			await tx.cronJob.deleteMany({ where: { investigationId: { in: list } } });
			await tx.proposal.updateMany({
				where: { threadId: { in: list }, state: "open" },
				data: { state: "dismissed", decidedAt: now },
			});
			await tx.pendingAction.updateMany({
				where: { callerId: { in: list }, state: "pending" },
				data: { state: "cancelled", decidedAt: now },
			});
			await tx.threadWait.deleteMany({ where: { waiterId: { in: list } } });
			await tx.treeAllowance.deleteMany({ where: { rootId: { in: list } } });
			return {
				wakes: wakes.count,
				watches: feeds.count + watches.count,
				crons: crons.length,
				cronNames: crons.map((c) => c.name).slice(0, 3),
				children,
			};
		});
		const line = endedLine(ended);
		if (line)
			for (const id of list) {
				const row = await this.prisma.investigation.findUnique({
					where: { id },
					select: { updatedAt: true },
				});
				// Keeps `updatedAt`, which the settled test falls back on.
				await this.prisma.investigation.updateMany({
					where: { id },
					data: {
						endedNote: line,
						...(row ? { updatedAt: row.updatedAt } : {}),
					},
				});
				await recordWatchEvent(this.prisma, this.bus, id, {
					kind: "jobs_ended",
					text: line,
				}).catch(() => undefined);
			}
		const done = await this.prisma.investigation.findMany({
			where: { id: { in: list }, status: { notIn: LIVE } },
			select: { id: true, status: true },
		});
		for (const r of done)
			if (isWorkflowTerminal(r.status))
				await releaseSettledWorkspace(r.id).catch((e: unknown) =>
					this.logger.warn(`Kept ${r.id}'s workspace: ${String(e)}`),
				);
		return ended;
	}

	/** Teardowns whose Undo window closed; each re-checks that its thread is still settled. */
	async teardownDue(now: Date = new Date()): Promise<void> {
		const due = await this.prisma.investigation.findMany({
			where: { teardownAt: { lte: now } },
			select: { id: true },
		});
		for (const { id } of due) {
			const still = await this.prisma.$transaction(async (tx) => {
				const row = await tx.investigation.findUnique({
					where: { id },
					select: {
						settledAt: true,
						lastActivityAt: true,
						updatedAt: true,
						teardownAt: true,
					},
				});
				if (!row?.teardownAt || row.teardownAt > now) return false;
				await tx.investigation.update({
					where: { id },
					data: { teardownAt: null, updatedAt: row.updatedAt },
				});
				// Undo or new activity unsettled it: nothing ends.
				return isSettled(row);
			});
			if (still)
				await this.endThread([id]).catch((e: unknown) =>
					this.logger.warn(`Teardown of ${id} failed: ${String(e)}`),
				);
		}
	}

	/**
	 * "Settle quiet threads": a thread with no incident, quiet for the settings' days,
	 * ends its jobs at once, as no one is there to undo. A live run or child keeps it.
	 */
	async autoSettle(now: Date = new Date()): Promise<void> {
		const days = await this.settleAfterDays();
		const quiet = new Date(now.getTime() - days * DAY_MS);
		const candidates = await this.prisma.investigation.findMany({
			where: {
				incidentId: null,
				status: { notIn: LIVE },
				teardownAt: null,
				OR: [
					{ lastActivityAt: { lt: quiet } },
					{ lastActivityAt: null, updatedAt: { lt: quiet } },
				],
				AND: [
					{
						OR: [
							{ wakes: { some: { state: "pending" } } },
							{ prWatches: { some: {} } },
							{ cronJobs: { some: {} } },
							{
								prFeeds: {
									some: { state: { in: ["watching", "disconnected"] } },
								},
							},
						],
					},
				],
			},
			select: { id: true },
			take: 50,
		});
		for (const { id } of candidates) {
			const kids = await this.descendants([id]);
			const live = kids.length
				? await this.prisma.investigation.count({
						where: { id: { in: kids }, status: { in: LIVE } },
					})
				: 0;
			if (live) continue;
			await this.endThread([id]);
		}
	}

	private async settleAfterDays(): Promise<number> {
		const row = await this.prisma.setting.findUnique({
			where: { key: THREAD_SETTINGS_KEY },
		});
		const v = safeParseJsonObject(row?.value ?? null)?.settleAfterDays;
		return typeof v === "number" && v >= 1 ? v : DEFAULT_SETTLE_AFTER_DAYS;
	}
}

/**
 * Per directory the thread worked in: removed when clean and pushed, kept with why
 * otherwise. The user's own checkout is never touched; only its lease is released.
 */
async function worktreeVerdicts(row: {
	id: string;
	workspace: string | null;
}): Promise<WorktreeVerdict[]> {
	const ws = RunWorkspaceSchema.safeParse(
		safeParseJsonObject(row.workspace),
	).data;
	if (!ws) return [];
	const out: WorktreeVerdict[] = [];
	for (const repo of ws.repos) {
		const dir = repo.dir;
		if (ws.layout === "in_place" || ws.layout === "folder") {
			out.push({
				threadId: row.id,
				dir,
				action: "keep",
				reason: "Your own folder: left as it is",
			});
			continue;
		}
		if (!existsSync(dir)) continue;
		out.push({ threadId: row.id, dir, ...(await dirVerdict(dir)) });
	}
	return out;
}

async function git(dir: string, args: string[]): Promise<string | null> {
	try {
		const { stdout } = await spawnGit(["-C", dir, ...args], {
			cwd: tmpdir(),
			env: gitEnv({ source: "machine", coreSshCommand: null }),
			timeoutMs: GIT_PROBE_TIMEOUT_MS,
		});
		return stdout;
	} catch {
		return null;
	}
}

/** Uncommitted or untracked files always keep it; so do commits on no remote. */
async function dirVerdict(
	dir: string,
): Promise<Pick<WorktreeVerdict, "action" | "reason">> {
	const status = await git(dir, ["status", "--porcelain"]);
	if (status === null) return { action: "keep", reason: "Could not read it" };
	const dirty = status.split("\n").filter((l) => l.trim()).length;
	if (dirty)
		return { action: "keep", reason: plural(dirty, "uncommitted file") };
	const ahead = Number(
		(
			await git(dir, ["rev-list", "--count", "HEAD", "--not", "--remotes"])
		)?.trim() ?? "0",
	);
	if (ahead > 0)
		return { action: "keep", reason: `${plural(ahead, "commit")} not pushed` };
	return { action: "remove" };
}
