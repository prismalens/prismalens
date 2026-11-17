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

type LaneEvent = Extract<
	CanonicalEvent,
	{ kind: "agent_step" | "tool_result" }
>;

/** Heads already given a row, per run, so repeat lane events never query (#1176 D16). */
const seenHeads = new Map<string, Set<string>>();
const SEEN_RUNS_MAX = 200;

function stringArg(args: Record<string, unknown>, key: string): string | null {
	const v = args[key];
	return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Keeps `subagent_sessions` for sub-agents that send no session of their own: their steps
 * carry the delegate call's id as the lane head, and the call's root result ends the row.
 */
export async function recordLane(
	prisma: Pick<PrismaService, "subagentSession" | "investigationEvent">,
	investigationId: string,
	e: CanonicalEvent,
): Promise<void> {
	if (e.kind !== "agent_step" && e.kind !== "tool_result") return;
	if (e.path.length === 0) {
		if (e.kind === "tool_result") await settleLane(prisma, investigationId, e);
		return;
	}
	const head = e.path[0] as string;
	let seen = seenHeads.get(investigationId);
	if (seen?.has(head)) return;
	if (!seen) {
		if (seenHeads.size >= SEEN_RUNS_MAX) seenHeads.clear();
		seen = new Set();
		seenHeads.set(investigationId, seen);
	}
	const known = await prisma.subagentSession.findUnique({
		where: { investigationId_sessionId: { investigationId, sessionId: head } },
		select: { id: true },
	});
	if (known) {
		seen.add(head);
		return;
	}
	const call = await delegateCall(prisma, investigationId, head);
	await prisma.subagentSession.upsert({
		where: { investigationId_sessionId: { investigationId, sessionId: head } },
		create: {
			investigationId,
			sessionId: head,
			title: (
				(call &&
					(stringArg(call.args, "description") ??
						stringArg(call.args, "name"))) ??
				e.label ??
				call?.name ??
				"Sub-agent"
			).slice(0, 200),
			task: (call && stringArg(call.args, "prompt")) ?? "",
			state: "running",
			startedAt: new Date(call?.at ?? e.ts),
		},
		update: {},
	});
	// Marked only once written: a failed write is tried again on the lane's next event.
	seen.add(head);
}

/** The root step that made the delegate call `head` names, if it is stored. */
async function delegateCall(
	prisma: Pick<PrismaService, "investigationEvent">,
	investigationId: string,
	head: string,
): Promise<{ name: string; args: Record<string, unknown>; at: string } | null> {
	const row = await prisma.investigationEvent.findFirst({
		where: {
			investigationId,
			event: { contains: JSON.stringify(head) },
			AND: { event: { contains: '"kind":"agent_step"' } },
		},
		orderBy: { seq: "asc" },
		select: { event: true },
	});
	if (!row) return null;
	try {
		const step = JSON.parse(row.event) as LaneEvent;
		if (step.kind !== "agent_step" || step.path.length) return null;
		const c = step.toolCalls.find((t) => t.toolCallId === head);
		return c ? { name: c.name, args: c.args, at: step.ts } : null;
	} catch {
		return null;
	}
}

async function settleLane(
	prisma: Pick<PrismaService, "subagentSession" | "investigationEvent">,
	investigationId: string,
	e: Extract<CanonicalEvent, { kind: "tool_result" }>,
): Promise<void> {
	const sessionId = e.result.toolCallId;
	const row = await prisma.subagentSession.findUnique({
		where: { investigationId_sessionId: { investigationId, sessionId } },
		select: { state: true },
	});
	if (row?.state !== "running") return;
	// A sub-agent that sends its own session events ends by them, never by a call's result.
	const own = await prisma.investigationEvent.findFirst({
		where: {
			investigationId,
			event: { contains: `"sessionId":${JSON.stringify(sessionId)}` },
			AND: { event: { contains: '"kind":"subagent"' } },
		},
		select: { id: true },
	});
	if (own) return;
	await prisma.subagentSession.updateMany({
		where: {
			investigationId,
			sessionId: e.result.toolCallId,
			state: "running",
		},
		data: {
			state: e.result.ok ? "completed" : "failed",
			endedAt: new Date(e.ts),
		},
	});
}
