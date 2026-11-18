// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { randomUUID } from "node:crypto";
import {
	forwardRef,
	Inject,
	Injectable,
	Logger,
	type OnModuleInit,
	Optional,
} from "@nestjs/common";
import {
	AUTONOMOUS_TURNS_PER_DAY,
	type CanonicalEvent,
	COLD_RESUME_TOKENS,
	continuableRun,
	failureLine,
	isBlockedMode,
	isRetryMode,
	isWorkflowTerminal,
	PROVIDER_RETRY_ATTEMPTS,
	PrInboundEventsSchema,
	type RunFailure,
	RunFailureSchema,
	type ThreadSession,
	usageWindowState,
} from "@prismalens/contracts";
import { classifyFailure, parseReset, retryDelayMs } from "@prismalens/engine";
import { HarnessService } from "../../core/harness/harness.service.js";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import {
	CheckoutGone,
	DispatchService,
	FollowUpRefused,
	type FollowUpSession,
} from "../../infrastructure/dispatch/dispatch.service.js";
import {
	followUpBlockedReason,
	InvestigationsService,
} from "../investigations/investigations.service.js";
import { InboxService, wakeSource } from "./inbox.service.js";
import {
	type AgentSessionFacts,
	compactCommandOf,
	IDLE_COMPACT_LEAD_MS,
	IDLE_COMPACT_PER_HOUR,
	interruptedTurn,
	limitResumeText,
	limitWakeAt,
	NO_TIME_ATTEMPTS,
	NO_TIME_RETRY_MS,
	registryFacts,
	resumeNoteFor,
	threadSession,
	usedOf,
} from "./session.js";
import { type Wake, WakesService } from "./wakes.service.js";

/** A wake whose resume keeps being refused (a busy folder, a held checkout) gives up after this long. */
const REFUSED_FOR_MS = 24 * 60 * 60_000;
/** Due wakes are read this many at a time. */
const DUE_PAGE = 50;
/** A no-time limit that comes back within this long of its wake's resume counts as the next attempt. */
const RETRY_LINK_MS = 2 * NO_TIME_RETRY_MS;
const DAY_MS = 24 * 60 * 60_000;
export const CEILING_LINE = `Paused automatic updates: ${AUTONOMOUS_TURNS_PER_DAY} in the last day. Your next message releases them.`;
/** This process: a wake queued into a run of another boot reads as never sent (#1179 D23). */
export const BOOT_ID = randomUUID();

const THREAD_FIELDS = {
	id: true,
	status: true,
	kind: true,
	harness: true,
	usage: true,
	report: true,
	workspace: true,
	endReason: true,
	error: true,
	lastActivityAt: true,
	updatedAt: true,
	completedAt: true,
	limitResetsAt: true,
	autoResume: true,
	settledAt: true,
	teardownAt: true,
	autoPause: true,
} as const;

type ThreadRow = {
	id: string;
	status: string;
	kind: string;
	harness: string | null;
	usage: string | null;
	report: string | null;
	workspace: string | null;
	endReason: string | null;
	error: string | null;
	lastActivityAt: Date | null;
	updatedAt: Date;
	completedAt: Date | null;
	limitResetsAt: Date | null;
	autoResume: boolean | null;
	settledAt: Date | null;
	teardownAt: Date | null;
	autoPause: string | null;
};

/**
 * A thread's session across pauses (#1024): a usage limit becomes a scheduled
 * resume of what the user already sent, idle compaction runs where it is on and
 * evidenced, and the cold-session choices reach the follow-up. Wakes fire from
 * the schedules loop's 30 s pass.
 */
@Injectable()
export class SessionLifecycleService implements OnModuleInit {
	private readonly logger = new Logger(SessionLifecycleService.name);
	/** Injectable for tests: an agent that qualifies for idle compaction exists in none of today's rows. */
	facts: (harness: string | null) => AgentSessionFacts | null = registryFacts;
	now: () => Date = () => new Date();

	constructor(
		private readonly prisma: PrismaService,
		private readonly wakes: WakesService,
		private readonly dispatch: DispatchService,
		private readonly harness: HarnessService,
		@Inject(forwardRef(() => InvestigationsService))
		private readonly investigations: InvestigationsService,
		@Optional() private readonly inbox?: InboxService,
	) {}

	onModuleInit(): void {
		this.dispatch.onRunSettled((id, outcome) => this.onSettled(id, outcome));
	}

