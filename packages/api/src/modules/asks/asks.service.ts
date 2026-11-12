// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
	ASK_REFUSAL,
	type AskAnswer,
	AskAnswerSchema,
	type AskClosedOutcome,
	type CanonicalEvent,
	type PendingAsk,
	PendingAskSchema,
	pendingAsks,
	projectAsks,
} from "@prismalens/contracts";
import type { Prisma } from "@prismalens/database";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { DispatchService } from "../../infrastructure/dispatch/dispatch.service.js";
import {
	EVENT_BUS,
	type EventBus,
	type RelayMessage,
	runEventsTopic,
} from "../../infrastructure/dispatch/event-bus.js";
import { InvestigationsService } from "../investigations/investigations.service.js";
import { owePush, pushOwedBy } from "../push/push-outbox.js";
import {
	type AskAnswerer,
	AskConflict,
	AskForbidden,
	type AsksPort,
	type ClosedAsk,
	type OpenAsk,
} from "./asks.contract.js";

/** A `tree` answer only exists for a PrismaLens tool's ask (surface F). */
export class AskInvalid extends Error {}

/** Tool asks' events live on their own branch, so they never race a live run's `seq` (#1024). */
export const TOOL_ASK_BRANCH = "asks";
const SEQ_RETRIES = 8;

type Row = {
	askId: string;
	threadId: string;
	ask: string;
	status: string;
	outcome: string | null;
	answer: string | null;
	closedAt: Date | null;
};

function closedOf(row: Row): ClosedAsk | null {
	if (row.status !== "closed" || !row.outcome) return null;
	const answer = row.answer
		? AskAnswerSchema.safeParse(JSON.parse(row.answer))
		: null;
	return {
		ask: PendingAskSchema.parse(JSON.parse(row.ask)),
		outcome: row.outcome as AskClosedOutcome,
		...(answer?.success ? { answer: answer.data } : {}),
		closedAt: (row.closedAt ?? new Date()).toISOString(),
	};
}

/**
 * The one seat for every ask (#1024). An engine ask (permission, elicitation) lives
 * in its run, and the run answers it. A PrismaLens tool's ask (`source.kind = "tool"`)
 * is held here in `tool_asks`, not by a run: it outlives the turn that opened it and
 * a restart, and is answerable with no run live. Its events go to the thread's log on
 * TOOL_ASK_BRANCH. `onClosed` handlers are in-process; after a restart, re-read with `get`.
 */
@Injectable()
export class AsksService implements AsksPort {
	private readonly handlers = new Map<string, Set<(c: ClosedAsk) => void>>();

	constructor(
		private readonly prisma: PrismaService,
		private readonly dispatch: DispatchService,
		private readonly investigations: InvestigationsService,
		@Inject(EVENT_BUS) private readonly bus: EventBus,
	) {}

	async open(threadId: string, input: OpenAsk): Promise<string> {
		const askId = input.askId ?? randomUUID();
		const ask = PendingAskSchema.parse({
			...input,
			askId,
			threadId,
			openedAt: new Date().toISOString(),
			// ADR 0004 §6: what a PrismaLens tool would do is the host's to allow.
			requiresHost: input.requiresHost || input.source.kind === "tool",
		});
		const thread = await this.prisma.investigation.findUnique({
			where: { id: threadId },
			select: { id: true },
		});
		if (!thread) throw new AskConflict("No such thread.");
		await this.commit(threadId, { kind: "ask_opened", ask }, async (tx) => {
			await tx.toolAsk.create({
				data: { askId, threadId, ask: JSON.stringify(ask), status: "open" },
			});
			return true;
		});
		return askId;
	}

	async answer(
		threadId: string,
		askId: string,
		answer: AskAnswer,
		by: AskAnswerer,
	): Promise<ClosedAsk> {
		const row = await this.prisma.toolAsk.findUnique({ where: { askId } });
		if (row && row.threadId === threadId)
			return this.answerTool(row, answer, by);
		if (answer.kind === "permission" && answer.scope === "tree")
			throw new AskInvalid(
				"Allow for the tree is for a PrismaLens tool's ask.",
			);
		// A run's bearer token never answers anything.
		if (by.via === "run") throw new AskForbidden(ASK_REFUSAL.run);
		const result = this.dispatch.answerAsk(threadId, askId, answer);
		if (result === "invalid")
			throw new AskInvalid("That answer does not fit the ask; it still waits.");
		if (!result) throw new AskConflict("This ask is no longer waiting.");
		const ask =
			(await this.pending(threadId).catch((): PendingAsk[] => [])).find(
				(a) => a.askId === askId,
			) ?? agentAsk(threadId, askId, answer);
		const closed: ClosedAsk = {
			ask,
			outcome: result.outcome,
			answer,
			closedAt: new Date().toISOString(),
		};
		this.notify(closed);
		return closed;
	}

