// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Injectable } from "@nestjs/common";
import {
	AccessLevelSchema,
	type AskKind,
	type CanonicalEvent,
	CanonicalEventSchema,
	FailureModeSchema,
	isBlockedMode,
	isWorkflowLive,
	isWorkflowTerminal,
	type PendingAsk,
	PendingAskSchema,
	pendingAsks,
	type ThreadAsks,
	type ThreadStatusInfo,
	threadStatus,
	type WaitingOn,
} from "@prismalens/contracts";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { AsksService } from "../asks/asks.service.js";

/** What the status reads from each thread's own row. */
export interface StatusRow {
	id: string;
	status: string;
	awaitingApprovalAt: Date | null;
	autoPause: string | null;
	lastActivityAt: Date;
	lastTurnOutcome?: string | null;
}

/**
 * Each thread's one status (#1101 category 2), read in batches for the list: its open
 * asks (a durable tool ask counts after its run ends), its provider stop, and what it
 * waits on (a thread, a PR watch, an agent wake, a cron).
 */
@Injectable()
export class ThreadStatusService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly asks: AsksService,
	) {}

	async statuses(
		rows: StatusRow[],
		now = new Date(),
	): Promise<Map<string, ThreadStatusInfo>> {
		const ids = rows.map((r) => r.id);
		const [askKinds, stops, waiting] = await Promise.all([
			this.askKinds(rows),
			this.stops(ids),
			this.waitingOn(ids, now),
		]);
		const out = new Map<string, ThreadStatusInfo>();
		for (const r of rows)
			out.set(
				r.id,
				threadStatus(
					{
						live: isWorkflowLive(r.status),
						askKind: askKinds.get(r.id) ?? null,
						failed: r.status === "failed",
						stop: stops.get(r.id) ?? null,
						paused: !!r.autoPause,
						lastEventAt: r.lastActivityAt,
						waitingOn: waiting.get(r.id) ?? null,
						stopped:
							r.status === "cancelled" || r.lastTurnOutcome === "stopped",
					},
					now,
				),
			);
		return out;
	}

	/**
	 * The newest open ask's kind per thread: a live run's asks from its record, and
	 * a PrismaLens tool's open asks from their table, which outlive the run.
	 */
	private async askKinds(rows: StatusRow[]): Promise<Map<string, AskKind>> {
		const out = new Map<string, AskKind>();
		const live = rows
			.filter((r) => isWorkflowLive(r.status) && r.awaitingApprovalAt)
			.map((r) => r.id);
		if (live.length) {
			const byThread = await this.askEvents(live);
			for (const id of live)
				out.set(
					id,
					pendingAsks(id, byThread.get(id) ?? []).at(-1)?.kind ?? "permission",
				);
		}
		const tool = await this.prisma.toolAsk.findMany({
			where: { threadId: { in: rows.map((r) => r.id) }, status: "open" },
			orderBy: { openedAt: "asc" },
			select: { threadId: true, ask: true },
		});
		for (const t of tool) {
			const ask = PendingAskSchema.safeParse(JSON.parse(t.ask));
			if (ask.success && !out.has(t.threadId))
				out.set(t.threadId, ask.data.kind);
		}
		return out;
	}

	private async askEvents(ids: string[]) {
		const rows = await this.prisma.investigationEvent.findMany({
			where: {
				investigationId: { in: ids },
				OR: [
					{ event: { contains: '"kind":"permission_' } },
					{ event: { contains: '"kind":"ask_' } },
				],
			},
			orderBy: { seq: "asc" },
			select: { investigationId: true, event: true },
		});
		const byThread = new Map<string, CanonicalEvent[]>();
		for (const r of rows) {
			const parsed = CanonicalEventSchema.safeParse(JSON.parse(r.event));
			if (!parsed.success) continue;
			const list = byThread.get(r.investigationId) ?? [];
			list.push(parsed.data);
			byThread.set(r.investigationId, list);
		}
		return byThread;
	}

	/** A finished thread's provider stop, from its newest `limit` wake (L4's record, #1101). */
	private async stops(ids: string[]) {
		const out = new Map<
			string,
			{ blocked: boolean; mode?: ReturnType<typeof FailureModeSchema.parse> }
		>();
		if (!ids.length) return out;
		const rows = await this.prisma.threadWake.findMany({
			where: { investigationId: { in: ids }, kind: "limit" },
			orderBy: { createdAt: "desc" },
			select: {
				investigationId: true,
				state: true,
				payload: true,
				investigation: { select: { status: true } },
			},
		});
		const seen = new Set<string>();
		for (const r of rows) {
			if (seen.has(r.investigationId)) continue;
			seen.add(r.investigationId);
			if (!isWorkflowTerminal(r.investigation.status)) continue;
			let payload: { mode?: unknown; gaveUp?: unknown; blocked?: unknown } = {};
			try {
				payload = JSON.parse(r.payload ?? "{}") as typeof payload;
			} catch {
				payload = {};
			}
			const stopped = payload.gaveUp === true || payload.blocked === true;
			if (r.state !== "pending" && !(r.state === "skipped" && stopped))
				continue;
			const mode = FailureModeSchema.safeParse(payload.mode);
			out.set(r.investigationId, {
				blocked: payload.blocked === true || isBlockedMode(mode.data),
				...(mode.success ? { mode: mode.data } : {}),
			});
		}
		return out;
	}

	/** What each thread waits on, the most specific first: a thread, a PR, a wake, a cron. */
	private async waitingOn(
		ids: string[],
		now: Date,
	): Promise<Map<string, WaitingOn>> {
		const out = new Map<string, WaitingOn>();
		if (!ids.length) return out;
		const [waits, watches, wakes, crons] = await Promise.all([
			this.prisma.threadWait.findMany({
				where: { waiterId: { in: ids } },
				orderBy: { createdAt: "asc" },
			}),
			this.prisma.prWatch.findMany({
				where: { investigationId: { in: ids }, expiresAt: { gt: now } },
			}),
			this.prisma.threadWake.findMany({
				where: {
					investigationId: { in: ids },
					kind: "agent",
					state: "pending",
				},
				orderBy: { at: "asc" },
			}),
			this.prisma.cronJob.findMany({
				where: {
					investigationId: { in: ids },
					OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
				},
				orderBy: { nextAt: "asc" },
			}),
		]);
		const targets = await this.prisma.investigation.findMany({
			where: { id: { in: waits.map((w) => w.targetId) } },
			select: { id: true, title: true, status: true },
		});
		const target = new Map(targets.map((t) => [t.id, t]));
		const prs = await this.prisma.pullRequest.findMany({
			where: { id: { in: watches.map((w) => w.prId) } },
			select: { id: true, number: true },
		});
		const prNumber = new Map(prs.map((p) => [p.id, p.number]));
		for (const id of ids) {
			const mine = waits.filter(
				(w) =>
					w.waiterId === id &&
					// A pending start's id is no thread yet; a finished target holds nothing.
					!isWorkflowTerminal(target.get(w.targetId)?.status ?? "running"),
			);
			const first = mine[0];
			if (first) {
				out.set(id, {
					kind: "thread",
					id: first.targetId,
					title: target.get(first.targetId)?.title ?? null,
					more: mine.length - 1,
				});
				continue;
			}
			const watch = watches.find((w) => w.investigationId === id);
			if (watch) {
				const until = watch.until;
				out.set(id, {
					kind: "pr",
					number: prNumber.get(watch.prId) ?? null,
					until:
						until === "review" || until === "merged" ? until : "checks_done",
				});
				continue;
			}
			const wake = wakes.find((w) => w.investigationId === id);
			if (wake) {
				out.set(id, { kind: "wake", at: wake.at.toISOString() });
				continue;
			}
			const cron = crons.find((c) => c.investigationId === id);
			if (cron)
				out.set(id, {
					kind: "cron",
					schedule: cron.schedule,
					nextAt: cron.nextAt?.toISOString() ?? null,
				});
		}
		return out;
	}

	/** Each named thread's status, for surfaces outside the list (#1101 category 2). */
	async byIds(ids: string[], now = new Date()) {
		const rows = await this.prisma.investigation.findMany({
			where: { id: { in: ids } },
			select: {
				id: true,
				status: true,
				awaitingApprovalAt: true,
				autoPause: true,
				lastTurnOutcome: true,
				lastActivityAt: true,
				updatedAt: true,
			},
		});
		const map = await this.statuses(
			rows.map((r) => ({
				...r,
				lastActivityAt: r.lastActivityAt ?? r.updatedAt,
			})),
			now,
		);
		return { statuses: Object.fromEntries(map) };
	}

	/** Every open ask across threads, oldest first, for the list's rows (#1101 category 8). */
	async openAsks(): Promise<ThreadAsks> {
		const [live, tool] = await Promise.all([
			this.prisma.investigation.findMany({
				where: { awaitingApprovalAt: { not: null }, archivedAt: null },
				select: { id: true, status: true },
			}),
			this.prisma.toolAsk.findMany({
				where: { status: "open" },
				select: { threadId: true },
			}),
		]);
		const ids = new Set([
			...live.filter((r) => isWorkflowLive(r.status)).map((r) => r.id),
			...tool.map((t) => t.threadId),
		]);
		const threads = await this.prisma.investigation.findMany({
			where: { id: { in: [...ids] } },
			select: { id: true, status: true, accessLevel: true },
		});
		const out: ThreadAsks["asks"] = [];
		for (const t of threads) {
			const asks: PendingAsk[] = await this.asks
				.pending(t.id)
				.catch((): PendingAsk[] => []);
			const ended = !isWorkflowLive(t.status);
			for (const ask of asks) {
				out.push({
					ask,
					// Only a durable tool ask stays answerable once its run ends (#1101 cat 8 item 5).
					ended: ended && ask.source.kind !== "tool",
					accessLevel: AccessLevelSchema.safeParse(t.accessLevel).data ?? null,
				});
			}
		}
		out.sort((a, b) => a.ask.openedAt.localeCompare(b.ask.openedAt));
		return { asks: out };
	}
}