	/** A run's job settled: a usage limit schedules its resume; any other end retires a pending one. */
	async onSettled(
		id: string,
		outcome: { outcome: string; error?: string },
	): Promise<void> {
		const row = await this.thread(id);
		if (!row) return;
		// Only this turn's own error decides: the row may still hold an older limit's text.
		const failure =
			outcome.outcome === "failed" && outcome.error
				? await this.failureOf(id, outcome.error)
				: null;
		// The engine's message is the plain line; the agent's own words parse the reset.
		const text = failure?.raw ?? outcome.error ?? "";
		if (failure?.mode === "usage_limit")
			return this.recordLimit(row, text, failure);
		if (failure && isRetryMode(failure.mode))
			return this.recordRetry(row, text, failure);
		if (failure && isBlockedMode(failure.mode))
			return this.recordBlocked(row, text, failure);
		await this.wakes.cancelKind(id, "limit");
		await this.wakes.retireStopped(id);
		await this.prisma.investigation.updateMany({
			where: { id },
			data: {
				limitResetsAt: null,
				...(row.endReason === "limited" || row.endReason === "blocked"
					? { endReason: null }
					: {}),
			},
		});
		if (outcome.outcome === "succeeded") await this.scheduleIdleCompact(row);
	}

	/**
	 * The turn's provider stop: the `failure` its last `error` event recorded, else
	 * its words classified (an error from before #1101, or one the engine did not see).
	 */
	private async failureOf(
		id: string,
		error: string,
	): Promise<RunFailure | null> {
		const last = await this.prisma.investigationEvent.findFirst({
			where: { investigationId: id, event: { contains: '"kind":"error"' } },
			orderBy: { seq: "desc" },
			select: { event: true },
		});
		try {
			const e = JSON.parse(last?.event ?? "null") as {
				message?: unknown;
				failure?: unknown;
			} | null;
			const recorded = RunFailureSchema.safeParse(e?.failure);
			if (e?.message === error && recorded.success) return recorded.data;
		} catch {
			// An unreadable event classifies by its words below.
		}
		return classifyFailure(error);
	}

	/**
	 * The reset of a usage window the agent reported full (#1101): Claude Code's
	 * `agent_quota`, when the limit's own words name no time.
	 */
	private async reportedReset(id: string, now: Date): Promise<Date | null> {
		const last = await this.prisma.investigationEvent.findFirst({
			where: {
				investigationId: id,
				event: { contains: '"kind":"agent_quota"' },
			},
			orderBy: { seq: "desc" },
			select: { event: true },
		});
		try {
			const q = JSON.parse(last?.event ?? "null") as {
				status?: unknown;
				usedPercent?: unknown;
				resetsAt?: unknown;
			} | null;
			const full = !!q && usageWindowState(q) === "full";
			const at = typeof q?.resetsAt === "string" ? new Date(q.resetsAt) : null;
			return full && at && at.getTime() > now.getTime() ? at : null;
		} catch {
			return null;
		}
	}

	/**
	 * A rate limit or a busy provider (#1101): the next try on the provider's
	 * `retry-after` or the backoff, counting the tries the turn made itself; past
	 * the fifth, it needs the user.
	 */
	async recordRetry(
		row: ThreadRow,
		text: string,
		failure: RunFailure,
	): Promise<void> {
		const now = this.now();
		const prev = await this.wakes.latest(row.id, "limit");
		const linked =
			prev?.state === "done" &&
			prev.payload.mode === failure.mode &&
			!!prev.doneAt &&
			now.getTime() - prev.doneAt.getTime() < RETRY_LINK_MS;
		const tried =
			(linked && prev ? prev.attempts - 1 : 0) + (failure.attempt ?? 1);
		const next = tried + 1;
		const gaveUp = next > PROVIDER_RETRY_ATTEMPTS;
		const at = gaveUp
			? null
			: new Date(now.getTime() + retryDelayMs(failure, next));
		await this.prisma.investigation.updateMany({
			where: { id: row.id },
			data: {
				limitResetsAt: null,
				...(row.status === "failed" ? { endReason: "limited" } : {}),
			},
		});
		const wakeId = await this.wakes.schedule(
			row.id,
			"limit",
			at ?? now,
			failure.mode === "overloaded" ? "provider busy" : "rate limit",
			{
				mode: failure.mode,
				maxAttempts: PROVIDER_RETRY_ATTEMPTS,
				...(gaveUp ? { gaveUp: true } : {}),
			},
			next,
		);
		if (gaveUp)
			await this.wakes.finish(wakeId, "skipped", undefined, this.now());
		const events: Array<Record<string, unknown>> = [
			{
				...this.stopWords(row, failure, text),
				kind: "usage_limit",
				resetsAt: null,
				mode: failure.mode,
			},
		];
		if (gaveUp || (await this.autoResumeOn(row)))
			events.push({
				kind: "resume_scheduled",
				at: at?.toISOString() ?? null,
				wakeKind: "limit",
				attempt: next,
				maxAttempts: PROVIDER_RETRY_ATTEMPTS,
				mode: failure.mode,
				...(gaveUp
					? { gaveUp: true }
					: { nextTry: { n: next, of: PROVIDER_RETRY_ATTEMPTS } }),
			});
		await this.say(row.id, events);
	}