	async close(
		askId: string,
		outcome: "stopped" | "expired" | "answered",
	): Promise<ClosedAsk | null> {
		const row = await this.prisma.toolAsk.findUnique({ where: { askId } });
		if (!row) return null;
		// Only a secret closes answered with no answer: its value went through its own endpoint.
		if (
			outcome === "answered" &&
			PendingAskSchema.parse(JSON.parse(row.ask)).kind !== "secret"
		)
			throw new AskInvalid("Only a secret closes answered without an answer.");
		const closed = await this.settle(row, outcome);
		if (closed) return closed;
		const now = await this.prisma.toolAsk.findUnique({ where: { askId } });
		return now ? closedOf(now) : null;
	}

	/** `events` lets a caller that already holds the ask-kind events skip reading the whole record. */
	async pending(
		threadId: string,
		known?: readonly CanonicalEvent[],
	): Promise<PendingAsk[]> {
		const events = known ?? (await this.investigations.allEvents(threadId));
		// The table is the authority for a tool's ask; the log only shows it.
		const stored = pendingAsks(threadId, events).filter(
			(a) => a.source.kind !== "tool",
		);
		return [...stored, ...(await this.openToolAsks(threadId))];
	}

	async get(
		askId: string,
	): Promise<{ ask: PendingAsk; closed: ClosedAsk | null } | null> {
		const row = await this.prisma.toolAsk.findUnique({ where: { askId } });
		if (row) {
			const fresh = (await this.expireIfDue(row)) ?? row;
			return {
				ask: PendingAskSchema.parse(JSON.parse(fresh.ask)),
				closed: closedOf(fresh),
			};
		}
		const ev = await this.prisma.investigationEvent.findFirst({
			where: { event: { contains: askId } },
			select: { investigationId: true },
		});
		if (!ev) return null;
		const found = projectAsks(
			ev.investigationId,
			await this.investigations.allEvents(ev.investigationId),
		).find((a) => a.ask.askId === askId);
		if (!found) return null;
		return {
			ask: found.ask,
			closed: found.closed
				? {
						ask: found.ask,
						outcome: found.closed.outcome,
						...(found.closed.answer ? { answer: found.closed.answer } : {}),
						closedAt: found.closed.at,
					}
				: null,
		};
	}

	onClosed(askId: string, handler: (closed: ClosedAsk) => void): () => void {
		const set = this.handlers.get(askId) ?? new Set();
		set.add(handler);
		this.handlers.set(askId, set);
		// Already closed: the handler hears it once, now.
		void this.prisma.toolAsk
			.findUnique({ where: { askId } })
			.then((row) => {
				const done = row ? closedOf(row) : null;
				if (done && set.delete(handler)) handler(done);
			})
			.catch(() => {});
		return () => set.delete(handler);
	}

	private async answerTool(
		row: Row,
		answer: AskAnswer,
		by: AskAnswerer,
	): Promise<ClosedAsk> {
		const ask = PendingAskSchema.parse(JSON.parse(row.ask));
		if (ask.kind === "secret")
			throw new AskInvalid("A secret is answered through its own endpoint.");
		// A tool's ask always needs the host (ADR 0004 §6); a run's bearer never answers.
		if (by.via === "run") throw new AskForbidden(ASK_REFUSAL.run);
		if (!by.host) throw new AskForbidden(ASK_REFUSAL.toolAsk);
		if (answer.kind !== "decline" && answer.kind !== ask.kind)
			throw new AskInvalid(`This ask takes a ${ask.kind} answer.`);
		if (await this.expireIfDue(row))
			throw new AskConflict("This ask is no longer waiting.");
		const outcome: AskClosedOutcome =
			answer.kind === "decline"
				? "declined"
				: answer.kind === "permission"
					? answer.decision === "approve"
						? "approved"
						: "denied"
					: "answered";
		const closed = await this.settle(row, outcome, answer);
		if (!closed) throw new AskConflict("This ask is no longer waiting.");
		return closed;
	}

