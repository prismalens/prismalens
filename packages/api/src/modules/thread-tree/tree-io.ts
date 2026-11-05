// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { type CanonicalEvent, isWorkflowTerminal } from "@prismalens/contracts";
import { Prisma } from "@prismalens/database";
import { Logger } from "@prismalens/logger";
import type { PrismaService } from "../../core/prisma/prisma.service.js";
import {
	type DispatchService,
	FollowUpRefused,
} from "../../infrastructure/dispatch/dispatch.service.js";
import type { InvestigationsService } from "../investigations/investigations.service.js";
import type { StreamRelayService } from "../investigations/stream-relay.service.js";

/** The branch tree events are stored under, apart from the run's own numbering. */
export const TREE_BRANCH = "tree";

/** A tree event before the stream fields are added. */
export type TreeEvent = Extract<
	CanonicalEvent,
	{
		kind:
			| "thread_started"
			| "thread_message"
			| "child_finished"
			| "action_proposed"
			| "action_resolved";
	}
>;
type TreeEventBody = TreeEvent extends infer E
	? E extends TreeEvent
		? Omit<E, "runId" | "branchId" | "path" | "ts" | "seq">
		: never
	: never;

/** Where a delivery stands: taken by the agent, to retry later, or kept for the thread's next run. */
export type Delivery =
	| { state: "delivered"; messageId: string }
	| { state: "later" }
	| { state: "parked" };

const logger = new Logger({ context: "ThreadTree" });

/**
 * How the tree reaches threads (#1024 spec F): text to an agent at its next pause, and
 * transcript nodes on the `tree` branch, so they never take a seq the live run will use.
 */
@Injectable()
export class TreeIo {
	constructor(
		private readonly prisma: PrismaService,
		private readonly dispatch: DispatchService,
		private readonly investigations: InvestigationsService,
		private readonly relay: StreamRelayService,
	) {}

	/** Records a transcript node on `threadId`; never throws. */
	async record(threadId: string, body: TreeEventBody): Promise<void> {
		for (let attempt = 0; attempt < 5; attempt++) {
			try {
				const seq = (await this.investigations.lastEventSeq(threadId)) + 1;
				const event = {
					...body,
					runId: threadId,
					branchId: TREE_BRANCH,
					path: [],
					ts: new Date().toISOString(),
					seq,
				} as CanonicalEvent;
				const { inserted } = await this.investigations.appendEvents(threadId, [
					event,
				]);
				if (!inserted) continue;
				// Only onto a stream that exists: a new buffer would mark an ended run live.
				if (this.relay.isActive(threadId)) this.relay.emit(threadId, event);
				return;
			} catch (e) {
				logger.warn(
					`Could not record a tree event on ${threadId}: ${(e as Error).message}`,
				);
				return;
			}
		}
	}

	/**
	 * Hands `text` to the thread's agent. A live run takes it at its next pause (`steer`:
	 * now); an ended one reopens only when `reopen` says so, else it is kept.
	 */
	async deliver(
		threadId: string,
		text: string,
		opts: { steer?: boolean; reopen: boolean },
	): Promise<Delivery> {
		const messageId = randomUUID();
		const state = this.dispatch.sendMessage(
			threadId,
			text,
			opts.steer ? "now" : "queue",
			[],
			undefined,
			messageId,
		);
		if (state === "queued" || state === "sent")
			return { state: "delivered", messageId };
		if (state === "conflict") return { state: "later" };
		const row = await this.prisma.investigation.findUnique({
			where: { id: threadId },
			select: { status: true },
		});
		if (!row) return { state: "parked" };
		if (!isWorkflowTerminal(row.status)) return { state: "later" };
		if (!opts.reopen) return { state: "parked" };
		try {
			const resumed = await this.dispatch.resumeInvestigation(
				threadId,
				text,
				"queue",
				"chat",
			);
			return resumed ? { state: "delivered", messageId } : { state: "later" };
		} catch (e) {
			if (e instanceof FollowUpRefused) {
				logger.info(`Could not reopen ${threadId} for the tree: ${e.message}`);
				return { state: "later" };
			}
			throw e;
		}
	}
}

/** True for Prisma's unique-constraint violation. */
export const isDuplicate = (e: unknown): boolean =>
	e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
