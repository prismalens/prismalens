// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	Inject,
	Injectable,
	type OnModuleDestroy,
	type OnModuleInit,
	Optional,
} from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import {
	type CanonicalEvent,
	defaultSpec,
	isWorkflowTerminal,
	PR_DELIVERY_URGENCY,
	PR_EVENT_GROUPS,
	PR_SUB,
	PR_WATCH_EVERY_MS,
	type PrDeliveryMode,
	type PrEventGroup,
	type PrEventKind,
	PrHostSchema,
	type PrSubCreator,
	type PrSubEndReason,
	type PrSubPause,
	type PrSubscriptionList,
	type PrSubscriptionSpec,
	type PrSubscriptionSpecInput,
	PrSubscriptionSpecSchema,
	type PrSubscriptionView,
	type PrWatch,
	type PrWatchUntil,
	type PullRequest,
	RunWorkspaceSchema,
	resolveSpec,
	subscriptionSummary,
} from "@prismalens/contracts";
import type { Prisma, PrSubscription } from "@prismalens/database";
import { sanitizeUntrustedLine } from "@prismalens/engine";
import { Logger } from "@prismalens/logger";
import { PrismaService } from "../../../core/prisma/prisma.service.js";
import { DispatchService } from "../../../infrastructure/dispatch/dispatch.service.js";
import {
	EVENT_BUS,
	type EventBus,
} from "../../../infrastructure/dispatch/event-bus.js";
import { safeParseJsonObject } from "../../../shared/utils/json-utils.js";
import { InvestigationsService } from "../../investigations/investigations.service.js";
import { InboxService } from "../../wakes/inbox.service.js";
import {
	BOOT_ID,
	SessionLifecycleService,
} from "../../wakes/session-lifecycle.service.js";
import { WakesService } from "../../wakes/wakes.service.js";
import type { EtagCache } from "../code-hosts/common.js";
import { HostReadError } from "../code-hosts/common.js";
import { parsePrUrl } from "../pr-url.js";
import {
	hostDown,
	PullRequestsService,
	pullRequestView,
} from "../pull-requests.service.js";
import { isSettled } from "../settled.js";
import { readThreadContextSettings } from "../thread-context-settings.js";
import { recordWatchEvent } from "../watch-events.js";
import {
	type DerivedEvent,
	derive,
	type EventPayload,
	legacyWatch,
	type PollCursor,
	parsePollCursor,
	translateFeedCursor,
} from "./derive.js";
import {
	endSubscriptions,
	LIVE_SUB_STATES,
	OPEN_DELIVERY_STATES,
} from "./ends.js";
import { isQuiet, passes, wants } from "./filter.js";
import {
	type BundleItem,
	type BundlePr,
	bundleTag,
	compose,
	legacyLines,
} from "./message.js";
import { isOwnItem, ownPush } from "./own-writes.js";
import { asRateLimited, pruneCache, readTick } from "./reads.js";

/** A host that does not answer is read again after 4, 8, 16… minutes, at most an hour apart. */
const BACKOFF_MAX_MS = 60 * 60_000;
/** A subscription lapses after this long with no thread activity (D7). */
const IDLE_MS = 7 * 24 * 60 * 60_000;
const LOOP_GUARD_HEADS = 3;
const PAYLOAD_MAX = 8000;
const DAY_MS = 24 * 60 * 60_000;
const TOOL_LIST_ENDED_MS = DAY_MS;
const RESEND_BACKOFF_MS = PR_SUB.resendMinutes.map((m) => m * 60_000);

export const PR_SUB_PROMISE =
	"Every new comment, review and force-push; check, thread and conflict changes as PrismaLens sees them, every 2 minutes. Each item has an id like [d12]; an id you saw before is a resend. Older ids may arrive late after a failed delivery; each item carries its time.";
const NEXT =
	"End your turn. Events come to you as messages; don't subscribe again on a wake.";
/** End reasons that tell the agent with a notice of their own (§5). */
const NOTICE_REASONS = new Set<PrSubEndReason>([
	"loop_guard",
	"comment_cap",
	"cancelled_by_user",
]);

type ThreadFacts = {
	settledAt: Date | null;
	lastActivityAt: Date | null;
	updatedAt: Date;
	teardownAt: Date | null;
	workspace: string | null;
	status: string;
};
type LiveSub = PrSubscription & { investigation: ThreadFacts };

/** A delivery with its live members and what each subscribes with. */
const DELIVERY_INCLUDE = {
	members: {
		where: { state: "member" },
		include: {
			subscription: {
				select: { id: true, spec: true, createdBy: true, prId: true },
			},
		},
	},
} satisfies Prisma.PrDeliveryInclude;
type DeliveryRow = Prisma.PrDeliveryGetPayload<{
	include: typeof DELIVERY_INCLUDE;
}>;

export type ToolAnswer =
	| { value: unknown }
	| {
			error:
				| "invalid_input"
				| "disabled"
				| "limit_reached"
				| "run_ended"
				| "not_found";
			message: string;
			next: string;
	  };

type ToolFailure = Extract<ToolAnswer, { error: unknown }>;

export interface SubscribeInput {
	pr: string;
	events?: PrEventGroup[];
	filter?: PrSubscriptionSpecInput["filter"];
	delivery?: PrDeliveryMode;
	batchMinutes?: number;
	once?: boolean;
}

function specOf(
	s: Pick<PrSubscription, "spec" | "createdBy">,
): PrSubscriptionSpec {
	const p = PrSubscriptionSpecSchema.safeParse(safeParseJsonObject(s.spec));
	return p.success ? p.data : defaultSpec(creatorOf(s.createdBy));
}
const creatorOf = (c: string): PrSubCreator =>
	c === "agent" || c === "auto" ? c : "user";
const originOf = (url: string) => {
	try {
		return new URL(url).origin;
	} catch {
		return url;
	}
};
const live = (state: string) =>
	(LIVE_SUB_STATES as readonly string[]).includes(state);
const parseJson = (raw: string | null): unknown => {
	try {
		return raw ? JSON.parse(raw) : null;
	} catch {
		return null;
	}
};

/**
 * Agents and people subscribe a thread to a PR's events (#1179): one shared read per URL
 * every two minutes, derived once, fanned out in event order to each thread's own
 * deliveries, bundled into one `pr_status` wake, and recorded delivered only on the
 * engine's receipt. Resends keep their ids; parked deliveries wait for a person.
 */
