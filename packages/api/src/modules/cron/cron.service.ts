// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	Injectable,
	type OnModuleDestroy,
	type OnModuleInit,
} from "@nestjs/common";
import {
	CRON_EXPIRES_DAYS,
	CRON_JOBS_MAX,
	CRON_MIN_GAP_MINUTES,
	CRON_USER_QUIET_DAYS,
	type CronCreateInput,
	type CronJob,
} from "@prismalens/contracts";
import type { CronJob as CronJobRow } from "@prismalens/database";
import { Logger } from "@prismalens/logger";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import {
	nextSlots,
	type Recurrence,
	recurrenceError,
} from "../schedules/recurrence.js";
import { isSettled } from "../threads/settled.js";
import { WakesService } from "../wakes/wakes.service.js";

const DAY_MS = 24 * 60 * 60_000;
/** Jobs come due on the same 30 s beat as wakes. */
const CRON_EVERY_MS = 30_000;
/** Fires checked when validating the gap between them. */
const GAP_SAMPLE = 60;

export type CronRefusal = {
	error: string;
	code: "limit_reached" | "invalid_input" | "disabled";
	next: string;
};

/** The host's own zone: a job's schedule reads as the user's wall clock. */
export function hostTimeZone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

const recurrenceOf = (schedule: string): Recurrence => ({
	type: "cron",
	expr: schedule.trim(),
	timezone: hostTimeZone(),
});

/** Why a schedule cannot be a cron job, or null: five fields, fires at least 60 minutes apart. */
export function cronScheduleError(schedule: string, now: Date): string | null {
	const r = recurrenceOf(schedule);
	const base = recurrenceError(r);
	if (base && !/minutes apart/.test(base)) return base;
	const slots = nextSlots(r, now, GAP_SAMPLE);
	if (!slots.length) return "This cron expression never runs.";
	for (let i = 1; i < slots.length; i++)
		if (
			(slots[i] as Date).getTime() - (slots[i - 1] as Date).getTime() <
			CRON_MIN_GAP_MINUTES * 60_000
		)
			return `Fires must be at least ${CRON_MIN_GAP_MINUTES} minutes apart.`;
	return null;
}

function nextFire(schedule: string, after: Date): Date | null {
	return nextSlots(recurrenceOf(schedule), after, 1)[0] ?? null;
}

export function cronView(row: CronJobRow): CronJob {
	return {
		id: row.id,
		name: row.name,
		schedule: row.schedule,
		prompt: row.prompt,
		recurring: row.recurring,
		next: row.nextAt?.toISOString() ?? null,
		expires: row.expiresAt?.toISOString() ?? null,
		pending: row.pendingSince !== null,
		lastFiredAt: row.lastFiredAt?.toISOString() ?? null,
		skipped: row.skipped,
		createdAt: row.createdAt.toISOString(),
	};
}

/** The text one fire delivers: its name, then the agent's own prompt. */
export const fireText = (job: Pick<CronJobRow, "name" | "prompt">) =>
	`Scheduled: ${job.name}\n${job.prompt}`;

interface CronWakeJob {
	id: string;
	since: string;
}

/**
 * A thread's cron jobs (#1024 surface F): a recurring prompt the agent set on its
 * own thread. A due job is marked pending; every pending job rides one `cron`
 * wake, which is sealed once sent. A job is cleared only once its wake is done.
 */
