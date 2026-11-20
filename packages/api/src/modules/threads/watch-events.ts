// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The record line a watch or subscription writes, and what a migrated `pl_pr_watch`
 * waited for (#1024 spec B, #1179 D22). Apart from the services so neither imports the other.
 */
import type {
	CanonicalEvent,
	PrWatchUntil,
	PullRequest,
} from "@prismalens/contracts";
import type { PrismaService } from "../../core/prisma/prisma.service.js";
import {
	type EventBus,
	type RelayMessage,
	runEventsTopic,
} from "../../infrastructure/dispatch/event-bus.js";

/** The agent's own wakes and PR watches write here, so they never race a live run's `seq`. */
export const WATCHES_BRANCH = "watches";
const SEQ_RETRIES = 8;

/** What ends a watch, in one line; null while it still waits. A closed or merged PR ends every watch. */
export function watchMet(pr: PullRequest, until: PrWatchUntil): string | null {
	if (pr.state === "merged") return "merged";
	if (pr.state === "closed") return "closed without merging";
	if (until === "merged") return null;
	if (until === "checks_done") {
		const { state, failed } = pr.checks;
		// "none" from a row the host never answered for is not a result: wait for a real read.
		const done =
			state === "passing" ||
			state === "failing" ||
			(state === "none" && pr.fetchedAt !== null);
		return done
			? `checks ${state}${failed ? ` (${failed} failed)` : ""}`
			: null;
	}
	return pr.review === "approved"
		? "approved"
		: pr.review === "changes_requested"
			? "changes requested"
			: null;
}

/** What a watch waited for, in plain words: the agent and the person read the same line (#1101 category 10). */
export const WATCH_WORDS: Record<PrWatchUntil, { met: string; never: string }> =
	{
		checks_done: {
			met: "its checks finished",
			never: "its checks never finished",
		},
		review: { met: "it got a review", never: "it never got a review" },
		merged: { met: "it was merged", never: "it was never merged" },
	};

/** Appends one event on WATCHES_BRANCH after the thread's newest, retrying a lost race, and relays it. */
export async function recordWatchEvent(
	prisma: PrismaService,
	bus: EventBus,
	threadId: string,
	body: Record<string, unknown>,
): Promise<void> {
	for (let attempt = 0; ; attempt++) {
		try {
			const event = await prisma.$transaction(async (tx) => {
				const { _max } = await tx.investigationEvent.aggregate({
					where: { investigationId: threadId },
					_max: { seq: true },
				});
				const event = {
					...body,
					runId: threadId,
					branchId: WATCHES_BRANCH,
					path: [],
					seq: (_max.seq ?? -1) + 1,
					label: null,
					ts: new Date().toISOString(),
				} as unknown as CanonicalEvent;
				await tx.investigationEvent.create({
					data: {
						investigationId: threadId,
						seq: event.seq,
						branchId: WATCHES_BRANCH,
						event: JSON.stringify(event),
					},
				});
				return event;
			});
			bus.publish<RelayMessage>(runEventsTopic(threadId), {
				kind: "event",
				event,
			});
			return;
		} catch (e) {
			const taken = (e as { code?: string })?.code === "P2002";
			if (!taken || attempt >= SEQ_RETRIES) throw e;
		}
	}
}