	/** Close an open tool ask once (compare-and-set on `status`); null when it was already closed. */
	private async settle(
		row: Row,
		outcome: AskClosedOutcome,
		answer?: AskAnswer,
	): Promise<ClosedAsk | null> {
		const ask = PendingAskSchema.parse(JSON.parse(row.ask));
		// A secret's value is never kept (#1024).
		const kept = answer && ask.kind !== "secret" ? answer : undefined;
		const closedAt = new Date();
		const won = await this.commit(
			row.threadId,
			{
				kind: "ask_closed",
				askId: row.askId,
				outcome,
				...(kept ? { answer: kept } : {}),
			},
			async (tx) =>
				(
					await tx.toolAsk.updateMany({
						where: { askId: row.askId, status: "open" },
						data: {
							status: "closed",
							outcome,
							answer: kept ? JSON.stringify(kept) : null,
							closedAt,
						},
					})
				).count === 1,
		);
		if (!won) return null;
		const closed: ClosedAsk = {
			ask,
			outcome,
			...(kept ? { answer: kept } : {}),
			closedAt: closedAt.toISOString(),
		};
		this.notify(closed);
		return closed;
	}

	/** A tool ask past its `expiresAt` closes as `expired` on the next read; returns the closed row. */
	private async expireIfDue(row: Row): Promise<Row | null> {
		if (row.status !== "open") return null;
		const ask = PendingAskSchema.parse(JSON.parse(row.ask));
		if (!ask.expiresAt || Date.parse(ask.expiresAt) > Date.now()) return null;
		await this.settle(row, "expired");
		return this.prisma.toolAsk.findUnique({ where: { askId: row.askId } });
	}

	private async openToolAsks(threadId: string): Promise<PendingAsk[]> {
		const rows = await this.prisma.toolAsk.findMany({
			where: { threadId, status: "open" },
			orderBy: { openedAt: "asc" },
		});
		const out: PendingAsk[] = [];
		for (const row of rows)
			if (!(await this.expireIfDue(row)))
				out.push(PendingAskSchema.parse(JSON.parse(row.ask)));
		return out;
	}

	/**
	 * Apply `change` and append its event in one transaction; false when `change` declines.
	 * The seq is taken inside it, and a collision with a concurrent writer retries (#1024).
	 */
	private async commit(
		threadId: string,
		body:
			| { kind: "ask_opened"; ask: PendingAsk }
			| {
					kind: "ask_closed";
					askId: string;
					outcome: AskClosedOutcome;
					answer?: AskAnswer;
			  },
		change: (tx: Prisma.TransactionClient) => Promise<boolean>,
	): Promise<boolean> {
		for (let attempt = 0; ; attempt++) {
			try {
				const event = await this.prisma.$transaction(async (tx) => {
					if (!(await change(tx))) return null;
					const { _max } = await tx.investigationEvent.aggregate({
						where: { investigationId: threadId },
						_max: { seq: true },
					});
					const event = {
						...body,
						runId: threadId,
						branchId: TOOL_ASK_BRANCH,
						path: [],
						seq: (_max.seq ?? -1) + 1,
						label: null,
						ts: new Date().toISOString(),
					} as CanonicalEvent;
					await tx.investigationEvent.create({
						data: {
							investigationId: threadId,
							seq: event.seq,
							branchId: TOOL_ASK_BRANCH,
							event: JSON.stringify(event),
						},
					});
					const owed = pushOwedBy(threadId, event);
					if (owed) await owePush(tx, owed);
					return event;
				});
				if (!event) return false;
				this.bus.publish<RelayMessage>(runEventsTopic(threadId), {
					kind: "event",
					event,
				});
				return true;
			} catch (e) {
				const taken = (e as { code?: string })?.code === "P2002";
				if (!taken || attempt >= SEQ_RETRIES) throw e;
			}
		}
	}

	private notify(closed: ClosedAsk): void {
		const id = closed.ask.askId;
		for (const h of this.handlers.get(id) ?? []) h(closed);
		this.handlers.delete(id);
	}
}

/** An engine ask not flushed to the log yet: enough to tell an `onClosed` handler what closed. */
function agentAsk(
	threadId: string,
	askId: string,
	answer: AskAnswer,
): PendingAsk {
	return {
		askId,
		threadId,
		kind: answer.kind === "decline" ? "question" : answer.kind,
		requiresHost: false,
		source: { kind: "agent" },
		title: "",
		openedAt: new Date().toISOString(),
	};
}