	/** A stop event's words: the agent, the plain line every surface shows, and the agent's own text. */
	private stopWords(
		row: ThreadRow,
		failure: Pick<RunFailure, "mode" | "window">,
		raw: string,
	): { agent: string; text: string; raw?: string } {
		const agent = this.facts(row.harness)?.label ?? row.harness ?? "the agent";
		return {
			agent,
			text: failureLine(failure, agent),
			...(raw.trim() ? { raw: raw.slice(0, 500) } : {}),
		};
	}

	/**
	 * Out of credit, a rejected key or a spend cap (#1101 decision (a)): Blocked. No
	 * timer and no retry; the user's next message, or Try again, takes it up.
	 */
	async recordBlocked(
		row: ThreadRow,
		text: string,
		failure: RunFailure,
	): Promise<void> {
		const now = this.now();
		await this.prisma.investigation.updateMany({
			where: { id: row.id },
			data: {
				limitResetsAt: null,
				...(row.status === "failed" ? { endReason: "blocked" } : {}),
			},
		});
		const wakeId = await this.wakes.schedule(
			row.id,
			"limit",
			now,
			"provider blocked",
			{ mode: failure.mode, blocked: true },
		);
		await this.wakes.finish(wakeId, "skipped", undefined, now);
		await this.say(row.id, [
			{
				...this.stopWords(row, failure, text),
				kind: "provider_blocked",
				mode: failure.mode,
			},
		]);
	}

	/**
	 * Retry now (#1101): a pending limit wake fires at once; a stop the user has
	 * fixed (Blocked, or retries spent) resumes the interrupted turn now, once.
	 */
	async retryNow(id: string): Promise<boolean> {
		const row = await this.thread(id);
		if (!row || !isWorkflowTerminal(row.status)) return false;
		const latest = await this.wakes.latest(id, "limit");
		const stopped =
			latest?.state === "skipped" &&
			(latest.payload.gaveUp === true || latest.payload.blocked === true);
		if (!latest || (latest.state !== "pending" && !stopped)) return false;
		const now = this.now();
		let wake: Wake | null = latest;
		if (stopped) {
			await this.wakes.schedule(
				id,
				"limit",
				now,
				"retry now",
				{
					...(typeof latest.payload.mode === "string"
						? { mode: latest.payload.mode }
						: {}),
					retryNow: true,
				},
				latest.attempts,
			);
			wake = await this.wakes.latest(id, "limit");
		}
		if (wake?.state !== "pending") return false;
		const due = wake;
		await this.withThreadLock(id, () => this.fireLimit(due, row, now, true));
		// Only an admission marks the wake done; a refusal or a lost race leaves it otherwise.
		const after = await this.wakes.latest(id, "limit");
		return after?.id === due.id && after.state === "done";
	}

