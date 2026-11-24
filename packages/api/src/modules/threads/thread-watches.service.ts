// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Inject, Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import type { PullRequest } from "@prismalens/contracts";
import * as clock from "../../core/clock.js";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import {
	EVENT_BUS,
	type EventBus,
} from "../../infrastructure/dispatch/event-bus.js";
import type { WatchesData } from "../gateway/tools/watches.js";
import { WakesService } from "../wakes/wakes.service.js";
import {
	PrSubscriptionsService,
	type SubscribeInput,
	type ToolAnswer,
} from "./pr-subscriptions/pr-subscriptions.service.js";
import { PullRequestsService } from "./pull-requests.service.js";
import { recordWatchEvent } from "./watch-events.js";

export {
	recordWatchEvent,
	WATCH_WORDS,
	WATCHES_BRANCH,
	watchMet,
} from "./watch-events.js";

/** An agent may wake its own thread this often per day (#1024 spec B). */
export const WAKES_PER_DAY = 12;
const DAY_MS = 24 * 60 * 60_000;

/**
 * The agent's `pl_wakeup_schedule`, `pl_pr_link` and its PR subscription tools (#1024 spec B,
 * #1179). A wake is surface C's `agent` kind, delivered at the thread's next pause or by a
 * resume; a subscription is `PrSubscriptionsService`'s.
 */
@Injectable()
export class ThreadWatchesService implements WatchesData {
	constructor(
		private readonly prisma: PrismaService,
		private readonly prs: PullRequestsService,
		private readonly wakes: WakesService,
		private readonly subs: PrSubscriptionsService,
		@Inject(EVENT_BUS) private readonly bus: EventBus,
	) {}

	async wakeup(
		runId: string,
		delaySeconds: number,
		reason: string,
	): Promise<
		{ at: string; replaced: boolean } | { error: string; limit?: true }
	> {
		if (!(await this.thread(runId))) return { error: "This run is gone." };
		if (await this.overBudget(runId))
			return {
				error: `This thread already woke itself ${WAKES_PER_DAY} times in the last 24 hours.`,
				limit: true,
			};
		const replaced =
			(await this.wakes.latest(runId, "agent"))?.state === "pending";
		const at = new Date(clock.now() + delaySeconds * 1000);
		// The agent hears this as a message when it wakes; the event keeps its own words.
		const said = `The wake you scheduled (pl_wakeup_schedule) is due: ${reason}`;
		await this.wakes.schedule(runId, "agent", at, said, {
			from: "wakeup_schedule",
		});
		await this.record(runId, {
			kind: "wake_scheduled",
			wakeKind: "agent",
			at: at.toISOString(),
			reason,
			...(replaced ? { replaced: true } : {}),
		});
		return { at: at.toISOString(), replaced };
	}

	async link(
		runId: string,
		url: string,
	): Promise<{ pr: PullRequest } | { error: string }> {
		try {
			return { pr: await this.prs.linkFromUser(runId, url, "agent") };
		} catch (e) {
			if (e instanceof ORPCError) return { error: e.message };
			throw e;
		}
	}

	subscribe(runId: string, input: SubscribeInput): Promise<ToolAnswer> {
		return this.subs.subscribe(runId, input);
	}

	unsubscribe(
		runId: string,
		input: { subscription?: string; pr?: string },
	): Promise<ToolAnswer> {
		return this.subs.unsubscribe(runId, input);
	}

	subscriptions(runId: string): Promise<ToolAnswer> {
		return this.subs.forTool(runId);
	}

	/** The thread's own wakes in the last 24 hours, agent and PR watch alike, at the budget. */
	private async overBudget(runId: string): Promise<boolean> {
		const recent = await this.prisma.threadWake.count({
			where: {
				investigationId: runId,
				kind: { in: ["agent", "pr_watch"] },
				createdAt: { gte: new Date(clock.now() - DAY_MS) },
			},
		});
		return recent >= WAKES_PER_DAY;
	}

	private thread(id: string) {
		return this.prisma.investigation.findUnique({
			where: { id },
			select: { id: true },
		});
	}

	private record(
		threadId: string,
		body: Record<string, unknown>,
	): Promise<void> {
		return recordWatchEvent(this.prisma, this.bus, threadId, body);
	}
}
