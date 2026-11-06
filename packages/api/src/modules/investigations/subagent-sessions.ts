// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import type { PrismaService } from "../../core/prisma/prisma.service.js";

type SubagentEvent = Extract<CanonicalEvent, { kind: "subagent" }>;

/**
 * Keeps `subagent_sessions` in step with a run's `subagent` events (#1025): the row
 * is what the cancel endpoint checks, the events are what the thread shows.
 */
export async function recordSubagent(
	prisma: Pick<PrismaService, "subagentSession">,
	investigationId: string,
	e: SubagentEvent,
): Promise<void> {
	const ended =
		e.state && e.state !== "running" ? { endedAt: new Date(e.ts) } : {};
	// The event sits in the lane that started it: a nested child names its parent last.
	const parent = e.path.at(-1);
	await prisma.subagentSession.upsert({
		where: {
			investigationId_sessionId: { investigationId, sessionId: e.sessionId },
		},
		create: {
			investigationId,
			sessionId: e.sessionId,
			...(parent ? { parentSessionId: parent } : {}),
			title: e.title ?? "Sub-agent",
			task: e.task ?? "",
			state: e.state ?? "running",
			canCancel: e.canCancel ?? false,
			startedAt: new Date(e.ts),
			...ended,
		},
		update: {
			...(e.title ? { title: e.title } : {}),
			...(e.task ? { task: e.task } : {}),
			...(e.state ? { state: e.state } : {}),
			...(e.canCancel !== undefined ? { canCancel: e.canCancel } : {}),
			...ended,
		},
	});
}