	/** Classify, extract, schedule: the agent's limit text, its reset, and the wake that resumes it. */
	async recordLimit(
		row: ThreadRow,
		text: string,
		failure?: RunFailure,
	): Promise<void> {
		const now = this.now();
		const resetsAt =
			parseReset(text, now, row.harness) ??
			(await this.reportedReset(row.id, now));
		const prev = await this.wakes.latest(row.id, "limit");
		const linked =
			!resetsAt &&
			prev?.state === "done" &&
			prev.payload.noTime === true &&
			!!prev.doneAt &&
			now.getTime() - prev.doneAt.getTime() < RETRY_LINK_MS;
		const attempts = linked && prev ? prev.attempts + 1 : 1;
		await this.prisma.investigation.updateMany({
			where: { id: row.id },
			data: {
				limitResetsAt: resetsAt,
				...(row.status === "failed" ? { endReason: "limited" } : {}),
			},
		});
		const facts = this.facts(row.harness);
		const at = limitWakeAt(resetsAt, attempts, now);
		const events: Array<Record<string, unknown>> = [
			{
				...this.stopWords(row, failure ?? { mode: "usage_limit" }, text),
				kind: "usage_limit",
				resetsAt: resetsAt?.toISOString() ?? null,
				mode: "usage_limit",
				...(failure?.window ? { window: failure.window } : {}),
			},
		];
		if (!at) {
			const id = await this.wakes.schedule(
				row.id,
				"limit",
				now,
				"usage limit",
				{
					noTime: true,
					gaveUp: true,
					mode: "usage_limit",
					...(failure?.window ? { window: failure.window } : {}),
				},
				attempts,
			);
			await this.wakes.finish(id, "skipped", undefined, this.now());
			events.push({
				kind: "resume_scheduled",
				at: null,
				wakeKind: "limit",
				attempt: attempts,
				gaveUp: true,
			});
		} else {
			await this.wakes.schedule(
				row.id,
				"limit",
				at,
				"usage limit",
				{
					noTime: !resetsAt,
					mode: "usage_limit",
					...(failure?.window ? { window: failure.window } : {}),
				},
				attempts,
			);
			if (await this.autoResumeOn(row))
				events.push({
					kind: "resume_scheduled",
					at: at.toISOString(),
					wakeKind: "limit",
					attempt: attempts,
					// No reset is known: the wake is a try, said as one (#1101 cat 17 item 4).
					...(resetsAt
						? {}
						: {
								maxAttempts: NO_TIME_ATTEMPTS + 1,
								nextTry: { n: attempts + 1, of: NO_TIME_ATTEMPTS + 1 },
							}),
				});
		}
		await this.say(row.id, events);
	}

	/** One pass over the due wakes, oldest first. */
	async process(now: Date = this.now()): Promise<void> {
		// Paged: wakes that stay pending (auto-resume off, a refused resume) never hide later ones.
		let after: Wake | undefined;
		for (;;) {
			const page = await this.wakes.due(now, after, DUE_PAGE);
			for (const wake of page) {
				try {
					await this.fire(wake, now);
				} catch (e) {
					this.logger.warn(
						`Wake ${wake.id} (${wake.kind}) did not fire: ${(e as Error).message}`,
					);
				}
			}
			if (page.length < DUE_PAGE) return;
			after = page[page.length - 1];
		}
	}

	private async fire(due: Wake, now: Date): Promise<void> {
		let wake = due;
		const row = await this.thread(wake.investigationId);
		if (!row) {
			await this.wakes.finish(wake.id, "cancelled", undefined, this.now());
			return;
		}
		const running = !isWorkflowTerminal(row.status);
		const settled =
			row.settledAt !== null &&
			row.settledAt >= (row.lastActivityAt ?? row.updatedAt);
		// Inside a settle's Undo window nothing fires; the teardown ends it, or Undo keeps it.
		if (settled && row.teardownAt) return;
		if (wake.kind === "limit" || wake.kind === "idle_compact") {
			// Moot while the thread runs: the turn in flight is its own resume.
			if (running) {
				await this.wakes.finish(
					wake.id,
					"skipped",
					{
						...wake.payload,
						skipped: "running",
					},
					this.now(),
				);
				return;
			}
			if (wake.kind === "limit") return this.fireLimit(wake, row, now);
			return this.fireIdleCompact(wake, row, now);
		}
		// The user stopped the thread, or settled it with nothing since: its agent's wakes end.
		if (settled || row.status === "cancelled") {
			await this.wakes.finish(wake.id, "cancelled", undefined, this.now());
			await this.inbox?.failed(row.id, wake.id, {
				cause: settled ? "settled" : "stopped",
			});
			return;
		}
		// An agent's or a PR watch's wake is never dropped: a running thread gets it at its next pause.
		// Done only once the agent received it; a run that ends first leaves it to the resume below.
		const seen = await this.wakeSeen(row.id, wake.id);
		if (seen === "delivered") {
			await this.wakes.finish(wake.id, "done", undefined, this.now());
			return;
		}
		wake = await this.arrived(wake, row);
		if (wake.kind === "pr_status" || wake.kind === "cron")
			return this.fireAutonomous(wake, row, now, running, seen);
		// Under a provider stop it waits for the stop's own resume, then reaches the live run.
		if (!running && (await this.limited(row.id))) return;
		if (running) {
			if (
				(seen === "missing" || seen === "lost") &&
				wake.payload.sentTo !== row.id
			) {
				const state = this.dispatch.sendMessage(
					row.id,
					wake.reason,
					"queue",
					[],
					undefined,
					wake.id,
				);
				if (state === "queued" || state === "sent")
					await this.wakes.setPayload(wake.id, {
						...wake.payload,
						sentTo: row.id,
					});
			}
			return;
		}
		await this.resume(wake, row, now, wake.reason, "chat", {}, "wake");
	}

