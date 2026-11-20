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
	PR_WATCH_EVERY_MS,
	type PrHost,
	PrHostSchema,
	type PrWatch,
	type PullRequest,
	prLabel,
} from "@prismalens/contracts";
import { Logger } from "@prismalens/logger";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import {
	EVENT_BUS,
	type EventBus,
} from "../../infrastructure/dispatch/event-bus.js";
import { safeParseJsonObject } from "../../shared/utils/json-utils.js";
import { WakesService } from "../wakes/wakes.service.js";
import {
	baseline,
	current,
	diff,
	FEED_BATCH_MS,
	FEED_IDLE_MS,
	type FeedBatch,
	type FeedLine,
	FeedLineSchema,
	feedMessage,
	parseCursor,
	recorded,
	recordedMarks,
} from "./pr-feed.js";
import { type EtagCache, HostReadError } from "./pr-hosts.js";
import { parsePrUrl } from "./pr-url.js";
import {
	hostDown,
	PullRequestsService,
	pullRequestView,
} from "./pull-requests.service.js";
import { isSettled } from "./settled.js";
import { readThreadContextSettings } from "./thread-context-settings.js";
import { recordWatchEvent } from "./thread-watches.service.js";

/** A host that does not answer is read again after 4, 8, 16… minutes, at most an hour apart. */
const BACKOFF_MAX_MS = 60 * 60_000;
/** Feed rows the poll still reads; `expired` and `stopped` are final. */
const LIVE_STATES = ["watching", "disconnected"] as const;

interface Pending {
	firstAt: string;
	lines: FeedLine[];
}

function pendingOf(raw: string | null): Pending | null {
	const o = safeParseJsonObject(raw);
	if (!o || typeof o.firstAt !== "string" || !Array.isArray(o.lines))
		return null;
	const lines = o.lines.flatMap((l) => {
		const p = FeedLineSchema.safeParse(l);
		return p.success ? [p.data] : [];
	});
	return { firstAt: o.firstAt, lines };
}

/** The `pr_status` wake's payload: each PR's batch, and how many units it counts. */
interface FeedWakePayload {
	from: "pr_status";
	batches: FeedBatch[];
	units: number;
	[k: string]: unknown;
}

type FeedRow = {
	prId: string;
	investigationId: string;
	auto: boolean;
	state: string;
	reason: string | null;
	cursor: string | null;
	pending: string | null;
	since: Date;
	until: Date | null;
};

/**
 * Automatic PR status (#1024 surface F): one shared host read per PR every two
 * minutes, diffed against each watching thread's cursor; actionable changes go
 * to the agent as one `pr_status` wake per thread, the rest ride the next one.
 */
