// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PrismaService } from "../../core/prisma/prisma.service.js";

/** The wakes an agent set for itself (#1024 spec B); a user's stop or settle ends them. */
export const AGENT_WAKE_KINDS = ["agent", "pr_watch"] as const;

/**
 * The user stopped or settled these threads: their agents' own wakes and PR watches end,
 * so nothing the agent asked for takes the thread up again.
 */
export async function endAgentWakes(
	prisma: Pick<PrismaService, "threadWake" | "prWatch">,
	threadIds: readonly string[],
): Promise<void> {
	if (!threadIds.length) return;
	// Watches go first: if that fails nothing was cancelled, and a wake that outlives a
	// stopped or settled thread is ended when it fires (session-lifecycle).
	await prisma.prWatch.deleteMany({
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