	/**
	 * A PR status batch or a cron fire (#1024 surface F): held while the thread is
	 * paused or limited, then counted against the thread's one autonomous ceiling at
	 * admission, in the same step as the delivery. Over it, held, never dropped.
	 */
	private async fireAutonomous(
		wake: Wake,
		row: ThreadRow,
		now: Date,
		running: boolean,
		seen: WakeSeen,
	): Promise<void> {
		// A next-pause bundle waits for the thread's next run (#1179).
		if (!running && wake.payload.resume === false) return;
		// Already admitted into a running thread: it waits for delivery or the resume below.
		const admitted = typeof wake.payload.admittedAt === "string";
		if (!admitted) {
			if (await this.paused(row, now)) return;
			if (!running && (await this.limited(row.id))) return;
		}
		await this.withThreadLock(row.id, async () => {
			const fresh = await this.wakes.latest(row.id, wake.kind);
			if (fresh?.id !== wake.id || fresh.state !== "pending") return;
			const units =
				typeof fresh.payload.units === "number" ? fresh.payload.units : 1;
			const already = typeof fresh.payload.admittedAt === "string";
			if (!already) {
				// Units admitted before a person's release stop counting (OBJ-043).
				const countedAt = new Date();
				const released = (
					await this.prisma.investigation.findUnique({
						where: { id: row.id },
						select: { unitsReleasedAt: true },
					})
				)?.unitsReleasedAt;
				const dayAgo = new Date(now.getTime() - DAY_MS);
				const used = await this.wakes.autonomousUnits(
					row.id,
					released && released > dayAgo ? released : dayAgo,
				);
				if (used + units > AUTONOMOUS_TURNS_PER_DAY) {
					await this.pause(row.id, now, countedAt);
					return;
				}
			}
			// Lost with its run, or queued into a run of another boot: sent again (D23).
			const send =
				seen === "lost" ||
				(seen === "missing" &&
					(fresh.payload.sentTo !== row.id ||
						fresh.payload.admittedBoot !== BOOT_ID));
			if (running) {
				if (send) {
					// The text read under the lock: a rebuild may have rewritten it (OBJ-033).
					const state = this.dispatch.sendMessage(
						row.id,
						fresh.reason,
						"queue",
						[],
						undefined,
						wake.id,
					);
					if (state === "queued" || state === "sent")
						await this.wakes.setPayload(wake.id, {
							...fresh.payload,
							sentTo: row.id,
							admittedAt:
								typeof fresh.payload.admittedAt === "string"
									? fresh.payload.admittedAt
									: now.toISOString(),
							admittedBoot: BOOT_ID,
						});
				}
				return;
			}
			if (seen === "queued") return;
			await this.resume(fresh, row, now, fresh.reason, "chat", {}, "wake");
		});
	}

	/**
	 * Automatic updates are paused at the ceiling. Only a person's message through the send
	 * handler releases it (`personSpoke`), never anything read from the record (#1179 OBJ-030).
	 */
	private async paused(row: ThreadRow, _now: Date): Promise<boolean> {
		if (!row.autoPause) return false;
		try {
			return (
				(JSON.parse(row.autoPause) as { reason?: string }).reason === "ceiling"
			);
		} catch {
			return false;
		}
	}

	/** Under any provider stop, gave-up and Blocked included: no PR, cron or agent wake starts a retry. */
	private async limited(id: string): Promise<boolean> {
		if (this.inbox) return !!(await this.inbox.providerStop(id));
		const w = await this.wakes.latest(id, "limit");
		return (
			!!w &&
			(w.state === "pending" ||
				(w.state === "skipped" &&
					(w.payload.gaveUp === true || w.payload.blocked === true)))
		);
	}

