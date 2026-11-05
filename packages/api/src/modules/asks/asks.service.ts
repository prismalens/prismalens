// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import {
	type AskAnswer,
	answerRequiresHost,
	type PendingAsk,
	PendingAskSchema,
	pendingAsks,
	projectAsks,
} from "@prismalens/contracts";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { DispatchService } from "../../infrastructure/dispatch/dispatch.service.js";
import { InvestigationsService } from "../investigations/investigations.service.js";
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

/**
 * The one seat for every ask (#1024). Engine asks live in the run's channel and
 * its events; PrismaLens tools' asks are opened here and held by the live run.
 * Only a tool ask sets `requiresHost`, and only this process can open one, so
 * the open map is the authority for who may answer while the run lives.
 */
@Injectable()
export class AsksService implements AsksPort {
	private readonly toolAsks = new Map<string, PendingAsk>();
	private readonly handlers = new Map<string, Set<(c: ClosedAsk) => void>>();
	private readonly closed = new Map<string, ClosedAsk>();

	constructor(
		private readonly prisma: PrismaService,
		private readonly dispatch: DispatchService,
		private readonly investigations: InvestigationsService,
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
		const held = this.dispatch.openToolAsk(ask);
		if (!held) throw new AskConflict("No run holds this thread.");
		this.toolAsks.set(askId, ask);
		void held.then((outcome) => {
			this.toolAsks.delete(askId);
			this.settle({
				ask,
				outcome: outcome.outcome,
				...("answer" in outcome && ask.kind !== "secret"
					? { answer: outcome.answer }
					: {}),
				closedAt: new Date().toISOString(),
			});
		});
		return askId;
	}

	async answer(
		threadId: string,
		askId: string,
		answer: AskAnswer,
		by: AskAnswerer,
	): Promise<ClosedAsk> {
		// Only a tool ask can need the host, and only this process holds those (see the class note).
		const tool = this.toolAsks.get(askId);
		if (tool?.kind === "secret")
			throw new AskInvalid("A secret is answered through its own endpoint.");
		if (answer.kind === "permission" && answer.scope === "tree" && !tool)
			throw new AskInvalid(
				"Allow for the tree is for a PrismaLens tool's ask.",
			);
		// A run's bearer token never answers; a device or a push link only what needs no host.
		if (
			by.via === "run" ||
			(tool && answerRequiresHost(tool, answer) && !by.host)
		)
			throw new AskForbidden(
				"Only this machine's own session can answer this.",
			);
		const result = this.dispatch.answerAsk(threadId, askId, answer);
		if (!result) throw new AskConflict("This ask is no longer waiting.");
		const ask =
			tool ??
			(await this.pending(threadId).catch((): PendingAsk[] => [])).find(
				(a) => a.askId === askId,
			) ??
			agentAsk(threadId, askId, answer);
		const closed: ClosedAsk = {
			ask,
			outcome: result.outcome,
			answer,
			closedAt: new Date().toISOString(),
		};
		if (!tool) this.settle(closed);
		return closed;
	}

	async pending(threadId: string): Promise<PendingAsk[]> {
		const events = await this.investigations.allEvents(threadId);
		const stored = pendingAsks(threadId, events);
		const seen = new Set(stored.map((a) => a.askId));
		// A tool ask the run has not flushed yet still waits.
		const live = [...this.toolAsks.values()].filter(
			(a) => a.threadId === threadId && !seen.has(a.askId),
		);
		return [...stored, ...live];
	}

	async get(
		askId: string,
	): Promise<{ ask: PendingAsk; closed: ClosedAsk | null } | null> {
		const live = this.toolAsks.get(askId);
		if (live) return { ask: live, closed: null };
		const kept = this.closed.get(askId);
		if (kept) return { ask: kept.ask, closed: kept };
		const row = await this.prisma.investigationEvent.findFirst({
			where: { event: { contains: askId } },
			select: { investigationId: true },
		});
		if (!row) return null;
		const found = projectAsks(
			row.investigationId,
			await this.investigations.allEvents(row.investigationId),
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
		const done = this.closed.get(askId);
		if (done) {
			handler(done);
			return () => {};
		}
		const set = this.handlers.get(askId) ?? new Set();
		set.add(handler);
		this.handlers.set(askId, set);
		return () => set.delete(handler);
	}

	private settle(closed: ClosedAsk): void {
		const id = closed.ask.askId;
		if (this.closed.has(id)) return;
		this.closed.set(id, closed);
		// Kept only to answer a late `onClosed`; the event log holds the record.
		if (this.closed.size > 500) {
			const oldest = this.closed.keys().next().value;
			if (oldest) this.closed.delete(oldest);
		}
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
