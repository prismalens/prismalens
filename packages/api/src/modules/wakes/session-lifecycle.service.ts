// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	forwardRef,
	Inject,
	Injectable,
	Logger,
	type OnModuleInit,
} from "@nestjs/common";
import {
	type CanonicalEvent,
	COLD_RESUME_TOKENS,
	continuableRun,
	isWorkflowTerminal,
	type ThreadSession,
} from "@prismalens/contracts";
import { isUsageLimitError, parseReset } from "@prismalens/engine";
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
import {
	type AgentSessionFacts,
	compactCommandOf,
	IDLE_COMPACT_LEAD_MS,
	IDLE_COMPACT_PER_HOUR,
	interruptedTurn,
	limitResumeText,
	limitWakeAt,
	NO_TIME_RETRY_MS,
	registryFacts,
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
		if (outcome.outcome === "failed" && isUsageLimitError(outcome.error)) {
			await this.recordLimit(row, outcome.error as string);
			return;
		}
		await this.wakes.cancelKind(id, "limit");
		await this.prisma.investigation.updateMany({
			where: { id },
			data: {
				limitResetsAt: null,
				...(row.endReason === "limited" ? { endReason: null } : {}),
			},
		});
		if (outcome.outcome === "succeeded") await this.scheduleIdleCompact(row);
	}

	/** Classify, extract, schedule: the agent's limit text, its reset, and the wake that resumes it. */
	async recordLimit(row: ThreadRow, text: string): Promise<void> {
		const now = this.now();
		const resetsAt = parseReset(text, now, row.harness);
		const prev = await this.wakes.latest(row.id, "limit");
		const linked =
			!resetsAt &&
			prev?.state === "done" &&
			prev.payload.noTime === true &&
			now.getTime() - prev.at.getTime() < RETRY_LINK_MS;
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
				kind: "usage_limit",
				agent: facts?.label ?? row.harness ?? "the agent",
				text,
				resetsAt: resetsAt?.toISOString() ?? null,
			},
		];
		if (!at) {
			const id = await this.wakes.schedule(
				row.id,
				"limit",
				now,
				"usage limit",
				{ noTime: true, gaveUp: true },
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
				{ noTime: !resetsAt },
				attempts,
			);
			if (await this.autoResumeOn(row))
				events.push({
					kind: "resume_scheduled",
					at: at.toISOString(),
					wakeKind: "limit",
					attempt: attempts,
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

	private async fire(wake: Wake, now: Date): Promise<void> {
		const row = await this.thread(wake.investigationId);
		if (!row) {
			await this.wakes.finish(wake.id, "cancelled", undefined, this.now());
			return;
		}
		const running = !isWorkflowTerminal(row.status);
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
		// An agent's or a PR watch's wake is never dropped: a running thread gets it at its next pause.
		// Done only once the run recorded the message under the wake's id; until then a crash would lose it.
		const seen = seenAs(await this.investigations.allEvents(row.id), wake.id);
		if (seen === "delivered" || (running && seen === "queued")) {
			await this.wakes.finish(wake.id, "done", undefined, this.now());
			return;
		}
		if (running) {
			if (wake.payload.sentTo !== row.id) {
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

	private async fireLimit(
		wake: Wake,
		row: ThreadRow,
		now: Date,
	): Promise<void> {
		// Off: the wake waits, so turning auto-resume back on still resumes at once.
		if (!(await this.autoResumeOn(row))) return;
		const draft =
			typeof wake.payload.message === "string"
				? wake.payload.message
				: undefined;
		const turn = interruptedTurn(await this.investigations.allEvents(row.id));
		const text = limitResumeText(turn, draft);
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
			...(turn?.delivers.length ? { delivers: turn.delivers } : {}),
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
				{ ...session, wakeId: wake.id },
			);
		} catch (e) {
			if (!(e instanceof FollowUpRefused)) throw e;
			// A held lease or a busy folder clears; a checkout that is gone never does.
			if (
				e instanceof CheckoutGone ||
				now.getTime() - wake.at.getTime() >= REFUSED_FOR_MS
			)
				await this.wakes.finish(
					wake.id,
					"skipped",
					{
						...wake.payload,
						skipped: e.message,
					},
					this.now(),
				);
		}
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
			{
				compact: {
					command,
					...(instructions ? { instructions } : {}),
					only: true,
				},
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
			compaction: !compacted
				? "none"
				: compacted.event.includes('"method":"agent_command"')
					? "agent_command"
					: "none",
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

/** How the record shows a wake's message: delivered, queued but not yet delivered, or not at all. */
function seenAs(
	events: readonly CanonicalEvent[],
	id: string,
): "delivered" | "queued" | "missing" {
	let seen: "queued" | "missing" = "missing";
	for (const e of events) {
		if (
			e.kind === "operator_message" &&
			e.delivered &&
			(e.messageId === id || e.delivers?.includes(id))
		)
			return "delivered";
		if (e.kind === "message_queued" && e.messageId === id) seen = "queued";
	}
	return seen;
}