	private async pause(id: string, now: Date, countedAt: Date): Promise<void> {
		// A release after the count began wins: the count it paused on is stale.
		const { count } = await this.prisma.investigation.updateMany({
			where: {
				id,
				autoPause: null,
				OR: [{ unitsReleasedAt: null }, { unitsReleasedAt: { lt: countedAt } }],
			},
			data: {
				autoPause: JSON.stringify({
					reason: "ceiling",
					since: now.toISOString(),
				}),
			},
		});
		if (count)
			await this.say(id, [
				{ kind: "auto_paused", reason: "ceiling", text: CEILING_LINE },
			]);
	}

	private readonly locks = new Map<string, Promise<void>>();

	/**
	 * One admission at a time per thread, so two never pass the ceiling together; the PR
	 * bundler and rebuild hold it too (#1179 D23). Not re-entrant: never call it from `fn`.
	 */
	async withThreadLock(id: string, fn: () => Promise<void>): Promise<void> {
		const prior = this.locks.get(id) ?? Promise.resolve();
		const next = prior.then(fn, fn);
		const settled = next.catch(() => undefined);
		this.locks.set(id, settled);
		try {
			await next;
		} finally {
			if (this.locks.get(id) === settled) this.locks.delete(id);
		}
	}

	private async fireLimit(
		wake: Wake,
		row: ThreadRow,
		now: Date,
		/** The user's Retry now: auto-resume being off does not hold it. */
		asked = false,
	): Promise<void> {
		// Off: the wake waits, so turning auto-resume back on still resumes at once.
		if (!asked && !(await this.autoResumeOn(row))) return;
		const draft =
			typeof wake.payload.message === "string"
				? wake.payload.message
				: undefined;
		const turn = interruptedTurn(await this.investigations.allEvents(row.id));
		// What reached the thread while it was stopped follows, oldest first; admitting it takes each (#1101).
		const inbox = (await this.inbox?.queuedTree(row.id)) ?? [];
		const text = limitResumeText(
			turn,
			draft,
			resumeNoteFor(wake.payload.mode),
			inbox.map((m) => m.text),
		);
		const kind = continuableRun({
			kind: row.kind,
			status: row.status,
			hasReport: row.report !== null,
			sessionKept: followUpBlockedReason(row) === null,
		})
			? "continue"
			: "chat";
		// Unattended, a large context is compacted only by the agent's own command; never started fresh.
		const command = compactCommandOf(this.facts(row.harness));
		const session: FollowUpSession = {
			...(command && (usedOf(row.usage) ?? 0) >= (await this.threshold())
				? { compact: { command } }
				: {}),
			...(turn?.delivers.length || inbox.length
				? { delivers: [...(turn?.delivers ?? []), ...inbox.map((m) => m.id)] }
				: {}),
			...(inbox.length ? { claims: inbox.map((m) => m.id) } : {}),
		};
		await this.resume(wake, row, now, text, kind, session, "limit_reset");
	}

	private async fireIdleCompact(
		wake: Wake,
		row: ThreadRow,
		now: Date,
	): Promise<void> {
		const facts = this.facts(row.harness);
		const command = compactCommandOf(facts);
		const stale =
			wake.payload.lastActivityAt !== row.lastActivityAt?.toISOString();
		const why =
			row.settledAt !== null
				? "settled"
				: stale
					? "new activity"
					: !command || !facts || facts.compactsWhenIdle
						? "agent compacts itself or has no command"
						: !(await this.harness.getSettings()).compactIdle
							? "turned off"
							: (await this.wakes.firedSince(
										"idle_compact",
										new Date(now.getTime() - 60 * 60_000),
									)) >= IDLE_COMPACT_PER_HOUR
								? "rate cap"
								: null;
		if (why || !command) {
			await this.wakes.finish(
				wake.id,
				"skipped",
				{
					...wake.payload,
					skipped: why,
				},
				this.now(),
			);
			return;
		}
		await this.resume(
			wake,
			row,
			now,
			`/${command}`,
			"chat",
			{ compact: { command, only: true } },
			"idle_compact",
		);
	}