@Injectable()
export class PrSubscriptionsService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger({ context: "PrSubscriptions" });
	private timer: ReturnType<typeof setInterval> | undefined;
	private ticking = false;
	/** Origins refusing for a while, until epoch ms (D2). */
	private readonly cooling = new Map<string, number>();
	now: () => Date = () => new Date();

	constructor(
		private readonly prisma: PrismaService,
		private readonly prs: PullRequestsService,
		private readonly wakes: WakesService,
		private readonly sessions: SessionLifecycleService,
		private readonly dispatch: DispatchService,
		private readonly investigations: InvestigationsService,
		@Inject(EVENT_BUS) private readonly bus: EventBus,
		@Optional() private readonly inbox?: InboxService,
	) {}

	onModuleInit(): void {
		this.investigations.onEventsAppended((id, events) =>
			this.onEvents(id, events),
		);
		this.timer = setInterval(() => {
			void this.tick().catch((e) =>
				this.logger.warn(`A PR subscription pass failed: ${String(e)}`),
			);
		}, PR_WATCH_EVERY_MS);
		this.timer.unref?.();
	}

	onModuleDestroy(): void {
		if (this.timer) clearInterval(this.timer);
	}

	// ---- The tick ------------------------------------------------------------

	/** One pass: automatic subscriptions, one read per due URL, then each thread's delivery. */
	async tick(now: Date = this.now()): Promise<void> {
		if (this.ticking) return;
		this.ticking = true;
		try {
			const { prStatus } = await readThreadContextSettings(this.prisma);
			if (prStatus) {
				const candidates = await this.candidates();
				const subs = await this.prisma.prSubscription.findMany({
					where: { state: { in: [...LIVE_SUB_STATES] } },
					select: { url: true },
					distinct: ["url"],
				});
				const urls = new Map<string, string[]>();
				for (const s of subs) urls.set(s.url, []);
				for (const c of candidates)
					urls.set(c.url, [...(urls.get(c.url) ?? []), c.id]);
				for (const [url, fresh] of urls)
					await this.pollUrl(url, fresh, now).catch((e: unknown) =>
						this.logger.warn(`PR events for ${url} failed: ${String(e)}`),
					);
				await this.legacySweep(now);
			}
			await this.idleSweep(now);
			for (const id of await this.busyThreads())
				await this.deliver(id, now).catch((e: unknown) =>
					this.logger.warn(`PR events for ${id} wait: ${String(e)}`),
				);
			await this.announce();
		} finally {
			this.ticking = false;
		}
	}

	/** Rebuild, bundle and reconcile one thread's deliveries. */
	async deliver(threadId: string, now: Date = this.now()): Promise<void> {
		await this.rebuild(threadId);
		await this.bundle(threadId, now);
		await this.reconcile(threadId, now);
	}

	private async busyThreads(): Promise<string[]> {
		const [d, s] = await Promise.all([
			this.prisma.prDelivery.findMany({
				where: { state: { in: ["queued", "bundled"] } },
				select: { investigationId: true },
				distinct: ["investigationId"],
			}),
			this.prisma.prSubscription.findMany({
				where: { state: { in: [...LIVE_SUB_STATES] } },
				select: { investigationId: true },
				distinct: ["investigationId"],
			}),
		]);
		return [...new Set([...d, ...s].map((r) => r.investigationId))];
	}

	/**
	 * PRs that may start an automatic subscription, by today's rule: linked, never had an
	 * automatic one, on an open thread, from its branch or a repository its workspace is on.
	 */
	private async candidates(): Promise<Array<{ id: string; url: string }>> {
		const rows = await this.prisma.pullRequest.findMany({
			where: {
				subscriptions: { none: { createdBy: "auto" } },
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

	private async liveSubs(url: string): Promise<LiveSub[]> {
		return this.prisma.prSubscription.findMany({
			where: { url, state: { in: [...LIVE_SUB_STATES] } },
			include: {
				investigation: {
					select: {
						settledAt: true,
						lastActivityAt: true,
						updatedAt: true,
						teardownAt: true,
						workspace: true,
						status: true,
					},
				},
			},
			orderBy: { createdAt: "asc" },
		});
	}

	/** Inside a settle's Undo window a thread takes no events (D13). */
	private takes(s: LiveSub): boolean {
		return !(isSettled(s.investigation) && s.investigation.teardownAt);
	}

	/**
	 * One URL: the origin cooldown, the shared read, our paged reads, the derive, and the
	 * fan-out with the cursor in one transaction. A refusal leaves the cursor as it was.
	 */
	async pollUrl(
		url: string,
		fresh: string[],
		now: Date,
		opts: { force?: boolean; baseline?: boolean } = {},
	): Promise<"read" | "cooling" | "failed" | "skipped"> {
		const origin = originOf(url);
		const cool = this.cooling.get(origin);
		if (cool !== undefined && cool > now.getTime()) return "cooling";
		const poll = await this.prisma.prPoll.findUnique({ where: { url } });
		if (poll?.lastError === "rate_limited" && poll.nextPollAt > now)
			return "cooling";
		if (!opts.force && poll && poll.nextPollAt > now) return "skipped";
		const cache = (safeParseJsonObject(poll?.etag ?? null) ?? {}) as EtagCache;
		let shared: Awaited<ReturnType<PullRequestsService["readShared"]>>;
		try {
			shared = await this.prs.readShared(url, cache);
		} catch (e) {
			return this.readFailed(url, poll?.failures ?? 0, e, now);
		}
		if (!shared) return "skipped";
		const { read, head } = shared;
		const pr = parsePrUrl(url);
		if (!pr) return "skipped";
		const before = await this.liveSubs(url);
		if (head && read.headRef) {
			const threads = new Set(before.map((s) => s.investigationId));
			for (const id of fresh) {
				const row = await this.prisma.pullRequest.findUnique({
					where: { id },
					select: { investigationId: true },
				});
				if (row) threads.add(row.investigationId);
			}
			for (const id of threads)
				await this.prs
					.noteHead(id, read.headRef, pr.repo, head)
					.catch(() => undefined);
		}
		const autos = await this.autoSubscribe(fresh, read, now);
		const subs = autos.length ? await this.liveSubs(url) : before;
		const cursorRow = parsePollCursor(poll?.cursor);
		const cursor = cursorRow ?? (await this.translated(url));
		const groups = new Set<PrEventGroup>(
			opts.baseline || !cursor
				? PR_EVENT_GROUPS
				: subs
						.filter((s) => !s.legacyUntil && this.takes(s))
						.flatMap((s) => specOf(s).events),
		);
		let read2: Awaited<ReturnType<typeof readTick>>;
		try {
			read2 = await readTick({
				req: shared.req,
				apiBase: shared.apiBase,
				host: pr.shape,
				repo: pr.repo,
				number: pr.number,
				prUrl: url,
				read,
				cursor,
				groups,
				cache,
				now,
			});
		} catch (e) {
			return this.readFailed(url, poll?.failures ?? 0, e, now);
		}
		const { snap, touched } = read2;
		const ledger = await this.prisma.prOwnWrite.findMany({ where: { url } });
		const facts = { viewer: shared.viewer, detailOwn: shared.own, ledger };
		for (const i of snap.items) i.own = isOwnItem(i, facts);
		const derived = derive(cursor, snap, now);
		pruneCache(cache, touched);
		const pushes = await this.ownPushes(subs, derived.events, read.headRef);
		const ledgerAccounts = new Set(ledger.map((l) => l.account.toLowerCase()));
		const reviewers = new Set<string>([
			...(read.detail.reviewers ?? []).map((r) => r.login.toLowerCase()),
			...snap.items
				.filter((i) => i.source === "rv" && i.login)
				.map((i) => (i.login as string).toLowerCase()),
		]);
		const onceTaken = new Set(
			(
				await this.prisma.prDeliveryMember.findMany({
					where: {
						subscriptionId: { in: subs.map((s) => s.id) },
						delivery: { state: { in: ["bundled", "delivered"] } },
					},
					select: { subscriptionId: true },
				})
			).map((m) => m.subscriptionId),
		);
		const tripped: Array<{ sub: LiveSub; key: string }> = [];
		await this.prisma.$transaction(async (tx) => {
			const filtered = new Map<string, number>();
			const byThread = new Map<string, LiveSub[]>();
			// Re-read inside the write: a cancel during the host reads must not get members (OBJ-035).
			const live = new Set(
				(
					await tx.prSubscription.findMany({
						where: {
							id: { in: subs.map((s) => s.id) },
							state: { in: [...LIVE_SUB_STATES] },
						},
						select: { id: true },
					})
				).map((r) => r.id),
			);
			for (const s of subs)
				if (live.has(s.id) && this.takes(s))
					byThread.set(s.investigationId, [
						...(byThread.get(s.investigationId) ?? []),
						s,
					]);
			// Events outer, in order: `PrDelivery.id` order is event order (D5).
			for (const e of derived.events) {
				const payload: EventPayload = {
					...e.payload,
					quiet: isQuiet(e.payload, ledgerAccounts),
				};
				for (const [thread, list] of byThread) {
					const matching: LiveSub[] = [];
					for (const s of list) {
						if (s.legacyUntil) continue;
						const spec = specOf(s);
						if (!wants(spec, e.kind)) continue;
						if (now.getTime() <= s.since.getTime()) continue;
						if (e.kind === "push" && pushes.has(`${thread}:${e.headSha}`))
							continue;
						if (!passes(spec, { kind: e.kind, payload }, { reviewers })) {
							filtered.set(s.id, (filtered.get(s.id) ?? 0) + 1);
							continue;
						}
						if (spec.once && onceTaken.has(s.id)) continue;
						matching.push(s);
					}
					if (!matching.length) continue;
					const key = {
						investigationId: thread,
						url,
						dedupeKey: e.dedupeKey,
					};
					const exists = await tx.prDelivery.findUnique({
						where: { investigationId_url_dedupeKey: key },
						select: { id: true },
					});
					if (exists) continue;
					const d = await tx.prDelivery.create({
						data: {
							...key,
							kind: e.kind,
							payload: boundedPayload(payload),
							occurredAt: e.occurredAt,
							detectedAt: now,
						},
					});
					await tx.prDeliveryMember.createMany({
						data: matching.map((s) => ({
							deliveryId: d.id,
							subscriptionId: s.id,
						})),
					});
				}
			}
			for (const [id, n] of filtered)
				await tx.prSubscription.update({
					where: { id },
					data: { filteredCount: { increment: n } },
				});
			// The loop guard, per subscription (D19).
			if (cursor && snap.checks && derived.head) {
				const head = derived.head;
				for (const s of subs) {
					if (s.legacyUntil || !this.takes(s)) continue;
					if (!specOf(s).events.includes("checks")) continue;
					const g = guardOf(s.guard);
					let next = g;
					if (g && derived.failingNow.includes(g.key)) {
						if (!g.heads.includes(head))
							next = { key: g.key, heads: [...g.heads, head] };
					} else {
						if (g && derived.passingNow.includes(g.key)) next = null;
						const first = derived.failingNow[0];
						if (first && !next) next = { key: first, heads: [head] };
					}
					if (JSON.stringify(next) === JSON.stringify(g)) continue;
					await tx.prSubscription.update({
						where: { id: s.id },
						data: { guard: next ? JSON.stringify(next) : null },
					});
					if (next && next.heads.length >= LOOP_GUARD_HEADS) {
						await endSubscriptions(tx, { id: s.id }, "loop_guard", now);
						tripped.push({ sub: s, key: next.key });
					}
				}
			}
			// Merged or closed ends them only once every history list is read through (OBJ-036).
			if (derived.ended && !snap.more)
				await endSubscriptions(
					tx,
					{ url, legacyUntil: null },
					derived.ended,
					now,
				);
			await tx.prSubscription.updateMany({
				where: { url, state: "disconnected" },
				data: { state: "active" },
			});
			const data = {
				headSha: read.headSha,
				etag: JSON.stringify(cache),
				cursor: JSON.stringify(derived.cursor),
				nextPollAt: new Date(now.getTime() + PR_WATCH_EVERY_MS),
				failures: 0,
				lastError: null,
			};
			await tx.prPoll.upsert({
				where: { url },
				create: { url, ...data },
				update: data,
			});
		});
		for (const { sub } of tripped) {
			const name = await this.prName(sub.prId);
			await this.say(sub.investigationId, {
				kind: "auto_paused",
				reason: "loop_guard",
				prId: sub.prId,
				text: `Stopped one subscription on ${name}: a check kept failing on 3 pushes`,
			});
		}
		for (const s of autos) await this.started(s, "auto");
		return "read";
	}

	private async readFailed(
		url: string,
		failures: number,
		e: unknown,
		now: Date,
	): Promise<"cooling" | "failed"> {
		const limited = asRateLimited(e, now);
		if (limited) {
			await this.coolDown(url, limited.retryAt, now);
			return "cooling";
		}
		const n = failures + 1;
		const down = hostDown(e);
		const refused =
			e instanceof HostReadError && (e.status === 401 || e.status === 403);
		const reason = refused
			? "The git host refused the credential"
			: "The git host is not answering";
		const next = new Date(
			now.getTime() +
				(down
					? Math.min(PR_WATCH_EVERY_MS * 2 ** n, BACKOFF_MAX_MS)
					: PR_WATCH_EVERY_MS),
		);
		await this.prisma.prPoll.upsert({
			where: { url },
			create: { url, nextPollAt: next, failures: n, lastError: reason },
			update: { nextPollAt: next, failures: n, lastError: reason },
		});
		await this.prisma.prSubscription.updateMany({
			where: { url, state: "active" },
			data: { state: "disconnected" },
		});
		return "failed";
	}

	/** A refusal silences every subscription read of the origin until `retryAt` (D2). */
	private async coolDown(
		url: string,
		retryAt: number,
		now: Date,
	): Promise<void> {
		const origin = originOf(url);
		const until = new Date(Math.max(retryAt, now.getTime() + 1000));
		this.cooling.set(origin, until.getTime());
		await this.prisma.prPoll.upsert({
			where: { url },
			create: { url, nextPollAt: until, lastError: "rate_limited" },
			update: { nextPollAt: until, lastError: "rate_limited" },
		});
		await this.prisma.prPoll.updateMany({
			where: { url: { startsWith: `${origin}/` } },
			data: { nextPollAt: until, lastError: "rate_limited" },
		});
	}

	/** The first poll after an upgrade starts from the newest feed's cursor (D20). */
	private async translated(url: string): Promise<PollCursor | null> {
		const feed = await this.prisma.prFeed.findFirst({
			where: { pullRequest: { url }, cursor: { not: null } },
			orderBy: { updatedAt: "desc" },
			select: { cursor: true },
		});
		return translateFeedCursor(feed?.cursor ?? null);
	}

	/** Pushes each thread made itself, by the full head it moved to (D9). */
	private async ownPushes(
		subs: LiveSub[],
		events: DerivedEvent[],
		ref: string | null,
	): Promise<Set<string>> {
		const out = new Set<string>();
		const shas = [
			...new Set(
				events
					.filter((e) => e.kind === "push" && e.headSha)
					.map((e) => e.headSha as string),
			),
		];
		if (!shas.length) return out;
		const threads = new Map<string, string[]>();
		for (const s of subs)
			if (!threads.has(s.investigationId))
				threads.set(
					s.investigationId,
					(
						RunWorkspaceSchema.safeParse(
							safeParseJsonObject(s.investigation.workspace),
						).data?.repos ?? []
					).map((r) => r.dir),
				);
		for (const [thread, dirs] of threads)
			for (const sha of shas)
				if (await ownPush(dirs, ref, sha)) out.add(`${thread}:${sha}`);
		return out;
	}

	/** Today's automatic rule (#1024 surface F): a PR on the thread's own branch. */
	private async autoSubscribe(
		fresh: string[],
		read: { state: string; headRef: string | null; headRepo: string | null },
		now: Date,
	): Promise<PrSubscription[]> {
		const out: PrSubscription[] = [];
		if (read.state === "merged" || read.state === "closed") return out;
		for (const prId of fresh) {
			const row = await this.prisma.pullRequest.findUnique({
				where: { id: prId },
				select: {
					id: true,
					url: true,
					source: true,
					investigationId: true,
					repo: true,
				},
			});
			if (!row) continue;
			const own =
				row.source === "branch" ||
				(read.headRef !== null &&
					(read.headRepo === null || read.headRepo === row.repo) &&
					(await this.prs.threadBranches(row.investigationId)).some(
						(b) => b.repo === row.repo && b.branch === read.headRef,
					));
			if (!own) continue;
			out.push(
				await this.prisma.prSubscription.create({
					data: {
						investigationId: row.investigationId,
						prId: row.id,
						url: row.url,
						createdBy: "auto",
						spec: JSON.stringify(defaultSpec("auto")),
						since: now,
					},
				}),
			);
		}
		return out;
	}

	/** Migrated watches fire as they did (D22); level-triggered, so a later met still fires. */
	private async legacySweep(now: Date): Promise<void> {
		const subs = await this.prisma.prSubscription.findMany({
			where: {
				state: { in: [...LIVE_SUB_STATES] },
				legacyUntil: { not: null },
			},
			include: { pullRequest: true },
		});
		for (const s of subs) {
			const until = s.legacyUntil as PrWatchUntil;
			const view = pullRequestView(s.pullRequest);
			const fired = legacyWatch(
				view,
				until,
				s.expiresAt,
				now,
				`${view.repo}#${view.number}`,
			);
			if (!fired) continue;
			await this.prisma.$transaction(async (tx) => {
				const ended = await endSubscriptions(tx, { id: s.id }, fired.end, now);
				if (!ended.length) return;
				const d = await tx.prDelivery.create({
					data: {
						investigationId: s.investigationId,
						url: s.url,
						dedupeKey: `legacy-watch:${s.id}`,
						kind: "legacy",
						payload: JSON.stringify({ lines: [fired.text] }),
						occurredAt: now,
						detectedAt: now,
					},
				});
				await tx.prDeliveryMember.create({
					data: { deliveryId: d.id, subscriptionId: s.id },
				});
			});
		}
	}

	/** A thread quiet 7 days lets its subscriptions go (D7). */
	private async idleSweep(now: Date): Promise<void> {
		const subs = await this.prisma.prSubscription.findMany({
			where: { state: { in: [...LIVE_SUB_STATES] }, legacyUntil: null },
			include: {
				investigation: { select: { lastActivityAt: true, updatedAt: true } },
			},
		});
		for (const s of subs) {
			const active =
				s.investigation.lastActivityAt ?? s.investigation.updatedAt;
			if (
				Math.max(active.getTime(), s.since.getTime()) + IDLE_MS >
				now.getTime()
			)
				continue;
			await this.prisma.$transaction((tx) =>
				endSubscriptions(tx, { id: s.id }, "expired", now),
			);
		}
	}

	// ---- Bundles -------------------------------------------------------------

	private async threadRow(id: string) {
		return this.prisma.investigation.findUnique({
			where: { id },
			select: {
				status: true,
				settledAt: true,
				lastActivityAt: true,
				updatedAt: true,
				teardownAt: true,
				autoPause: true,
			},
		});
	}

	private deliveryRows(
		where: Prisma.PrDeliveryWhereInput,
	): Promise<DeliveryRow[]> {
		return this.prisma.prDelivery.findMany({
			where,
			include: DELIVERY_INCLUDE,
			orderBy: { id: "asc" },
		});
	}

	/** A delivery's mode: its most urgent live member's; a notice waits for a pause. */
	private modeOf(d: DeliveryRow): PrDeliveryMode {
		if (d.kind === "subscription_ended") return "next_pause";
		let best: PrDeliveryMode = "next_pause";
		for (const m of d.members) {
			const mode = specOf(m.subscription).delivery;
			if (PR_DELIVERY_URGENCY[mode] > PR_DELIVERY_URGENCY[best]) best = mode;
		}
		return best;
	}

	private batchMs(d: DeliveryRow): number {
		const mins = d.members
			.map((m) => specOf(m.subscription))
			.filter((s) => s.delivery === "batch")
			.map((s) => s.batchMinutes ?? PR_SUB.batchMinutes);
		return (mins.length ? Math.min(...mins) : PR_SUB.batchMinutes) * 60_000;
	}

	/** The deliveries as bundled PRs: at most 10 PRs, 20 detailed items each (D8). */
	private async render(
		threadId: string,
		rows: DeliveryRow[],
	): Promise<{
		prs: BundlePr[];
		taken: DeliveryRow[];
		left: DeliveryRow[];
		superseded: DeliveryRow[];
	}> {
		const prRows = await this.prisma.pullRequest.findMany({
			where: { investigationId: threadId },
		});
		const byUrl = new Map(prRows.map((p) => [p.url, p]));
		const groups = new Map<string, DeliveryRow[]>();
		const superseded: DeliveryRow[] = [];
		for (const d of rows) {
			const payload = (parseJson(d.payload) ?? {}) as EventPayload;
			const row = byUrl.get(d.url);
			const head = row?.headSha?.slice(0, 7).toLowerCase();
			if (
				d.kind === "check" &&
				payload.check?.state === "failing" &&
				payload.sha &&
				head &&
				payload.sha !== head
			) {
				superseded.push(d);
				continue;
			}
			groups.set(d.url, [...(groups.get(d.url) ?? []), d]);
		}
		const prs: BundlePr[] = [];
		const taken: DeliveryRow[] = [];
		const left: DeliveryRow[] = [];
		for (const [url, list] of groups) {
			if (prs.length >= PR_SUB.bundlePrs) {
				left.push(...list);
				continue;
			}
			const row = byUrl.get(url);
			const parsed = parsePrUrl(url);
			const items = list.map((d): BundleItem => {
				const raw = parseJson(d.payload);
				return {
					id: d.id,
					kind: d.kind as PrEventKind,
					payload:
						d.kind === "legacy" ? {} : ((raw ?? {}) as BundleItem["payload"]),
					occurredAt: d.occurredAt,
					...(d.kind === "legacy" ? { lines: legacyLines(raw) } : {}),
				};
			});
			const subs = [
				...new Set(list.flatMap((d) => d.members.map((m) => m.subscriptionId))),
			];
			let mode: PrDeliveryMode = "next_pause";
			for (const d of list) {
				const m = this.modeOf(d);
				if (PR_DELIVERY_URGENCY[m] > PR_DELIVERY_URGENCY[mode]) mode = m;
			}
			prs.push({
				prId: row?.id ?? list[0]?.members[0]?.subscription.prId ?? url,
				url,
				label: row
					? `${row.repo}#${row.number}`
					: parsed
						? `${parsed.repo}#${parsed.number}`
						: url,
				number: row?.number ?? parsed?.number ?? 0,
				host:
					PrHostSchema.safeParse(row?.host).data ?? parsed?.shape ?? "other",
				title: row?.title ?? null,
				subscriptionIds: subs,
				delivery: mode,
				items: items.slice(0, PR_SUB.bundleItems),
				more: items.slice(PR_SUB.bundleItems),
				superseded: {
					count: superseded.filter((s) => s.url === url).length,
					to: row?.headSha ?? null,
				},
			});
			taken.push(...list);
		}
		return { prs, taken, left, superseded };
	}

	/**
	 * Due queued deliveries join the thread's unsent `pr_status` wake, or a new one (§4.4).
	 * A sent wake is sealed: `fire()` alone sends it again (D23).
	 */
	async bundle(threadId: string, now: Date = this.now()): Promise<void> {
		const thread = await this.threadRow(threadId);
		if (!thread) return;
		const running = !isWorkflowTerminal(thread.status);
		await this.sessions.withThreadLock(threadId, async () => {
			const open = await this.wakes.latest(threadId, "pr_status");
			let unsent: typeof open = null;
			if (open?.state === "pending") {
				const seen = await this.sessions.wakeSeen(threadId, open.id);
				if (open.payload.sentTo !== undefined || seen !== "missing") return;
				unsent = open;
			}
			const queued = await this.deliveryRows({
				investigationId: threadId,
				state: "queued",
				members: { some: { state: "member" } },
			});
			const legacyWake =
				unsent &&
				!Array.isArray(unsent.payload.deliveryIds) &&
				Array.isArray(unsent.payload.batches)
					? unsent
					: null;
			if (!queued.length && !legacyWake) return;
			const ready = queued.filter((d) => !d.retryAt || d.retryAt <= now);
			const due =
				unsent !== null ||
				(running && ready.length > 0) ||
				ready.some((d) => this.modeOf(d) === "wake") ||
				ready.some(
					(d) =>
						this.modeOf(d) === "batch" &&
						now.getTime() - d.detectedAt.getTime() >= this.batchMs(d),
				);
			if (!due) return;
			if (legacyWake) await this.legacyWakeDelivery(threadId, legacyWake);
			const joined = unsent
				? await this.deliveryRows({
						investigationId: threadId,
						state: { in: ["queued", "bundled"] },
						OR: [{ wakeId: unsent.id }, { state: "queued" }],
						members: { some: { state: "member" } },
					})
				: await this.deliveryRows({
						investigationId: threadId,
						state: "queued",
						members: { some: { state: "member" } },
					});
			const { prs, taken, left, superseded } = await this.render(
				threadId,
				joined,
			);
			await this.prisma.$transaction(async (tx) => {
				if (superseded.length)
					await tx.prDelivery.updateMany({
						where: { id: { in: superseded.map((d) => d.id) } },
						data: { state: "discarded", discardReason: "superseded" },
					});
				if (left.length)
					await tx.prDelivery.updateMany({
						where: { id: { in: left.map((d) => d.id) } },
						data: { state: "queued", wakeId: null },
					});
				if (!taken.length) {
					if (unsent)
						await tx.threadWake.updateMany({
							where: { id: unsent.id, state: "pending" },
							data: { state: "cancelled", doneAt: now },
						});
					return;
				}
				const bundle = compose(prs, bundleTag());
				const prev = [
					...new Set(
						taken.map((d) => d.prevWakeId).filter((x): x is string => !!x),
					),
				];
				const prevWakes = prev.length
					? await tx.threadWake.findMany({
							where: { id: { in: prev } },
							select: { payload: true },
						})
					: [];
				const supersedes = [
					...new Set([
						...stringsOf(unsent?.payload.supersedes),
						...(unsent ? [unsent.id] : []),
						...prev,
						...prevWakes.flatMap((w) =>
							stringsOf(safeParseJsonObject(w.payload)?.supersedes),
						),
					]),
				];
				const resume = taken.some((d) => this.modeOf(d) !== "next_pause");
				const wakeId = await this.wakes.schedule(
					threadId,
					"pr_status",
					unsent?.at ?? now,
					bundle.text,
					{
						from: "pr_status",
						units: 1,
						resume,
						summary: bundle.summary,
						prEvents: bundle.prEvents,
						deliveryIds: taken.map((d) => d.id),
						supersedes,
					},
					1,
					tx,
				);
				await tx.prDelivery.updateMany({
					where: { id: { in: taken.map((d) => d.id) } },
					data: { state: "bundled", wakeId },
				});
			});
		});
	}

	/** An unsent wake from before #1179 becomes one delivery, so it rides the new bundle. */
	private async legacyWakeDelivery(
		threadId: string,
		wake: { id: string; payload: Record<string, unknown> },
	): Promise<void> {
		const batches = Array.isArray(wake.payload.batches)
			? (wake.payload.batches as Array<{ prId?: unknown }>)
			: [];
		const prIds = batches
			.map((b) => b.prId)
			.filter((x): x is string => typeof x === "string");
		const subs = await this.prisma.prSubscription.findMany({
			where: { investigationId: threadId, state: { in: [...LIVE_SUB_STATES] } },
		});
		const members = subs.filter(
			(s) => s.createdBy !== "agent" && prIds.includes(s.prId),
		).length
			? subs.filter((s) => s.createdBy !== "agent" && prIds.includes(s.prId))
			: subs.slice(0, 1);
		const first = members[0];
		if (!first) return;
		const exists = await this.prisma.prDelivery.findUnique({
			where: {
				investigationId_url_dedupeKey: {
					investigationId: threadId,
					url: first.url,
					dedupeKey: `legacy-wake:${wake.id}`,
				},
			},
		});
		if (exists) return;
		const d = await this.prisma.prDelivery.create({
			data: {
				investigationId: threadId,
				url: first.url,
				dedupeKey: `legacy-wake:${wake.id}`,
				kind: "legacy",
				payload: JSON.stringify(batches),
				occurredAt: this.now(),
			},
		});
		await this.prisma.prDeliveryMember.createMany({
			data: members.map((s) => ({ deliveryId: d.id, subscriptionId: s.id })),
		});
	}

	/**
	 * A bundled delivery that lost its last member is cut from its wake (D18): an unsent or
	 * lost wake is rewritten or cancelled, a queued one edited or withdrawn in the live run;
	 * text already out stays and counts as already sent.
	 */
	async rebuild(threadId: string): Promise<void> {
		const cut = await this.prisma.prDelivery.findMany({
			where: {
				investigationId: threadId,
				state: "bundled",
				members: { none: { state: "member" } },
			},
			select: { id: true, wakeId: true },
		});
		if (!cut.length) return;
		await this.sessions.withThreadLock(threadId, async () => {
			const byWake = new Map<string, number[]>();
			for (const c of cut)
				byWake.set(c.wakeId ?? "", [
					...(byWake.get(c.wakeId ?? "") ?? []),
					c.id,
				]);
			for (const [wakeId, ids] of byWake) {
				const discard = () =>
					this.prisma.prDelivery.updateMany({
						where: { id: { in: ids }, state: "bundled" },
						data: { state: "discarded", discardReason: "withdrawn" },
					});
				const wake = wakeId
					? await this.prisma.threadWake.findUnique({ where: { id: wakeId } })
					: null;
				if (!wake || wake.state === "cancelled" || wake.state === "skipped") {
					await discard();
					continue;
				}
				if (wake.state !== "pending") continue;
				const payload = safeParseJsonObject(wake.payload) ?? {};
				const seen = await this.sessions.wakeSeen(threadId, wakeId);
				if (seen === "delivered") continue;
				const remaining = await this.deliveryRows({
					investigationId: threadId,
					state: "bundled",
					wakeId,
					members: { some: { state: "member" } },
				});
				const rendered = remaining.length
					? await this.render(threadId, remaining)
					: null;
				const bundle = rendered?.taken.length
					? compose(rendered.prs, bundleTag())
					: null;
				const next = bundle
					? {
							...payload,
							summary: bundle.summary,
							prEvents: bundle.prEvents,
							deliveryIds: rendered?.taken.map((d) => d.id) ?? [],
							resume:
								rendered?.taken.some((d) => this.modeOf(d) !== "next_pause") ??
								false,
						}
					: null;
				const stale =
					seen === "lost" ||
					(seen === "missing" &&
						(payload.sentTo === undefined || payload.admittedBoot !== BOOT_ID));
				const apply = async () => {
					if (bundle && next)
						await this.wakes.rewrite(wakeId, bundle.text, next);
					else {
						await this.wakes.cancel(wakeId);
						await this.inbox?.failed(threadId, wakeId, { cause: "stopped" });
					}
					await discard();
				};
				if (stale) {
					await apply();
					continue;
				}
				const changed = this.dispatch.changeQueued(
					threadId,
					wakeId,
					bundle?.text ?? null,
				);
				if (changed === "edited" || changed === "withdrawn") await apply();
			}
		});
	}

	/**
	 * Bundled deliveries whose wake is gone without a receipt go out again under the same
	 * ids, after 2, 10, then 30 minutes; a fourth time they park (D21).
	 */
	async reconcile(threadId: string, now: Date = this.now()): Promise<void> {
		const bundled = await this.deliveryRows({
			investigationId: threadId,
			state: "bundled",
		});
		if (!bundled.length) return;
		const thread = await this.threadRow(threadId);
		if (!thread) return;
		const byWake = new Map<string, DeliveryRow[]>();
		for (const d of bundled)
			byWake.set(d.wakeId ?? "", [...(byWake.get(d.wakeId ?? "") ?? []), d]);
		const parkedBy = new Map<string, number>();
		for (const [wakeId, rows] of byWake) {
			const wake = wakeId
				? await this.prisma.threadWake.findUnique({
						where: { id: wakeId },
						select: { state: true },
					})
				: null;
			if (wake?.state === "pending") continue;
			if (wakeId && (await this.received(threadId, wakeId))) {
				await this.applyReceipt(threadId, [wakeId], now);
				continue;
			}
			if (wake?.state === "skipped") {
				await this.prisma.prDelivery.updateMany({
					where: { id: { in: rows.map((d) => d.id) } },
					data: { state: "discarded", discardReason: "refused" },
				});
				continue;
			}
			if (!isWorkflowTerminal(thread.status)) continue;
			if (await this.inbox?.providerStop(threadId)) continue;
			for (const d of rows) {
				if (!d.members.length) {
					await this.prisma.prDelivery.update({
						where: { id: d.id },
						data: { state: "discarded", discardReason: "withdrawn" },
					});
					continue;
				}
				const wait = RESEND_BACKOFF_MS[d.resends];
				if (wait !== undefined)
					await this.prisma.prDelivery.update({
						where: { id: d.id },
						data: {
							state: "queued",
							prevWakeId: d.wakeId,
							wakeId: null,
							resends: d.resends + 1,
							retryAt: new Date(now.getTime() + wait),
						},
					});
				else {
					await this.prisma.prDelivery.update({
						where: { id: d.id },
						data: { state: "parked", parkedAt: now, prevWakeId: d.wakeId },
					});
					for (const m of d.members)
						parkedBy.set(
							m.subscriptionId,
							(parkedBy.get(m.subscriptionId) ?? 0) + 1,
						);
				}
			}
		}
		for (const [id, n] of parkedBy) {
			const s = await this.prisma.prSubscription.findUnique({ where: { id } });
			if (s) await this.recordSub(s, "changed", "system", { parked: n });
		}
	}

	private async received(threadId: string, wakeId: string): Promise<boolean> {
		const row = await this.prisma.investigationEvent.findFirst({
			where: {
				investigationId: threadId,
				AND: [
					{ event: { contains: '"kind":"message_received"' } },
					{ event: { contains: wakeId } },
				],
			},
			select: { id: true },
		});
		return !!row;
	}

	// ---- Receipts ------------------------------------------------------------

	private async onEvents(
		threadId: string,
		events: CanonicalEvent[],
	): Promise<void> {
		const ids = events.flatMap((e) =>
			e.kind === "message_received" ? e.messageIds : [],
		);
		if (ids.length) await this.applyReceipt(threadId, ids, this.now());
	}

	/** The agent's turn on these wakes ended: their deliveries are delivered, once (D6). */
	private async applyReceipt(
		threadId: string,
		wakeIds: string[],
		now: Date,
	): Promise<void> {
		const rows = await this.deliveryRows({
			investigationId: threadId,
			state: "bundled",
			wakeId: { in: wakeIds },
		});
		if (!rows.length) return;
		const { count } = await this.prisma.prDelivery.updateMany({
			where: { id: { in: rows.map((d) => d.id) }, state: "bundled" },
			data: { state: "delivered", deliveredAt: now },
		});
		if (!count) return;
		const bySub = new Map<string, DeliveryRow[]>();
		for (const d of rows)
			for (const m of d.members)
				bySub.set(m.subscriptionId, [
					...(bySub.get(m.subscriptionId) ?? []),
					d,
				]);
		for (const [id, list] of bySub) {
			const s = await this.prisma.prSubscription.findUnique({ where: { id } });
			if (!s) continue;
			const quiet = list.every(
				(d) => (parseJson(d.payload) as EventPayload | null)?.quiet === true,
			);
			const streak = quiet ? s.quietDeliveries + 1 : 0;
			await this.prisma.prSubscription.update({
				where: { id },
				data: { lastDeliveredAt: now, quietDeliveries: streak },
			});
			if (!live(s.state)) continue;
			const end: PrSubEndReason | null =
				streak >= PR_SUB.quietCap
					? "comment_cap"
					: specOf(s).once
						? "once"
						: null;
			if (end)
				await this.prisma.$transaction((tx) =>
					endSubscriptions(tx, { id }, end, now),
				);
		}
	}

	// ---- Notices -------------------------------------------------------------

	/** Each ended subscription writes its transcript line once; some also tell the agent. */
	async announce(): Promise<void> {
		const ended = await this.prisma.prSubscription.findMany({
			where: { state: "ended", endAnnounced: false },
		});
		for (const s of ended) {
			const { withdrawn, alreadySent } = await this.withdrawnCounts(s.id);
			const reason = (s.endReason ?? "expired") as PrSubEndReason;
			const by =
				reason === "cancelled_by_user"
					? "user"
					: reason === "cancelled_by_agent"
						? "agent"
						: "system";
			await this.recordSub(s, "ended", by, {
				reason,
				withdrawn,
				alreadySent,
			});
			if (NOTICE_REASONS.has(reason) && withdrawn === 0) {
				const key = {
					investigationId: s.investigationId,
					url: s.url,
					dedupeKey: `end:${s.id}`,
				};
				const exists = await this.prisma.prDelivery.findUnique({
					where: { investigationId_url_dedupeKey: key },
				});
				if (!exists) {
					const d = await this.prisma.prDelivery.create({
						data: {
							...key,
							kind: "subscription_ended",
							payload: JSON.stringify({ ended: { id: s.id, reason } }),
							occurredAt: this.now(),
						},
					});
					await this.prisma.prDeliveryMember.create({
						data: { deliveryId: d.id, subscriptionId: s.id },
					});
				}
			}
			await this.prisma.prSubscription.update({
				where: { id: s.id },
				data: { endAnnounced: true },
			});
		}
	}

	private async withdrawnCounts(
		id: string,
	): Promise<{ withdrawn: number; alreadySent: number }> {
		const rows = await this.prisma.prDeliveryMember.findMany({
			where: { subscriptionId: id, state: "withdrawn" },
			select: { delivery: { select: { state: true } } },
		});
		return {
			withdrawn: rows.filter((r) => r.delivery.state === "discarded").length,
			alreadySent: rows.filter(
				(r) =>
					r.delivery.state === "bundled" || r.delivery.state === "delivered",
			).length,
		};
	}

	private async prName(prId: string): Promise<string> {
		const pr = await this.prisma.pullRequest.findUnique({
			where: { id: prId },
			select: { repo: true, number: true },
		});
		return pr ? `${pr.repo}#${pr.number}` : prId;
	}

	private async recordSub(
		s: PrSubscription,
		phase: "started" | "changed" | "ended",
		by: "agent" | "user" | "auto" | "system",
		extra: {
			reason?: PrSubEndReason;
			withdrawn?: number;
			alreadySent?: number;
			parked?: number;
		} = {},
	): Promise<void> {
		const pr = await this.prisma.pullRequest.findUnique({
			where: { id: s.prId },
			select: { repo: true, number: true, host: true },
		});
		const spec = specOf(s);
		const host = PrHostSchema.safeParse(pr?.host).data;
		await this.say(s.investigationId, {
			kind: "pr_subscription",
			subscriptionId: s.id,
			prId: s.prId,
			pr: pr ? `${pr.repo}#${pr.number}` : s.prId,
			url: s.url,
			...(host ? { host } : {}),
			phase,
			by,
			summary: subscriptionSummary(spec, host),
			delivery: spec.delivery,
			...extra,
		});
	}

	private started(s: PrSubscription, by: "agent" | "user" | "auto") {
		return this.recordSub(s, "started", by);
	}

	private say(threadId: string, body: Record<string, unknown>): Promise<void> {
		return recordWatchEvent(this.prisma, this.bus, threadId, body).catch(
			(e: unknown) =>
				this.logger.warn(`Could not record on ${threadId}: ${String(e)}`),
		);
	}

	// ---- Writing subscriptions -----------------------------------------------

	/** A URL with no cursor is read once before the row is written, so nothing before it is news (D5). */
	private async baseline(url: string): Promise<boolean> {
		const poll = await this.prisma.prPoll.findUnique({ where: { url } });
		if (parsePollCursor(poll?.cursor)) return true;
		if (!(await readThreadContextSettings(this.prisma)).prStatus) return false;
		const r = await this.pollUrl(url, [], this.now(), {
			force: true,
			baseline: true,
		}).catch(() => "failed" as const);
		return r === "read";
	}

	private async create(
		threadId: string,
		pr: { id: string; url: string },
		createdBy: PrSubCreator,
		spec: PrSubscriptionSpec,
	): Promise<{
		sub: PrSubscription;
		startsAt: "now" | "first successful read";
	}> {
		const ok = await this.baseline(pr.url);
		const sub = await this.prisma.prSubscription.create({
			data: {
				investigationId: threadId,
				prId: pr.id,
				url: pr.url,
				createdBy,
				spec: JSON.stringify(spec),
				state: ok ? "active" : "disconnected",
				since: this.now(),
			},
		});
		await this.started(sub, createdBy);
		return { sub, startsAt: ok ? "now" : "first successful read" };
	}

	private async requireThread(threadId: string) {
		const t = await this.threadRow(threadId);
		if (!t)
			throw new ORPCError("NOT_FOUND", { message: "That thread is gone." });
		return t;
	}

	private async requirePr(threadId: string, prId: string) {
		const pr = await this.prisma.pullRequest.findFirst({
			where: { id: prId, investigationId: threadId },
		});
		if (!pr)
			throw new ORPCError("NOT_FOUND", {
				message: "That pull request is not linked to this thread.",
			});
		return pr;
	}

	// ---- API -----------------------------------------------------------------

	/** `GET /threads/{id}/pr-subscriptions`: active and ended in 7 days, newest first. */
	async list(threadId: string, prId?: string): Promise<PrSubscriptionList> {
		await this.requireThread(threadId);
		const { prStatus } = await readThreadContextSettings(this.prisma);
		const subs = await this.prisma.prSubscription.findMany({
			where: {
				investigationId: threadId,
				...(prId ? { prId } : {}),
				OR: [
					{ state: { in: [...LIVE_SUB_STATES] } },
					{
						endedAt: {
							gte: new Date(this.now().getTime() - PR_SUB.listEndedMs),
						},
					},
				],
			},
			orderBy: { createdAt: "desc" },
		});
		return {
			subscriptions: await this.views(threadId, subs, prStatus),
			statusEnabled: prStatus,
		};
	}

	/** `POST /threads/{id}/pr-subscriptions`: the thread's user subscription, or a fresh copy of an ended one. */
	async createFromUser(
		threadId: string,
		prId: string,
		specInput?: unknown,
		fromId?: string,
	): Promise<PrSubscriptionView> {
		const thread = await this.requireThread(threadId);
		if (isSettled(thread))
			throw new ORPCError("CONFLICT", {
				message: "This thread is settled; undo the settle first.",
			});
		const pr = await this.requirePr(threadId, prId);
		let sub: PrSubscription;
		if (fromId) {
			const src = await this.prisma.prSubscription.findFirst({
				where: { id: fromId, investigationId: threadId, prId },
			});
			if (!src)
				throw new ORPCError("NOT_FOUND", { message: "No such subscription." });
			const same = await this.prisma.prSubscription.findFirst({
				where: {
					investigationId: threadId,
					prId,
					createdBy: src.createdBy,
					state: { in: [...LIVE_SUB_STATES] },
				},
			});
			sub =
				same ??
				(await this.create(threadId, pr, creatorOf(src.createdBy), specOf(src)))
					.sub;
		} else {
			let spec: PrSubscriptionSpec;
			try {
				spec = resolveSpec(
					"user",
					(specInput ?? undefined) as PrSubscriptionSpecInput | undefined,
				);
			} catch {
				throw new ORPCError("BAD_REQUEST", {
					message: "That subscription spec is not valid.",
				});
			}
			const existing = await this.prisma.prSubscription.findFirst({
				where: {
					investigationId: threadId,
					prId,
					createdBy: "user",
					state: { in: [...LIVE_SUB_STATES] },
				},
			});
			if (existing) {
				sub = specInput
					? await this.prisma.prSubscription.update({
							where: { id: existing.id },
							data: { spec: JSON.stringify(spec) },
						})
					: existing;
				if (specInput) await this.recordSub(sub, "changed", "user");
			} else sub = (await this.create(threadId, pr, "user", spec)).sub;
		}
		const [view] = await this.views(threadId, [sub]);
		return view as PrSubscriptionView;
	}

	/** `DELETE /threads/{id}/pr-subscriptions/{subscriptionId}`. */
	async cancelFromUser(
		threadId: string,
		subscriptionId: string,
	): Promise<PrSubscriptionView> {
		const s = await this.prisma.prSubscription.findFirst({
			where: { id: subscriptionId, investigationId: threadId },
		});
		if (!s)
			throw new ORPCError("NOT_FOUND", { message: "No such subscription." });
		await this.prisma.$transaction((tx) =>
			endSubscriptions(tx, { id: s.id }, "cancelled_by_user", this.now()),
		);
		await this.rebuild(threadId);
		await this.announce();
		const fresh = await this.prisma.prSubscription.findUnique({
			where: { id: s.id },
		});
		const [view] = await this.views(threadId, [fresh ?? s]);
		return view as PrSubscriptionView;
	}

	/** `POST /threads/{id}/pr-subscriptions/retry`: parked deliveries go out again (D21). */
	async retry(threadId: string): Promise<{ released: number }> {
		await this.requireThread(threadId);
		const released =
			await this.investigations.releaseParkedPrDeliveries(threadId);
		if (released) await this.bundle(threadId).catch(() => undefined);
		return { released };
	}

	/** `POST /threads/{id}/pr-subscriptions/poll`: read now, unless the origin cools down. */
	async pollThread(threadId: string): Promise<{ polled: number }> {
		await this.requireThread(threadId);
		if (!(await readThreadContextSettings(this.prisma)).prStatus)
			return { polled: 0 };
		const urls = await this.prisma.prSubscription.findMany({
			where: { investigationId: threadId, state: { in: [...LIVE_SUB_STATES] } },
			select: { url: true },
			distinct: ["url"],
		});
		let polled = 0;
		const now = this.now();
		for (const { url } of urls)
			if ((await this.pollUrl(url, [], now, { force: true })) === "read")
				polled++;
		await this.deliver(threadId, now).catch(() => undefined);
		await this.announce();
		return { polled };
	}

	/** Each subscription as the panel and the list route show it. */
	async views(
		threadId: string,
		subs: PrSubscription[],
		statusEnabled?: boolean,
	): Promise<PrSubscriptionView[]> {
		if (!subs.length) return [];
		const now = this.now();
		const prStatus =
			statusEnabled ?? (await readThreadContextSettings(this.prisma)).prStatus;
		const thread = await this.threadRow(threadId);
		const prs = await this.prisma.pullRequest.findMany({
			where: { id: { in: [...new Set(subs.map((s) => s.prId))] } },
		});
		const polls = await this.prisma.prPoll.findMany({
			where: { url: { in: [...new Set(subs.map((s) => s.url))] } },
		});
		const members = await this.prisma.prDeliveryMember.findMany({
			where: { subscriptionId: { in: subs.map((s) => s.id) } },
			select: {
				subscriptionId: true,
				state: true,
				delivery: { select: { state: true, parkedAt: true } },
			},
		});
		const stop = await this.inbox?.providerStop(threadId);
		let pause: { reason?: string } = {};
		try {
			pause = JSON.parse(thread?.autoPause ?? "{}") as typeof pause;
		} catch {
			pause = {};
		}
		const parkedAny = members.some(
			(m) => m.state === "member" && m.delivery.state === "parked",
		);
		const lastError = parkedAny ? await this.lastErrorLine(threadId) : null;
		return subs.map((s) => {
			const pr = prs.find((p) => p.id === s.prId);
			const poll = polls.find((p) => p.url === s.url);
			const mine = members.filter((m) => m.subscriptionId === s.id);
			const isMember = mine.filter((m) => m.state === "member");
			const out = mine.filter((m) => m.state === "withdrawn");
			const parked = isMember.filter((m) => m.delivery.state === "parked");
			const spec = specOf(s);
			const host = PrHostSchema.safeParse(pr?.host).data ?? "other";
			const liveNow = live(s.state);
			const paused: PrSubscriptionView["paused"] = !liveNow
				? null
				: !prStatus
					? { reason: "setting_off", until: null }
					: thread && isSettled(thread) && thread.teardownAt
						? { reason: "settling", until: thread.teardownAt.toISOString() }
						: poll?.lastError === "rate_limited" && poll.nextPollAt > now
							? { reason: "rate_limited", until: poll.nextPollAt.toISOString() }
							: stop
								? { reason: "provider_limit" as PrSubPause, until: null }
								: pause.reason === "ceiling"
									? { reason: "ceiling", until: null }
									: null;
			const parkedAt = parked
				.map((m) => m.delivery.parkedAt?.getTime() ?? 0)
				.reduce((a, b) => Math.max(a, b), 0);
			return {
				id: s.id,
				threadId: s.investigationId,
				prId: s.prId,
				pr: pr ? `${pr.repo}#${pr.number}` : s.prId,
				url: s.url,
				host,
				createdBy: creatorOf(s.createdBy),
				spec,
				summary: subscriptionSummary(spec, host),
				state:
					s.state === "disconnected"
						? "disconnected"
						: liveNow
							? "active"
							: "ended",
				paused,
				hostError:
					s.state === "disconnected" && poll?.lastError !== "rate_limited"
						? (poll?.lastError ?? null)
						: null,
				deliveryFailing: parked.length
					? {
							parked: parked.length,
							lastError,
							at: new Date(parkedAt || now.getTime()).toISOString(),
						}
					: null,
				endReason: (s.endReason as PrSubEndReason | null) ?? null,
				endNote: s.endNote,
				counts: {
					delivered: isMember.filter((m) => m.delivery.state === "delivered")
						.length,
					waiting: isMember.filter((m) =>
						(OPEN_DELIVERY_STATES as readonly string[]).includes(
							m.delivery.state,
						),
					).length,
					filtered: s.filteredCount,
					withdrawn: out.filter((m) => m.delivery.state === "discarded").length,
					alreadySent: out.filter(
						(m) =>
							m.delivery.state === "bundled" ||
							m.delivery.state === "delivered",
					).length,
				},
				since: s.since.toISOString(),
				lastDeliveredAt: s.lastDeliveredAt?.toISOString() ?? null,
				lastReadAt: poll?.updatedAt.toISOString() ?? null,
				endedAt: s.endedAt?.toISOString() ?? null,
			};
		});
	}

	/** The thread's newest turn error, its plain line. */
	private async lastErrorLine(threadId: string): Promise<string | null> {
		const row = await this.prisma.investigationEvent.findFirst({
			where: {
				investigationId: threadId,
				event: { contains: '"kind":"error"' },
			},
			orderBy: { seq: "desc" },
			select: { event: true },
		});
		const e = safeParseJsonObject(row?.event ?? null);
		return typeof e?.message === "string" ? e.message.slice(0, 300) : null;
	}

	// ---- The panel's Watch, as subscriptions (D3) ------------------------------

	/** Each linked PR as one watch for the panel's compact line; null when nothing follows it. */
	async watches(threadId: string): Promise<Map<string, PrWatch>> {
		const subs = await this.prisma.prSubscription.findMany({
			where: { investigationId: threadId },
			orderBy: { createdAt: "desc" },
		});
		const views = await this.views(threadId, subs);
		const out = new Map<string, PrWatch>();
		const byPr = new Map<string, PrSubscriptionView[]>();
		for (const v of views) byPr.set(v.prId, [...(byPr.get(v.prId) ?? []), v]);
		for (const [prId, list] of byPr) {
			const active = list.filter((v) => v.state !== "ended");
			const ended = list.find((v) => v.state === "ended");
			const first = active[0];
			if (first) {
				const waiting = active.some((v) => v.counts.waiting > 0);
				const down = active.find(
					(v) => v.state === "disconnected" && v.hostError,
				);
				out.set(prId, {
					state: waiting ? "waiting" : down ? "disconnected" : "watching",
					reason: down?.hostError ?? null,
					since: first.since,
					until: null,
					auto: active.some((v) => v.createdBy === "auto"),
				});
			} else if (ended)
				out.set(prId, {
					state: "stopped",
					reason: ended.endNote,
					since: ended.since,
					until: null,
					auto: ended.createdBy === "auto",
				});
		}
		return out;
	}

	/** The panel's Watch: the thread's user subscription starts, or starts again. */
	async watchFromUser(threadId: string, prId: string): Promise<void> {
		await this.createFromUser(threadId, prId);
	}

	/** The panel's Stop watching: the thread's user and automatic subscriptions on the PR end. */
	async unwatchFromUser(threadId: string, prId: string): Promise<void> {
		await this.prisma.$transaction((tx) =>
			endSubscriptions(
				tx,
				{
					investigationId: threadId,
					prId,
					createdBy: { in: ["user", "auto"] },
				},
				"cancelled_by_user",
				this.now(),
			),
		);
		await this.rebuild(threadId);
		await this.announce();
	}

	// ---- The agent's tools -----------------------------------------------------

	private async resolvePr(
		threadId: string,
		raw: string,
	): Promise<PullRequest | ToolFailure> {
		const stored = await this.prs.stored(threadId);
		const listed = () =>
			stored.length
				? `This thread's PRs: ${stored.map((p) => `${p.repo}#${p.number} ${p.url}`).join("; ")}.`
				: "Link a PR on one of this thread's repositories.";
		const n = /^#?(\d+)$/.exec(raw.trim())?.[1];
		if (n) {
			const hits = stored.filter((p) => p.number === Number(n));
			if (hits.length === 1 && hits[0]) return hits[0];
			return {
				error: "invalid_input",
				message: hits.length
					? `Several linked PRs are #${n}.`
					: `No linked PR is #${n}.`,
				next: `Pass the PR's URL. ${listed()}`,
			};
		}
		const byId = stored.find((p) => p.id === raw.trim());
		if (byId) return byId;
		const parsed = parsePrUrl(raw);
		if (!parsed)
			return {
				error: "invalid_input",
				message: "That is not a pull request URL, number or id.",
				next: `Pass the PR's URL, its #number or its id. ${listed()}`,
			};
		const linked = stored.find((p) => p.url === parsed.url);
		if (linked) return linked;
		try {
			return await this.prs.linkFromUser(threadId, parsed.url, "agent");
		} catch (e) {
			return {
				error: "invalid_input",
				message:
					e instanceof ORPCError ? e.message : "That PR could not be linked.",
				next: "Link a PR on one of this thread's repositories.",
			};
		}
	}

	/** `pl_pr_subscribe` (§3.3). */
	async subscribe(
		threadId: string,
		input: SubscribeInput,
	): Promise<ToolAnswer> {
		if (!(await readThreadContextSettings(this.prisma)).prStatus)
			return {
				error: "disabled",
				message:
					'"Show pull request status" is off in Settings, so PrismaLens reads no PR events.',
				next: "Ask the user to turn it on, or carry on without a subscription.",
			};
		const thread = await this.threadRow(threadId);
		if (!thread)
			return {
				error: "run_ended",
				message: "This run is gone.",
				next: "Finish.",
			};
		if (isSettled(thread))
			return {
				error: "run_ended",
				message: "This thread is settled.",
				next: "Finish without a subscription.",
			};
		const pr = await this.resolvePr(threadId, input.pr);
		if ("error" in pr) return pr;
		let spec: PrSubscriptionSpec;
		try {
			spec = resolveSpec("agent", {
				...(input.events ? { events: input.events } : {}),
				...(input.filter ? { filter: input.filter } : {}),
				...(input.delivery ? { delivery: input.delivery } : {}),
				...(input.batchMinutes !== undefined
					? { batchMinutes: input.batchMinutes }
					: {}),
				...(input.once !== undefined ? { once: input.once } : {}),
			});
		} catch (e) {
			return {
				error: "invalid_input",
				message: `The subscription is not valid: ${e instanceof Error ? e.message.slice(0, 300) : "check its fields"}.`,
				next: "Fix the fields and call again.",
			};
		}
		const mine = await this.prisma.prSubscription.findMany({
			where: { investigationId: threadId },
		});
		const existing = mine.find(
			(s) => s.prId === pr.id && s.createdBy === "agent" && live(s.state),
		);
		const locked = mine.find(
			(s) =>
				s.prId === pr.id &&
				s.createdBy === "agent" &&
				(s.endReason === "loop_guard" || s.endReason === "cancelled_by_user") &&
				s.endedAt &&
				this.now().getTime() - s.endedAt.getTime() < PR_SUB.lockoutMs,
		);
		if (!existing && locked)
			return {
				error: "limit_reached",
				message:
					locked.endReason === "loop_guard"
						? "A check kept failing on 3 pushes, so this subscription ended; it can start again in 24 hours."
						: "The user cancelled your subscription to this PR in the last 24 hours.",
				next: "Carry on without it; the user can resume it from the PR panel.",
			};
		if (
			!existing &&
			mine.filter((s) => live(s.state)).length >= PR_SUB.perThread
		)
			return {
				error: "limit_reached",
				message: `This thread already has ${PR_SUB.perThread} active PR subscriptions.`,
				next: "End one with pl_pr_unsubscribe first, or carry on without this one.",
			};
		let sub: PrSubscription;
		let startsAt: "now" | "first successful read" = "now";
		if (existing) {
			sub = await this.prisma.prSubscription.update({
				where: { id: existing.id },
				data: {
					spec: JSON.stringify(spec),
					// A migrated watch becomes an ordinary subscription from now on (D12).
					...(existing.legacyUntil
						? { legacyUntil: null, expiresAt: null, since: this.now() }
						: {}),
				},
			});
			await this.recordSub(sub, "changed", "agent");
			startsAt = sub.state === "disconnected" ? "first successful read" : "now";
		} else {
			const made = await this.create(threadId, pr, "agent", spec);
			sub = made.sub;
			startsAt = made.startsAt;
		}
		const also = mine.filter(
			(s) => s.prId === pr.id && s.createdBy !== "agent" && live(s.state),
		);
		const unsupported =
			pr.host === "gitlab"
				? [
						"author role: GitLab names none, so every author passes the role filter",
						"force-pushes: GitLab reports none",
						"approvals: GitLab's approvals are not events here, only its review notes",
					]
				: pr.host === "other"
					? ["everything: PrismaLens reads no events from this host"]
					: [];
		const title = pr.title
			? sanitizeUntrustedLine(pr.title).slice(0, 200)
			: null;
		return {
			value: {
				subscription: {
					id: sub.id,
					pr: `${pr.repo}#${pr.number}`,
					url: pr.url,
					createdBy: "agent",
					events: spec.events,
					filter: spec.filter,
					delivery: spec.delivery,
					batchMinutes: spec.batchMinutes ?? null,
					once: spec.once,
					unsupported,
					replaced: !!existing,
					startsAt,
				},
				hears: subscriptionSummary(spec, pr.host),
				promise: PR_SUB_PROMISE,
				alsoOnThisPr: also.map((s) => ({
					id: s.id,
					by: creatorOf(s.createdBy),
					summary: subscriptionSummary(specOf(s), pr.host),
				})),
				untrusted: { title },
				next: NEXT,
			},
		};
	}

	/** `pl_pr_unsubscribe`: the agent's own, never the user's or automatic ones. */
	async unsubscribe(
		threadId: string,
		input: { subscription?: string; pr?: string },
	): Promise<ToolAnswer> {
		if (!!input.subscription === !!input.pr)
			return {
				error: "invalid_input",
				message: "Pass exactly one of subscription or pr.",
				next: "Call again with the subscription's id or the PR.",
			};
		let prId: string | null = null;
		if (input.pr) {
			const pr = await this.resolvePr(threadId, input.pr);
			if ("error" in pr) return pr;
			prId = pr.id;
		}
		const subs = await this.prisma.prSubscription.findMany({
			where: {
				investigationId: threadId,
				state: { in: [...LIVE_SUB_STATES] },
				...(input.subscription ? { id: input.subscription } : {}),
				...(prId ? { prId } : {}),
			},
		});
		if (!subs.length)
			return {
				error: "not_found",
				message: "No active subscription of this thread matches.",
				next: "Read them with pl_pr_subscriptions.",
			};
		const mineIds = subs
			.filter((s) => s.createdBy === "agent")
			.map((s) => s.id);
		if (mineIds.length)
			await this.prisma.$transaction((tx) =>
				endSubscriptions(
					tx,
					{ id: { in: mineIds } },
					"cancelled_by_agent",
					this.now(),
				),
			);
		await this.rebuild(threadId);
		const ended: Array<{
			id: string;
			pr: string;
			withdrawn: number;
			alreadySent: number;
		}> = [];
		for (const s of subs.filter((x) => mineIds.includes(x.id))) {
			const counts = await this.withdrawnCounts(s.id);
			ended.push({ id: s.id, pr: await this.prName(s.prId), ...counts });
		}
		await this.announce();
		return {
			value: {
				ended,
				kept: subs
					.filter((s) => !mineIds.includes(s.id))
					.map((s) => ({
						id: s.id,
						by: creatorOf(s.createdBy),
						why: "The user's; they cancel it in the PR panel.",
					})),
			},
		};
	}

	/** `pl_pr_subscriptions`: active, and ended in the last day. No host text. */
	async forTool(threadId: string): Promise<ToolAnswer> {
		const subs = await this.prisma.prSubscription.findMany({
			where: {
				investigationId: threadId,
				OR: [
					{ state: { in: [...LIVE_SUB_STATES] } },
					{
						endedAt: {
							gte: new Date(this.now().getTime() - TOOL_LIST_ENDED_MS),
						},
					},
				],
			},
			orderBy: { createdAt: "desc" },
		});
		const views = await this.views(threadId, subs);
		return {
			value: {
				subscriptions: views.map((v) => ({
					id: v.id,
					pr: v.pr,
					url: v.url,
					createdBy: v.createdBy,
					summary: v.summary,
					state: v.state,
					paused: v.paused?.reason ?? null,
					waiting: v.counts.waiting,
					delivered: v.counts.delivered,
					lastDeliveredAt: v.lastDeliveredAt,
					endReason: v.endReason,
				})),
			},
		};
	}
}

function guardOf(raw: string | null): { key: string; heads: string[] } | null {
	const o = safeParseJsonObject(raw);
	return o &&
		typeof o.key === "string" &&
		Array.isArray(o.heads) &&
		o.heads.every((h) => typeof h === "string")
		? { key: o.key, heads: o.heads as string[] }
		: null;
}

const stringsOf = (v: unknown): string[] =>
	Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** A stored payload stays under 8 KB: the body is cut first. */
function boundedPayload(p: EventPayload): string {
	let s = JSON.stringify(p);
	if (s.length <= PAYLOAD_MAX) return s;
	s = JSON.stringify({ ...p, body: p.body?.slice(0, 1000) });
	return s.length <= PAYLOAD_MAX
		? s
		: JSON.stringify({ ...p, body: undefined });
}