@Injectable()
export class PrFeedService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger({ context: "PrFeed" });
	private timer: ReturnType<typeof setInterval> | undefined;
	private ticking = false;

	constructor(
		private readonly prisma: PrismaService,
		private readonly prs: PullRequestsService,
		private readonly wakes: WakesService,
		@Inject(EVENT_BUS) private readonly bus: EventBus,
	) {}

	onModuleInit(): void {
		this.timer = setInterval(() => {
			void this.tick().catch((e) =>
				this.logger.warn(`A PR status pass failed: ${String(e)}`),
			);
		}, PR_WATCH_EVERY_MS);
		this.timer.unref?.();
	}

	onModuleDestroy(): void {
		if (this.timer) clearInterval(this.timer);
	}

	/** One pass: new automatic watches, one read per due PR, and each thread's delivery. */
	async tick(now: Date = new Date()): Promise<void> {
		if (this.ticking) return;
		this.ticking = true;
		try {
			if (!(await readThreadContextSettings(this.prisma)).prStatus) return;
			const candidates = await this.candidates();
			const feeds = await this.prisma.prFeed.findMany({
				where: { state: { in: [...LIVE_STATES] } },
				include: {
					pullRequest: { select: { url: true } },
					investigation: {
						select: {
							settledAt: true,
							lastActivityAt: true,
							updatedAt: true,
							teardownAt: true,
						},
					},
				},
			});
			const urls = new Map<string, { feeds: typeof feeds; new: string[] }>();
			const slot = (url: string) => {
				const s = urls.get(url) ?? { feeds: [], new: [] };
				urls.set(url, s);
				return s;
			};
			// Inside a settle's Undo window, and after it, a settled thread hears nothing.
			for (const f of feeds)
				if (!isSettled(f.investigation)) slot(f.pullRequest.url).feeds.push(f);
			for (const c of candidates) slot(c.url).new.push(c.id);
			for (const [url, s] of urls)
				await this.pollUrl(url, s.feeds, s.new, now).catch((e: unknown) =>
					this.logger.warn(`PR status for ${url} failed: ${String(e)}`),
				);
			await this.flushAll(now);
		} finally {
			this.ticking = false;
		}
	}

	/**
	 * PRs that may start an automatic watch: linked with no feed yet, on an open
	 * thread, from its branch or on a repository its workspace has a branch in.
	 */
	private async candidates(): Promise<Array<{ id: string; url: string }>> {
		const rows = await this.prisma.pullRequest.findMany({
			where: {
				feed: { is: null },
				state: { notIn: ["merged", "closed"] },
				investigation: { teardownAt: null },
			},
			select: {
				id: true,
				url: true,
				repo: true,
				source: true,
				investigationId: true,
				investigation: {
					select: { settledAt: true, lastActivityAt: true, updatedAt: true },
				},
			},
		});
		const out: Array<{ id: string; url: string }> = [];
		const branches = new Map<string, Array<{ repo: string }>>();
		for (const r of rows) {
			if (isSettled(r.investigation)) continue;
			if (r.source === "branch") {
				out.push(r);
				continue;
			}
			let b = branches.get(r.investigationId);
			if (!b) {
				b = await this.prs.threadBranches(r.investigationId).catch(() => []);
				branches.set(r.investigationId, b);
			}
			if (b.some((x) => x.repo === r.repo)) out.push(r);
		}
		return out;
	}

	private async pollUrl(
		url: string,
		feeds: Array<
			FeedRow & {
				investigation: { lastActivityAt: Date | null; updatedAt: Date };
			}
		>,
		fresh: string[],
		now: Date,
	): Promise<void> {
		const poll = await this.prisma.prPoll.findUnique({ where: { url } });
		if (poll && poll.nextPollAt > now) return;
		const cache = (safeParseJsonObject(poll?.etag ?? null) ?? {}) as EtagCache;
		let shared: Awaited<ReturnType<PullRequestsService["readShared"]>>;
		try {
			shared = await this.prs.readShared(url, cache);
		} catch (e) {
			const failures = (poll?.failures ?? 0) + 1;
			const down = hostDown(e);
			const refused =
				e instanceof HostReadError && (e.status === 401 || e.status === 403);
			const reason = refused
				? "The git host refused the credential"
				: "The git host is not answering";
			await this.prisma.prPoll.upsert({
				where: { url },
				create: {
					url,
					nextPollAt: this.backoff(now, failures, down),
					failures,
					lastError: reason,
				},
				update: {
					nextPollAt: this.backoff(now, failures, down),
					failures,
					lastError: reason,
				},
			});
			await this.prisma.prFeed.updateMany({
				where: { prId: { in: feeds.map((f) => f.prId) } },
				data: { state: "disconnected", reason },
			});
			return;
		}
		if (!shared) return;
		const { read, activity, head, viewer, own } = shared;
		if (head && read.headRef) {
			const threads = new Set([
				...feeds.map((f) => f.investigationId),
				...(
					await this.prisma.pullRequest.findMany({
						where: { id: { in: fresh } },
						select: { investigationId: true },
					})
				).map((r) => r.investigationId),
			]);
			const repo = parsePrUrl(url)?.repo ?? "remote";
			for (const id of threads)
				await this.prs
					.noteHead(id, read.headRef, repo, head)
					.catch(() => undefined);
		}
		await this.prisma.prPoll.upsert({
			where: { url },
			create: {
				url,
				headSha: read.headSha,
				etag: JSON.stringify(cache),
				nextPollAt: new Date(now.getTime() + PR_WATCH_EVERY_MS),
			},
			update: {
				headSha: read.headSha,
				etag: JSON.stringify(cache),
				nextPollAt: new Date(now.getTime() + PR_WATCH_EVERY_MS),
				failures: 0,
				lastError: null,
			},
		});
		const snap = {
			state: read.state,
			headSha: read.headSha,
			baseRef: read.baseRef,
			review: read.review,
			conflicts: read.conflicts,
			runs: read.detail.checkRuns ?? [],
			activity,
			viewer,
			own,
			...(parsePrUrl(url) ? { host: parsePrUrl(url)?.shape } : {}),
		};
		// A new watch starts from what the PR shows now, so nothing before it is news.
		for (const prId of fresh) {
			const row = await this.prisma.pullRequest.findUnique({
				where: { id: prId },
				select: { source: true, investigationId: true, repo: true },
			});
			if (!row || read.state === "merged" || read.state === "closed") continue;
			const own =
				row.source === "branch" ||
				(read.headRef !== null &&
					(read.headRepo === null || read.headRepo === row.repo) &&
					(await this.prs.threadBranches(row.investigationId)).some(
						(b) => b.repo === row.repo && b.branch === read.headRef,
					));
			if (!own) continue;
			await this.prisma.prFeed
				.create({
					data: {
						prId,
						investigationId: row.investigationId,
						auto: true,
						cursor: JSON.stringify(baseline(snap)),
					},
				})
				.catch(() => undefined);
		}
		for (const f of feeds) await this.advance(f, snap, read, now);
	}

	private backoff(now: Date, failures: number, down: boolean): Date {
		const wait = down
			? Math.min(PR_WATCH_EVERY_MS * 2 ** failures, BACKOFF_MAX_MS)
			: PR_WATCH_EVERY_MS;
		return new Date(now.getTime() + wait);
	}

	/** One thread's feed for one PR: expiry, the diff, the loop guard, and what waits. */
	private async advance(
		f: FeedRow & {
			investigation: { lastActivityAt: Date | null; updatedAt: Date };
		},
		snap: Parameters<typeof diff>[1],
		read: { title: string | null; headSha: string | null },
		now: Date,
	): Promise<void> {
		const row = await this.prisma.pullRequest.findUnique({
			where: { id: f.prId },
		});
		if (!row) return;
		const pr = pullRequestView(row);
		const label = `${pr.repo}#${pr.number}`;
		const named = prLabel(pr.host, pr.number);
		const active = f.investigation.lastActivityAt ?? f.investigation.updatedAt;
		const until = new Date(
			Math.max(active.getTime(), f.since.getTime()) + FEED_IDLE_MS,
		);
		if (until <= now) {
			await this.end(f.prId, "expired", "thread idle 7 days");
			await this.say(f.investigationId, {
				kind: "pr_status",
				prId: f.prId,
				pr: label,
				host: pr.host,
				tone: pr.tone,
				lines: [`Stopped watching ${named}: thread idle 7 days`],
				phase: "ended",
			});
			return;
		}
		const prev = parseCursor(f.cursor);
		const d = prev ? diff(prev, snap) : { ...diff(null, snap), lines: [] };
		const texts = recorded(d.lines.map((l) => l.text));
		const marks = recordedMarks(d.lines);
		if (d.guardTripped) {
			const text = `Stopped sending ${named} updates: ${d.guardTripped} still failing after 3 tries`;
			await this.prisma.$transaction([
				this.prisma.prFeed.update({
					where: { prId: f.prId },
					data: {
						state: "stopped",
						reason: `${d.guardTripped} still failing after 3 tries`,
						cursor: JSON.stringify(d.cursor),
						pending: null,
						guardFailures: { increment: 1 },
					},
				}),
				this.prisma.investigation.update({
					where: { id: f.investigationId },
					data: {
						autoPause: JSON.stringify({
							reason: "loop_guard",
							prId: f.prId,
							since: now.toISOString(),
						}),
					},
				}),
			]);
			await this.say(f.investigationId, {
				kind: "auto_paused",
				reason: "loop_guard",
				prId: f.prId,
				text,
			});
			return;
		}
		if (d.ended) {
			await this.prisma.prFeed.update({
				where: { prId: f.prId },
				data: {
					state: "stopped",
					reason: d.ended,
					cursor: JSON.stringify(d.cursor),
					pending: null,
				},
			});
			await this.say(f.investigationId, {
				kind: "pr_status",
				prId: f.prId,
				pr: label,
				host: pr.host,
				tone: pr.tone,
				checks: pr.checks,
				lines: texts,
				marks,
				phase: "ended",
			});
			return;
		}
		const held = pendingOf(f.pending);
		const lines = current([...(held?.lines ?? []), ...d.lines], read.headSha);
		await this.prisma.prFeed.update({
			where: { prId: f.prId },
			data: {
				state: "watching",
				reason: null,
				until,
				cursor: JSON.stringify(d.cursor),
				pending: lines.length
					? JSON.stringify({
							firstAt: held?.firstAt ?? now.toISOString(),
							lines,
						})
					: null,
			},
		});
		if (texts.length)
			await this.say(f.investigationId, {
				kind: "pr_status",
				prId: f.prId,
				pr: label,
				host: pr.host,
				tone: pr.tone,
				checks: pr.checks,
				lines: texts,
				marks,
				phase: "noted",
			});
	}

	/** Every thread's waiting lines join its `pr_status` wake, when one is open to them. */
	private async flushAll(now: Date): Promise<void> {
		const rows = await this.prisma.prFeed.findMany({
			where: { pending: { not: null }, state: "watching" },
			select: { investigationId: true },
			distinct: ["investigationId"],
		});
		for (const { investigationId } of rows)
			await this.flush(investigationId, now).catch((e: unknown) =>
				this.logger.warn(
					`PR status for ${investigationId} waits: ${String(e)}`,
				),
			);
	}

	/**
	 * Moves a thread's waiting lines into its unsent `pr_status` wake, or a new one
	 * due 60 s after the first line. A sent wake is sealed; lines wait for the next.
	 * Lines that wake nothing wait until a line that does.
	 */
	async flush(threadId: string, now: Date): Promise<void> {
		await this.prisma.$transaction(async (tx) => {
			const feeds = await tx.prFeed.findMany({
				where: {
					investigationId: threadId,
					pending: { not: null },
					state: "watching",
				},
				include: {
					pullRequest: {
						select: { number: true, title: true, headSha: true, host: true },
					},
				},
			});
			const open = await this.wakes.latest(threadId, "pr_status", tx);
			const unsent =
				open?.state === "pending" && open.payload.sentTo === undefined
					? open
					: null;
			if (open?.state === "pending" && !unsent) return;
			const prior = (unsent?.payload as FeedWakePayload | undefined)?.batches;
			const batches = new Map<string, FeedBatch>(
				(prior ?? []).map((b) => [b.prId, b]),
			);
			let wakes = unsent !== null;
			let firstAt = now;
			for (const f of feeds) {
				const p = pendingOf(f.pending);
				if (!p) continue;
				if (p.lines.some((l) => l.wake)) wakes = true;
				const at = new Date(p.firstAt);
				if (at < firstAt) firstAt = at;
			}
			if (!wakes) return;
			for (const f of feeds) {
				const p = pendingOf(f.pending);
				if (!p) continue;
				const had = batches.get(f.prId)?.lines ?? [];
				batches.set(f.prId, {
					prId: f.prId,
					number: f.pullRequest.number,
					title: f.pullRequest.title,
					...hostOf(f.pullRequest.host),
					lines: current([...had, ...p.lines], f.pullRequest.headSha),
				});
				await tx.prFeed.update({
					where: { prId: f.prId },
					data: { pending: null },
				});
			}
			const list = [...batches.values()].filter((b) => b.lines.length);
			if (!list.length) return;
			const payload: FeedWakePayload = {
				...(unsent?.payload ?? {}),
				from: "pr_status",
				batches: list,
				units: list.length,
			};
			await this.wakes.schedule(
				threadId,
				"pr_status",
				unsent?.at ?? new Date(firstAt.getTime() + FEED_BATCH_MS),
				feedMessage(list),
				payload,
				1,
				tx,
			);
		});
	}

	/** Each linked PR's watch for the panel; null when nothing watches it. */
	async watches(threadId: string): Promise<Map<string, PrWatch>> {
		const out = new Map<string, PrWatch>();
		const [feeds, agentWatches, wake] = await Promise.all([
			this.prisma.prFeed.findMany({ where: { investigationId: threadId } }),
			this.prisma.prWatch.findMany({ where: { investigationId: threadId } }),
			this.wakes.latest(threadId, "pr_status"),
		]);
		const queued = new Set(
			wake?.state === "pending"
				? ((wake.payload as Partial<FeedWakePayload>).batches ?? []).map(
						(b) => b.prId,
					)
				: [],
		);
		for (const f of feeds)
			out.set(f.prId, {
				state:
					f.state === "watching" &&
					(queued.has(f.prId) ||
						(pendingOf(f.pending)?.lines.some((l) => l.wake) ?? false))
						? "waiting"
						: (f.state as PrWatch["state"]),
				reason: f.reason,
				since: f.since.toISOString(),
				until: f.until?.toISOString() ?? null,
				auto: f.auto,
			});
		for (const w of agentWatches)
			if (!out.has(w.prId) || out.get(w.prId)?.state === "stopped")
				out.set(w.prId, {
					state: "watching",
					reason: null,
					since: new Date(
						w.expiresAt.getTime() - 12 * 60 * 60_000,
					).toISOString(),
					until: w.expiresAt.toISOString(),
					auto: false,
				});
		return out;
	}

	/** The PR list with each PR's watch (#1024 surface F). */
	async withWatches<T extends { pullRequests: PullRequest[] }>(
		threadId: string,
		list: T,
	): Promise<T> {
		const w = await this.watches(threadId);
		return {
			...list,
			pullRequests: list.pullRequests.map((p) => ({
				...p,
				watch: w.get(p.id) ?? null,
			})),
		};
	}

	/** The user's Watch: the feed starts, or restarts after a stop; a loop-guard pause on it clears. */
	async watch(threadId: string, prId: string): Promise<PullRequest> {
		const pr = await this.requirePr(threadId, prId);
		const now = new Date();
		await this.prisma.$transaction(async (tx) => {
			await tx.prFeed.upsert({
				where: { prId },
				create: { prId, investigationId: threadId, auto: false },
				update: {
					state: "watching",
					reason: null,
					since: now,
					guardFailures: 0,
				},
			});
			// The guard's streak restarts: the cursor keeps what was already said.
			const row = await tx.prFeed.findUnique({ where: { prId } });
			const c = parseCursor(row?.cursor);
			if (c)
				await tx.prFeed.update({
					where: { prId },
					data: { cursor: JSON.stringify({ ...c, guard: null }) },
				});
			const thread = await tx.investigation.findUnique({
				where: { id: threadId },
				select: { autoPause: true },
			});
			const pause = safeParseJsonObject(thread?.autoPause ?? null);
			if (pause?.reason === "loop_guard" && pause.prId === prId)
				await tx.investigation.update({
					where: { id: threadId },
					data: { autoPause: null },
				});
		});
		const w = await this.watches(threadId);
		return { ...pr, watch: w.get(prId) ?? null };
	}

	/** Stop watching: the feed and the agent's own `pl_pr_watch` on this PR end. */
	async unwatch(
		threadId: string,
		prId: string,
		by: "user" | "agent" = "user",
	): Promise<PullRequest> {
		const pr = await this.requirePr(threadId, prId);
		await this.end(
			prId,
			"stopped",
			by === "user" ? "Stopped by you" : "Stopped by the agent",
		);
		if (by === "user")
			await this.prisma.prWatch.deleteMany({
				where: { prId, investigationId: threadId },
			});
		const w = await this.watches(threadId);
		return { ...pr, watch: w.get(prId) ?? null };
	}

	private async end(
		prId: string,
		state: "stopped" | "expired",
		reason: string,
	): Promise<void> {
		await this.prisma.prFeed.updateMany({
			where: { prId },
			data: { state, reason, pending: null },
		});
	}

	private async requirePr(threadId: string, prId: string) {
		const pr = (await this.prs.stored(threadId)).find((p) => p.id === prId);
		if (!pr)
			throw new ORPCError("NOT_FOUND", {
				message: "That pull request is not linked to this thread.",
			});
		return pr;
	}

	private say(threadId: string, body: Record<string, unknown>): Promise<void> {
		return recordWatchEvent(this.prisma, this.bus, threadId, body);
	}
}

/** A stored host kind, when it is one the contract knows. */
function hostOf(raw: string): { host: PrHost } | Record<string, never> {
	const p = PrHostSchema.safeParse(raw);
	return p.success ? { host: p.data } : {};
}