	/** Reopens the thread through the follow-up admission; a refusal leaves the wake for the next pass. */
	private async resume(
		wake: Wake,
		row: ThreadRow,
		now: Date,
		text: string,
		kind: "chat" | "continue",
		session: FollowUpSession,
		reason: "limit_reset" | "idle_compact" | "wake",
	): Promise<void> {
		// Recorded before the run is admitted, so its own events number after it.
		if (wake.payload.announced !== true) {
			await this.say(row.id, [{ kind: "resumed", reason }]);
			await this.wakes.setPayload(wake.id, {
				...wake.payload,
				announced: true,
			});
		}
		try {
			// The admission ends the wake in its own transaction: nothing after it can admit twice.
			await this.dispatch.resumeInvestigation(
				row.id,
				text,
				"queue",
				kind,
				[],
				{},
				undefined,
				{
					...session,
					wakeId: wake.id,
					wakeDoneAt: now,
					cause: reason === "limit_reset" ? "limit" : reason,
				},
			);
		} catch (e) {
			if (!(e instanceof FollowUpRefused)) throw e;
			// A held lease or a busy folder clears; a checkout that is gone never does.
			if (
				e instanceof CheckoutGone ||
				now.getTime() - wake.at.getTime() >= REFUSED_FOR_MS
			) {
				await this.wakes.finish(
					wake.id,
					"skipped",
					{
						...wake.payload,
						skipped: e.message,
					},
					this.now(),
				);
				await this.inbox?.failed(row.id, wake.id, { cause: "refused" });
			}
		}
	}

	/** A message wake's first due pass records its arrival once, with why it waits. */
	private async arrived(wake: Wake, row: ThreadRow): Promise<Wake> {
		if (!this.inbox || wake.payload.inbound === true) return wake;
		let out = wake;
		// Read under the lock: a rebuild may have rewritten the bundle since `due()` (#1179 OBJ-033).
		await this.withThreadLock(row.id, async () => {
			const latest = await this.wakes.latest(row.id, wake.kind);
			const cur =
				latest?.id === wake.id && latest.state === "pending" ? latest : wake;
			out = cur;
			if (!this.inbox || cur.payload.inbound === true) return;
			const prEvents = PrInboundEventsSchema.safeParse(cur.payload.prEvents);
			await this.inbox.arrived(row.id, {
				messageId: cur.id,
				source: wakeSource(cur.kind),
				arrivedAt: cur.at,
				text:
					typeof cur.payload.summary === "string"
						? cur.payload.summary
						: cur.reason,
				...(prEvents.success ? { prEvents: prEvents.data } : {}),
			});
			const payload = { ...cur.payload, inbound: true };
			await this.wakes.setPayload(cur.id, payload);
			out = { ...cur, payload };
		});
		return out;
	}

	/** After a finished turn: an idle compaction just before the agent's cache would expire, when on and evidenced. */
	async scheduleIdleCompact(row: ThreadRow): Promise<void> {
		const facts = this.facts(row.harness);
		const command = compactCommandOf(facts);
		const ttl = facts?.cacheTtlMinutes;
		if (!facts || facts.compactsWhenIdle || !command || ttl == null) return;
		if (!(await this.harness.getSettings()).compactIdle) return;
		if ((usedOf(row.usage) ?? 0) < (await this.threshold())) return;
		const fresh = await this.thread(row.id);
		const last = fresh?.lastActivityAt ?? this.now();
		await this.wakes.schedule(
			row.id,
			"idle_compact",
			new Date(last.getTime() + ttl * 60_000 - IDLE_COMPACT_LEAD_MS),
			"idle compaction",
			{ lastActivityAt: last.toISOString() },
		);
	}

	/** `POST /investigations/{id}/compact`: the agent's own command, as a turn of its own. */
	async compact(id: string, instructions?: string): Promise<boolean> {
		const row = await this.thread(id);
		if (!row || !isWorkflowTerminal(row.status))
			throw new FollowUpRefused(
				"The thread is running; compact it once it pauses.",
			);
		const command = compactCommandOf(this.facts(row.harness));
		if (!command)
			throw new FollowUpRefused(
				`${this.facts(row.harness)?.label ?? "This agent"} has no compact command.`,
			);
		return this.dispatch.resumeInvestigation(
			id,
			`/${command}`,
			"queue",
			"chat",
			[],
			{},
			undefined,
			{
				compact: {
					command,
					...(instructions ? { instructions } : {}),
					only: true,
				},
				cause: "compact",
			},
		);
	}

	/** `PUT /investigations/{id}/auto-resume`: `message` is set only by the user's own click. */
	async setAutoResume(
		id: string,
		on: boolean,
		message?: string | null,
	): Promise<void> {
		await this.prisma.investigation.updateMany({
			where: { id },
			data: { autoResume: on },
		});
		if (message === undefined) return;
		const wake = await this.wakes.latest(id, "limit");
		if (wake?.state !== "pending") return;
		const { message: _old, ...rest } = wake.payload;
		await this.wakes.setPayload(wake.id, message ? { ...rest, message } : rest);
	}

