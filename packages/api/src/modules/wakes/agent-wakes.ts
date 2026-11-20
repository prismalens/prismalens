// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PrismaService } from "../../core/prisma/prisma.service.js";
import { endSubscriptions } from "../threads/pr-subscriptions/ends.js";

/** The wakes an agent set for itself (#1024 spec B), and its cron fires; a user's stop ends them. */
export const AGENT_WAKE_KINDS = ["agent", "pr_watch", "cron"] as const;

/**
 * The user stopped or settled these threads: their agents' own wakes and PR watches end,
 * so nothing the agent asked for takes the thread up again. Every PR subscription ends
 * too, its waiting events withdrawn; the next tick rebuilds a wake that held them (#1179 D7).
 */
export async function endAgentWakes(
	prisma: Pick<
		PrismaService,
		| "threadWake"
		| "prWatch"
		| "cronJob"
		| "prSubscription"
		| "prDeliveryMember"
		| "prDelivery"
	>,
	threadIds: readonly string[],
): Promise<void> {
	if (!threadIds.length) return;
	await endSubscriptions(
		prisma,
		{ investigationId: { in: [...threadIds] } },
		"run_stopped",
	);
	// Watches go first: if that fails nothing was cancelled, and a wake that outlives a
	// stopped or settled thread is ended when it fires (session-lifecycle).
	await prisma.prWatch.deleteMany({
		where: { investigationId: { in: [...threadIds] } },
	});
	await prisma.cronJob.deleteMany({
		where: { investigationId: { in: [...threadIds] } },
	});
	await prisma.threadWake.updateMany({
		where: {
			investigationId: { in: [...threadIds] },
			kind: { in: [...AGENT_WAKE_KINDS] },
			state: "pending",
		},
		data: { state: "cancelled", doneAt: new Date() },
	});
}
