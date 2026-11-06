// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	Inject,
	Injectable,
	type OnModuleDestroy,
	type OnModuleInit,
} from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import {
	type CanonicalEvent,
	PR_WATCH_EVERY_MS,
	PR_WATCH_FOR_MS,
	type PrWatchUntil,
	type PullRequest,
} from "@prismalens/contracts";
import { Logger } from "@prismalens/logger";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import {
	EVENT_BUS,
	type EventBus,
	type RelayMessage,
	runEventsTopic,
} from "../../infrastructure/dispatch/event-bus.js";
import type { WatchesData } from "../gateway/tools/watches.js";
import { WakesService } from "../wakes/wakes.service.js";
import { PullRequestsService } from "./pull-requests.service.js";
import { readThreadContextSettings } from "./thread-context-settings.js";

/** The agent's own wakes and PR watches write here, so they never race a live run's `seq`. */
export const WATCHES_BRANCH = "watches";
const SEQ_RETRIES = 8;
/** An agent may wake its own thread this often per day, and watch this many PRs at once (#1024 spec B). */
export const WAKES_PER_DAY = 12;
export const WATCHES_PER_THREAD = 5;
const DAY_MS = 24 * 60 * 60_000;
/** A host that does not answer is read again after 4, 8, 16… minutes, at most an hour apart. */
const BACKOFF_MAX_MS = 60 * 60_000;

const prName = (pr: Pick<PullRequest, "repo" | "number">) =>
	`${pr.repo}#${pr.number}`;

/** What ends a watch, in one line; null while it still waits. A closed or merged PR ends every watch. */
export function watchMet(pr: PullRequest, until: PrWatchUntil): string | null {
	if (pr.state === "merged") return "merged";
	if (pr.state === "closed") return "closed without merging";
	if (until === "merged") return null;
	if (until === "checks_done")
		return ["passing", "failing", "none"].includes(pr.checks.state)
			? `checks ${pr.checks.state}${pr.checks.failed ? ` (${pr.checks.failed} failed)` : ""}`
			: null;
	return pr.review === "approved"
		? "approved"
		: pr.review === "changes_requested"
			? "changes requested"
			: null;
}

/**
 * The agent's `wakeup_schedule`, `pr_link`, `pr_watch` and `pr_unwatch` (#1024 spec B).
 * A wake is surface C's `agent` or `pr_watch` kind, which C delivers at the thread's next
 * pause or resumes it with; a watch refreshes its PR every 2 minutes for up to 12 hours.
 */