	/** The `session` the API returns for this thread. */
	async sessionOf(
		row: ThreadRow & { harness: string | null },
	): Promise<ThreadSession> {
		const settings = await this.harness.getSettings();
		const compacted = await this.prisma.investigationEvent.findFirst({
			where: {
				investigationId: row.id,
				event: { contains: '"kind":"compaction"' },
				AND: { event: { contains: '"phase":"completed"' } },
			},
			orderBy: { seq: "desc" },
			select: { event: true },
		});
		return threadSession(row, {
			now: this.now(),
			facts: this.facts(row.harness),
			resumeAfterLimit: settings.resumeAfterLimit !== false,
			limitWake: await this.wakes.latest(row.id, "limit"),
			maxAttempts: NO_TIME_ATTEMPTS,
			compaction: compactionOf(compacted?.event),
		});
	}

	private async autoResumeOn(row: ThreadRow): Promise<boolean> {
		if (row.autoResume !== null) return row.autoResume;
		return (await this.harness.getSettings()).resumeAfterLimit !== false;
	}

	private async threshold(): Promise<number> {
		return (
			(await this.harness.getSettings()).coldResumeTokens ?? COLD_RESUME_TOKENS
		);
	}

	/** How the record shows a wake's message, the thread's live or pending job counted (#1179 OBJ-032). */
	async wakeSeen(threadId: string, wakeId: string): Promise<WakeSeen> {
		const job = await this.prisma.job.findUnique({
			where: { investigationId: threadId },
			select: { status: true, payload: true },
		});
		const carried = new Set<string>();
		if (job && (job.status === "pending" || job.status === "running")) {
			try {
				const resume = (
					JSON.parse(job.payload) as {
						resume?: { messageId?: unknown; delivers?: unknown };
					}
				).resume;
				if (typeof resume?.messageId === "string")
					carried.add(resume.messageId);
				if (Array.isArray(resume?.delivers))
					for (const d of resume.delivers)
						if (typeof d === "string") carried.add(d);
			} catch {
				// An unreadable payload carries nothing.
			}
		}
		return seenAs(
			await this.investigations.allEvents(threadId),
			wakeId,
			carried,
		);
	}

	thread(id: string): Promise<ThreadRow | null> {
		return this.prisma.investigation.findUnique({
			where: { id },
			select: THREAD_FIELDS,
		});
	}

	/** PrismaLens's own lines in the thread's conversation, numbered after what is stored. */
	private async say(
		id: string,
		events: Array<Record<string, unknown>>,
	): Promise<void> {
		const seq = (await this.investigations.lastEventSeq(id)) + 1;
		const ts = this.now().toISOString();
		await this.investigations.appendEvents(
			id,
			events.map(
				(e, i) =>
					({
						...e,
						runId: id,
						branchId: "run",
						path: [],
						seq: seq + i,
						ts,
					}) as unknown as CanonicalEvent,
			),
		);
	}
}

/** How the session was last compacted, from its newest completed compaction event. */
function compactionOf(raw: string | undefined): ThreadSession["compaction"] {
	if (!raw) return "none";
	try {
		const m = (JSON.parse(raw) as { method?: unknown }).method;
		return m === "agent_command" || m === "summary" ? m : "none";
	} catch {
		return "none";
	}
}

export type WakeSeen = "delivered" | "queued" | "lost" | "missing";

/**
 * How the record shows a wake's message, following the lines that carry it (#1179 D23):
 * delivered; queued, not yet delivered; lost with a run that ended unread; or never sent.
 * An id a live or pending job names (`carried`) is queued: that job sends it.
 */
export function seenAs(
	events: readonly CanonicalEvent[],
	id: string,
	carried: ReadonlySet<string> = new Set(),
): WakeSeen {
	const ids = new Set([id]);
	let seen: Exclude<WakeSeen, "delivered"> = "missing";
	for (const e of events) {
		if (e.kind !== "operator_message" && e.kind !== "message_queued") continue;
		const names =
			(!!e.messageId && ids.has(e.messageId)) ||
			!!e.delivers?.some((d) => ids.has(d));
		if (!names) continue;
		if (e.messageId) ids.add(e.messageId);
		if (e.kind === "operator_message") {
			if (e.delivered) return "delivered";
			seen = "lost";
		} else seen = "queued";
	}
	return [...ids].some((i) => carried.has(i)) ? "queued" : seen;
}