@Injectable()
export class CronService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger({ context: "Cron" });
	private timer: ReturnType<typeof setInterval> | undefined;
	private ticking = false;

	constructor(
		private readonly prisma: PrismaService,
		private readonly wakes: WakesService,
	) {}

	onModuleInit(): void {
		// The first pass at boot turns fires missed while PrismaLens was off into one each.
		const run = () =>
			void this.tick().catch((e) =>
				this.logger.warn(`A cron pass failed: ${String(e)}`),
			);
		setTimeout(run, 1_000).unref?.();
		this.timer = setInterval(run, CRON_EVERY_MS);
		this.timer.unref?.();
	}

	onModuleDestroy(): void {
		if (this.timer) clearInterval(this.timer);
	}

	async create(
		threadId: string,
		input: CronCreateInput,
		now: Date = new Date(),
	): Promise<{ id: string; name: string; next: string } | CronRefusal> {
		const thread = await this.prisma.investigation.findUnique({
			where: { id: threadId },
			select: { id: true, createdAt: true },
		});
		if (!thread)
			return {
				error: "This thread is gone.",
				code: "invalid_input",
				next: "Finish without a cron job.",
			};
		const spoke = await this.lastUserMessageAt(threadId, thread.createdAt);
		if (now.getTime() - spoke.getTime() > CRON_USER_QUIET_DAYS * DAY_MS)
			return {
				error: `The user has not written in this thread for ${CRON_USER_QUIET_DAYS} days.`,
				code: "disabled",
				next: "Ask the user to keep this running.",
			};
		const count = await this.prisma.cronJob.count({
			where: { investigationId: threadId },
		});
		if (count >= CRON_JOBS_MAX)
			return {
				error: `This thread already has ${CRON_JOBS_MAX} cron jobs.`,
				code: "limit_reached",
				next: "Delete one with `cron_delete`.",
			};
		const why = cronScheduleError(input.schedule, now);
		if (why)
			return {
				error: why,
				code: "invalid_input",
				next: `Pass five cron fields in the host's time zone, at least ${CRON_MIN_GAP_MINUTES} minutes apart.`,
			};
		const next = nextFire(input.schedule, now);
		if (!next)
			return {
				error: "This cron expression never runs.",
				code: "invalid_input",
				next: "Pass a schedule that runs.",
			};
		const row = await this.prisma.cronJob.create({
			data: {
				investigationId: threadId,
				name: input.name ?? input.prompt.slice(0, 40),
				schedule: input.schedule.trim(),
				prompt: input.prompt,
				recurring: input.recurring,
				nextAt: next,
				expiresAt: input.recurring
					? new Date(now.getTime() + CRON_EXPIRES_DAYS * DAY_MS)
					: null,
			},
		});
		return { id: row.id, name: row.name, next: next.toISOString() };
	}

	async list(threadId: string): Promise<CronJob[]> {
		const rows = await this.prisma.cronJob.findMany({
			where: { investigationId: threadId },
			orderBy: { createdAt: "asc" },
		});
		return rows.map(cronView);
	}

	async remove(threadId: string, jobId: string): Promise<boolean> {
		const { count } = await this.prisma.cronJob.deleteMany({
			where: { id: jobId, investigationId: threadId },
		});
		if (count) await this.sync(threadId, new Date());
		return count > 0;
	}

	/** One pass: due jobs fire, then each thread's cron wake is brought up to date. */
	async tick(now: Date = new Date()): Promise<void> {
		if (this.ticking) return;
		this.ticking = true;
		try {
			const due = await this.prisma.cronJob.findMany({
				where: { nextAt: { lte: now } },
				include: {
					investigation: {
						select: {
							settledAt: true,
							lastActivityAt: true,
							updatedAt: true,
						},
					},
				},
			});
			const threads = new Set<string>();
			for (const job of due) {
				// A settled thread's jobs wait for its teardown, or for Undo.
				if (isSettled(job.investigation)) continue;
				await this.fire(job, now);
				threads.add(job.investigationId);
			}
			const pending = await this.prisma.cronJob.findMany({
				where: { OR: [{ pendingSince: { not: null } }, { nextAt: null }] },
				select: { investigationId: true },
				distinct: ["investigationId"],
			});
			for (const p of pending) threads.add(p.investigationId);
			for (const id of threads)
				await this.sync(id, now).catch((e: unknown) =>
					this.logger.warn(`Cron for ${id} waits: ${String(e)}`),
				);
		} finally {
			this.ticking = false;
		}
	}

	/**
	 * One fire: the job goes pending, or, when its last fire is still pending, the
	 * fire is skipped and counted. Missed windows collapse into this one fire.
	 */
	private async fire(job: CronJobRow, now: Date): Promise<void> {
		let nextAt: Date | null = job.recurring
			? nextFire(job.schedule, now)
			: null;
		if (nextAt && job.expiresAt && nextAt > job.expiresAt) nextAt = null;
		await this.prisma.cronJob.updateMany({
			where: { id: job.id, nextAt: job.nextAt },
			data: job.pendingSince
				? { nextAt, skipped: { increment: 1 } }
				: { nextAt, pendingSince: now, lastFiredAt: now },
		});
	}

	/**
	 * Brings the thread's cron wake up to date: a done wake clears the jobs it carried,
	 * an unsent one carries every pending job once, and a sealed one waits.
	 */
	async sync(threadId: string, now: Date): Promise<void> {
		await this.prisma.$transaction(async (tx) => {
			const wake = await this.wakes.latest(threadId, "cron", tx);
			if (wake?.state === "done")
				for (const j of (wake.payload.jobs ?? []) as CronWakeJob[])
					await tx.cronJob.updateMany({
						where: { id: j.id, pendingSince: new Date(j.since) },
						data: { pendingSince: null },
					});
			// A one-shot or expired job is gone once its last fire was delivered.
			await tx.cronJob.deleteMany({
				where: { investigationId: threadId, nextAt: null, pendingSince: null },
			});
			if (wake?.state === "pending" && wake.payload.sentTo !== undefined)
				return;
			const jobs = await tx.cronJob.findMany({
				where: { investigationId: threadId, pendingSince: { not: null } },
				orderBy: { pendingSince: "asc" },
			});
			const carried: CronWakeJob[] = jobs.map((j) => ({
				id: j.id,
				since: (j.pendingSince as Date).toISOString(),
			}));
			const open = wake?.state === "pending" ? wake : null;
			const same =
				open &&
				JSON.stringify(open.payload.jobs ?? []) === JSON.stringify(carried);
			if (same) return;
			if (!jobs.length) {
				if (open)
					await tx.threadWake.updateMany({
						where: { id: open.id, state: "pending" },
						data: { state: "cancelled", doneAt: now },
					});
				return;
			}
			await this.wakes.schedule(
				threadId,
				"cron",
				open?.at ?? now,
				jobs.map(fireText).join("\n\n"),
				{ from: "cron", jobs: carried, units: jobs.length },
				1,
				tx,
			);
		});
	}

	/** When a person last wrote in the thread: its start, or a message no wake delivered. */
	private async lastUserMessageAt(
		threadId: string,
		createdAt: Date,
	): Promise<Date> {
		const wakeIds = new Set(
			(
				await this.prisma.threadWake.findMany({
					where: { investigationId: threadId },
					select: { id: true },
				})
			).map((w) => w.id),
		);
		const rows = await this.prisma.investigationEvent.findMany({
			where: {
				investigationId: threadId,
				event: { contains: '"kind":"operator_message"' },
			},
			orderBy: { seq: "desc" },
			take: 50,
			select: { event: true },
		});
		for (const r of rows) {
			try {
				const e = JSON.parse(r.event) as { messageId?: string; ts?: string };
				if (e.messageId && wakeIds.has(e.messageId)) continue;
				if (e.ts) return new Date(e.ts);
			} catch {}
		}
		return createdAt;
	}
}
