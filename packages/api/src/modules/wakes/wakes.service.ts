// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Injectable } from "@nestjs/common";
import type { WakeKind } from "@prismalens/contracts";
import { PrismaService } from "../../core/prisma/prisma.service.js";

export type WakeState = "pending" | "done" | "skipped" | "cancelled";

/** Turns no person asked for (#1024 surface F): they share one ceiling per thread. */
export const AUTONOMOUS_KINDS = ["pr_status", "cron"] as const;

export interface Wake {
	id: string;
	investigationId: string;
	kind: WakeKind;
	at: Date;
	reason: string;
	payload: Record<string, unknown>;
	state: WakeState;
	attempts: number;
	createdAt: Date;
	doneAt: Date | null;
}

type Row = Omit<Wake, "kind" | "payload" | "state"> & {
	kind: string;
	payload: string | null;
	state: string;
};

function toWake(row: Row): Wake {
	let payload: Record<string, unknown> = {};
	try {
		const parsed: unknown = row.payload ? JSON.parse(row.payload) : {};
		if (parsed && typeof parsed === "object")
			payload = parsed as Record<string, unknown>;
	} catch {
		payload = {};
	}
	return {
		...row,
		kind: row.kind as WakeKind,
		state: row.state as WakeState,
		payload,
	};
}

/**
 * The times PrismaLens takes a thread up again (#1024): one table, one pending
 * row per (thread, kind). Another kind's wake never replaces this one. Surface B
 * schedules `agent` and `pr_watch` wakes through this service.
 */
@Injectable()
export class WakesService {
	constructor(private readonly prisma: PrismaService) {}

	/** Replaces the thread's pending wake of the same kind; answers the new wake's id. */
	async schedule(
		threadId: string,
		kind: WakeKind,
		at: Date,
		reason: string,
		payload: Record<string, unknown> = {},
		attempts = 1,
		tx?: Pick<PrismaService, "threadWake">,
	): Promise<string> {
		const write = async (tx: Pick<PrismaService, "threadWake">) => {
			await tx.threadWake.updateMany({
				where: { investigationId: threadId, kind, state: "pending" },
				data: { state: "cancelled", doneAt: new Date() },
			});
			const row = await tx.threadWake.create({
				data: {
					investigationId: threadId,
					kind,
					at,
					reason,
					payload: JSON.stringify(payload),
					attempts,
				},
			});
			return row.id;
		};
		return tx ? write(tx) : this.prisma.$transaction(write);
	}

	/** False when the wake was no longer pending. */
	async cancel(wakeId: string): Promise<boolean> {
		const { count } = await this.prisma.threadWake.updateMany({
			where: { id: wakeId, state: "pending" },
			data: { state: "cancelled", doneAt: new Date() },
		});
		return count > 0;
	}

	/** Cancels the thread's pending wake of this kind; answers how many it cancelled. */
	async cancelKind(threadId: string, kind: WakeKind): Promise<number> {
		const { count } = await this.prisma.threadWake.updateMany({
			where: { investigationId: threadId, kind, state: "pending" },
			data: { state: "cancelled", doneAt: new Date() },
		});
		return count;
	}

	/**
	 * A thread's Blocked or given-up limit ends once a turn of its finishes without
	 * one (#1101): the stop no longer describes the thread.
	 */
	async retireStopped(threadId: string): Promise<number> {
		const { count } = await this.prisma.threadWake.updateMany({
			where: { investigationId: threadId, kind: "limit", state: "skipped" },
			data: { state: "cancelled" },
		});
		return count;
	}

	/** Pending wakes whose time has come, oldest first; one missed while PrismaLens was off is due once. */
	async due(
		now: Date = new Date(),
		after?: Pick<Wake, "at" | "id">,
		take = 50,
	): Promise<Wake[]> {
		const rows = await this.prisma.threadWake.findMany({
			where: {
				state: "pending",
				at: { lte: now },
				// A page after `after`, so wakes left pending never hide the ones behind them.
				...(after
					? {
							OR: [
								{ at: { gt: after.at } },
								{ at: after.at, id: { gt: after.id } },
							],
						}
					: {}),
			},
			orderBy: [{ at: "asc" }, { id: "asc" }],
			take,
		});
		return rows.map(toWake);
	}

	/** Ends a pending wake; false when another pass already ended it. */
	async finish(
		wakeId: string,
		state: Exclude<WakeState, "pending">,
		payload?: Record<string, unknown>,
		now: Date = new Date(),
	): Promise<boolean> {
		const { count } = await this.prisma.threadWake.updateMany({
			where: { id: wakeId, state: "pending" },
			data: {
				state,
				doneAt: now,
				...(payload ? { payload: JSON.stringify(payload) } : {}),
			},
		});
		return count > 0;
	}

	/** Moves a pending wake later, keeping its attempts. */
	async defer(wakeId: string, at: Date): Promise<void> {
		await this.prisma.threadWake.updateMany({
			where: { id: wakeId, state: "pending" },
			data: { at },
		});
	}

	/** Rewrites a pending wake's payload; false when it is no longer pending. */
	async setPayload(
		wakeId: string,
		payload: Record<string, unknown>,
	): Promise<boolean> {
		const { count } = await this.prisma.threadWake.updateMany({
			where: { id: wakeId, state: "pending" },
			data: { payload: JSON.stringify(payload) },
		});
		return count > 0;
	}

	/** The thread's latest wake of this kind, in any state. */
	async latest(
		threadId: string,
		kind: WakeKind,
		db: Pick<PrismaService, "threadWake"> = this.prisma,
	): Promise<Wake | null> {
		const row = await db.threadWake.findFirst({
			where: { investigationId: threadId, kind },
			orderBy: { createdAt: "desc" },
		});
		return row ? toWake(row) : null;
	}

	/**
	 * Autonomous units a thread admitted since `since` (#1024 surface F): each
	 * `pr_status` or `cron` wake counts its payload's `units` once, at admission:
	 * when it was queued into a running thread, or when its resume was admitted.
	 */
	async autonomousUnits(
		threadId: string,
		since: Date,
		db: Pick<PrismaService, "threadWake"> = this.prisma,
	): Promise<number> {
		const rows = await db.threadWake.findMany({
			where: {
				investigationId: threadId,
				kind: { in: [...AUTONOMOUS_KINDS] },
				OR: [{ state: "done", doneAt: { gte: since } }, { state: "pending" }],
			},
		});
		let n = 0;
		for (const w of rows.map(toWake)) {
			const queued =
				typeof w.payload.admittedAt === "string"
					? new Date(w.payload.admittedAt)
					: null;
			const at = queued ?? (w.state === "done" ? w.doneAt : null);
			if (!at || at < since) continue;
			n += typeof w.payload.units === "number" ? w.payload.units : 1;
		}
		return n;
	}

	/** How many wakes of this kind were admitted since `since`, across threads; an overdue one counts when it ran. */
	async firedSince(kind: WakeKind, since: Date): Promise<number> {
		return this.prisma.threadWake.count({
			where: { kind, state: "done", doneAt: { gte: since } },
		});
	}
}