@Injectable()
export class ThreadWatchesService
	implements WatchesData, OnModuleInit, OnModuleDestroy
{
	private readonly logger = new Logger({ context: "ThreadWatches" });
	private timer: ReturnType<typeof setInterval> | undefined;
	private ticking = false;
	/** Threads whose host did not answer: how often, and when to read it again. */
	private readonly failing = new Map<string, { fails: number; next: number }>();

	constructor(
		private readonly prisma: PrismaService,
		private readonly prs: PullRequestsService,
		private readonly wakes: WakesService,
		@Inject(EVENT_BUS) private readonly bus: EventBus,
	) {}

	onModuleInit(): void {
		this.timer = setInterval(() => {
			void this.tick().catch((e) =>
				this.logger.warn(`A PR watch pass failed: ${String(e)}`),
			);
		}, PR_WATCH_EVERY_MS);
		this.timer.unref?.();
	}

	onModuleDestroy(): void {
		if (this.timer) clearInterval(this.timer);
	}

	async wakeup(
		runId: string,
		delaySeconds: number,
		reason: string,
	): Promise<
		{ at: string; replaced: boolean } | { error: string; limit?: true }
	> {
		if (!(await this.thread(runId))) return { error: "This run is gone." };
		if (await this.overBudget(runId))
			return {
				error: `This thread already woke itself ${WAKES_PER_DAY} times in the last 24 hours.`,
				limit: true,
			};
		const replaced =
			(await this.wakes.latest(runId, "agent"))?.state === "pending";
		const at = new Date(Date.now() + delaySeconds * 1000);
		// The agent hears this as a message when it wakes; the event keeps its own words.
		const said = `The wake you scheduled (wakeup_schedule) is due: ${reason}`;
		await this.wakes.schedule(runId, "agent", at, said, {
			from: "wakeup_schedule",
		});
		await this.record(runId, {
			kind: "wake_scheduled",
			wakeKind: "agent",
			at: at.toISOString(),
			reason,
			...(replaced ? { replaced: true } : {}),
		});
		return { at: at.toISOString(), replaced };
	}

	async link(
		runId: string,
		url: string,
	): Promise<{ pr: PullRequest } | { error: string }> {
		try {
			return { pr: await this.prs.linkFromUser(runId, url, "agent") };
		} catch (e) {
			if (e instanceof ORPCError) return { error: e.message };
			throw e;
		}
	}

	async watch(
		runId: string,
		prId: string,
		until: PrWatchUntil,
	): Promise<
		{ expiresAt: string; pr: string } | { error: string; limit?: true }
	> {
		if (!(await readThreadContextSettings(this.prisma)).prStatus)
			return {
				error:
					'"Show pull request status" is off in Settings, so PrismaLens reads no PR state to watch.',
			};
		const pr = (await this.prs.stored(runId)).find((p) => p.id === prId);
		if (!pr)
			return {
				error: `No pull request "${prId}" is linked to this thread.`,
			};
		// Its condition already holds: the watch would wake the thread at once, again on every retry.
		const already = watchMet(pr, until);
		if (already)
			return {
				error: `Pull request ${prName(pr)} is already ${already}; there is nothing to watch for.`,
			};
		if (await this.overBudget(runId))
			return {
				error: `This thread already woke itself ${WAKES_PER_DAY} times in the last 24 hours.`,
				limit: true,
			};
		const watching = await this.prisma.prWatch.findMany({
			where: { investigationId: runId },
			select: { prId: true },
		});
		if (
			watching.length >= WATCHES_PER_THREAD &&
			!watching.some((w) => w.prId === prId)
		)
			return {
				error: `This thread already watches ${WATCHES_PER_THREAD} pull requests.`,
				limit: true,
			};
		const expiresAt = new Date(Date.now() + PR_WATCH_FOR_MS);
		await this.prisma.prWatch.upsert({
			where: { prId_investigationId: { prId, investigationId: runId } },
			create: { prId, investigationId: runId, until, expiresAt },
			update: { until, expiresAt },
		});
		await this.record(runId, {
			kind: "pr_watch",
			prId,
			pr: prName(pr),
			until,
			phase: "started",
		});
		return { expiresAt: expiresAt.toISOString(), pr: prName(pr) };
	}

	async unwatch(runId: string, prId: string): Promise<{ stopped: boolean }> {
		const row = await this.prisma.prWatch.findUnique({
			where: { prId_investigationId: { prId, investigationId: runId } },
		});
		if (!row) return { stopped: false };
		await this.prisma.prWatch.delete({
			where: { prId_investigationId: { prId, investigationId: runId } },
		});
		const pr = (await this.prs.stored(runId)).find((p) => p.id === prId);
		await this.record(runId, {
			kind: "pr_watch",
			prId,
			pr: pr ? prName(pr) : prId,
			until: row.until as PrWatchUntil,
			phase: "stopped",
		});
		return { stopped: true };
	}

	/** One pass: each watched thread's PRs read again from the host; a met or expired watch wakes it. */
	async tick(now: Date = new Date()): Promise<void> {
		if (this.ticking) return;
		this.ticking = true;
		try {
			// Turned off after the watch began: no host is read, and the watch waits or runs out.
			if (!(await readThreadContextSettings(this.prisma)).prStatus) return;
			const rows = await this.prisma.prWatch.findMany();
			const byThread = new Map<string, typeof rows>();
			for (const r of rows)
				byThread.set(r.investigationId, [
					...(byThread.get(r.investigationId) ?? []),
					r,
				]);
			// A thread that watches nothing any more forgets its backoff.
			for (const id of this.failing.keys())
				if (!byThread.has(id)) this.failing.delete(id);
			for (const [threadId, watches] of byThread) {
				const backoff = this.failing.get(threadId);
				if (backoff && backoff.next > now.getTime()) continue;
				const { pullRequests: prs, failed } = await this.prs
					.refreshForWatch(threadId)
					.catch(async () => ({
						pullRequests: await this.prs.stored(threadId),
						failed: true,
					}));
				if (failed) {
					const fails = (backoff?.fails ?? 0) + 1;
					this.failing.set(threadId, {
						fails,
						next:
							now.getTime() +
							Math.min(PR_WATCH_EVERY_MS * 2 ** fails, BACKOFF_MAX_MS),
					});
				} else this.failing.delete(threadId);
				for (const w of watches) {
					const until = w.until as PrWatchUntil;
					const pr = prs.find((p) => p.id === w.prId);
					const met = pr ? watchMet(pr, until) : "no longer linked";
					const expired = !met && w.expiresAt.getTime() <= now.getTime();
					if (!met && !expired) continue;
					await this.prisma.prWatch.deleteMany({
						where: { prId: w.prId, investigationId: threadId },
					});
					const name = pr ? prName(pr) : w.prId;
					const said = met
						? `Pull request ${name}: ${met}. You asked to hear when it was ${until.replace("_", " ")} (pr_watch).`
						: `Stopped watching pull request ${name} after 12 hours; it never became ${until.replace("_", " ")}.`;
					await this.wakeWith(threadId, said, now);
					await this.record(threadId, {
						kind: "pr_watch",
						prId: w.prId,
						pr: name,
						until,
						phase: met ? "met" : "expired",
						...(met ? { state: met } : {}),
					});
				}
			}
		} finally {
			this.ticking = false;
		}
	}

	/**
	 * One pending `pr_watch` wake per thread: a second watch that ends joins its reason.
	 * A wake already handed to the agent is not joined, so the agent never hears it twice.
	 */
	private async wakeWith(threadId: string, said: string, now: Date) {
		const pending = await this.wakes.latest(threadId, "pr_watch");
		const unsent =
			pending?.state === "pending" && pending.payload.sentTo === undefined;
		// Already in the waiting wake: rescheduling would only drop its other lines.
		if (unsent && pending.reason.split("\n").includes(said)) return;
		const reason = unsent ? `${pending.reason}\n${said}` : said;
		await this.wakes.schedule(threadId, "pr_watch", now, reason, {
			from: "pr_watch",
		});
	}

	/** The thread's own wakes in the last 24 hours, agent and PR watch alike, at the budget. */
	private async overBudget(runId: string): Promise<boolean> {
		const recent = await this.prisma.threadWake.count({
			where: {
				investigationId: runId,
				kind: { in: ["agent", "pr_watch"] },
				createdAt: { gte: new Date(Date.now() - DAY_MS) },
			},
		});
		return recent >= WAKES_PER_DAY;
	}

	private thread(id: string) {
		return this.prisma.investigation.findUnique({
			where: { id },
			select: { id: true },
		});
	}

	/** Appends one event on WATCHES_BRANCH after the thread's newest, retrying a lost race, and relays it. */
	private async record(
		threadId: string,
		body: Record<string, unknown>,
	): Promise<void> {
		for (let attempt = 0; ; attempt++) {
			try {
				const event = await this.prisma.$transaction(async (tx) => {
					const { _max } = await tx.investigationEvent.aggregate({
						where: { investigationId: threadId },
						_max: { seq: true },
					});
					const event = {
						...body,
						runId: threadId,
						branchId: WATCHES_BRANCH,
						path: [],
						seq: (_max.seq ?? -1) + 1,
						label: null,
						ts: new Date().toISOString(),
					} as unknown as CanonicalEvent;
					await tx.investigationEvent.create({
						data: {
							investigationId: threadId,
							seq: event.seq,
							branchId: WATCHES_BRANCH,
							event: JSON.stringify(event),
						},
					});
					return event;
				});
				this.bus.publish<RelayMessage>(runEventsTopic(threadId), {
					kind: "event",
					event,
				});
				return;
			} catch (e) {
				const taken = (e as { code?: string })?.code === "P2002";
				if (!taken || attempt >= SEQ_RETRIES) throw e;
			}
		}
	}
}
