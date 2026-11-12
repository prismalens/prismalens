// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { rmSync } from "node:fs";
import { type CanonicalEvent, inboundLine } from "@prismalens/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const env = await vi.hoisted(async () => {
	const fs = await import("node:fs");
	const os = await import("node:os");
	const path = await import("node:path");
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pl-inbox-spec-"));
	process.env.PRISMALENS_WORKSPACE_DIR = path.join(root, "data");
	return { root };
});

const { PrismaService } = await import("../../core/prisma/prisma.service.js");
const { InboxService } = await import("./inbox.service.js");

type Prisma = InstanceType<typeof PrismaService>;

describe("InboxService (#1101)", () => {
	let prisma: Prisma;
	let inbox: InstanceType<typeof InboxService>;
	type AppendedListener = (
		id: string,
		events: CanonicalEvent[],
	) => Promise<void> | void;
	let appendedListeners: AppendedListener[] = [];

	const investigations = {
		onEventsAppended: (fn: AppendedListener) => {
			appendedListeners.push(fn);
		},
		lastEventSeq: async (id: string) =>
			(
				await prisma.investigationEvent.aggregate({
					where: { investigationId: id },
					_max: { seq: true },
				})
			)._max.seq ?? -1,
		appendEvents: async (id: string, events: CanonicalEvent[]) => {
			for (const e of events) {
				await prisma.investigationEvent.create({
					data: {
						investigationId: id,
						seq: e.seq,
						branchId: "branchId" in e ? (e.branchId as string) : "run",
						event: JSON.stringify(e),
					},
				});
			}
			for (const fn of appendedListeners) await fn(id, events);
			return { inserted: events.length, duplicates: 0 };
		},
	};

	async function thread(over: Record<string, unknown> = {}) {
		return prisma.investigation.create({
			data: {
				status: "failed",
				kind: "investigation",
				harness: "claude-code",
				workspace: "{}",
				...over,
			},
		});
	}

	async function appendError(id: string, extra: Record<string, unknown> = {}) {
		const seq = (await investigations.lastEventSeq(id)) + 1;
		const event = {
			kind: "error",
			runId: id,
			branchId: "run",
			path: [],
			seq,
			ts: new Date().toISOString(),
			message: "Stopped",
			...extra,
		} as CanonicalEvent;
		await investigations.appendEvents(id, [event]);
	}

	beforeAll(async () => {
		const { resolveMigrationsDir, runMigrations } = await import(
			"@prismalens/database/migrator"
		);
		await runMigrations({
			migrationsDir: resolveMigrationsDir(),
			log: () => {},
		});
		prisma = new PrismaService();
		await prisma.$connect();
	});

	afterAll(async () => {
		await prisma?.$disconnect();
		try {
			rmSync(env.root, { recursive: true, force: true, maxRetries: 3 });
		} catch {
			// Windows file lock
		}
	});

	beforeEach(async () => {
		appendedListeners = [];
		await prisma.investigationEvent.deleteMany();
		await prisma.threadWake.deleteMany();
		await prisma.investigation.deleteMany();
		inbox = new InboxService(prisma, investigations as never);
		inbox.onModuleInit();
	});

	it("providerStop is null for a running and for a completed thread; { mode: 'usage_limit', window: 'session' } for a failed thread whose last error event carries that failure; the pending limit wake's payload mode when the error event has none; { mode: 'usage_limit' } from endReason: 'limited' alone", async () => {
		const runningThread = await thread({ status: "running" });
		expect(await inbox.providerStop(runningThread.id)).toBeNull();

		const completedThread = await thread({ status: "completed" });
		expect(await inbox.providerStop(completedThread.id)).toBeNull();

		const failedWithErrorThread = await thread({ status: "failed" });
		await appendError(failedWithErrorThread.id, {
			failure: { mode: "usage_limit", window: "session" },
		});
		expect(await inbox.providerStop(failedWithErrorThread.id)).toEqual({
			mode: "usage_limit",
			window: "session",
		});

		const failedWithWakeThread = await thread({ status: "failed" });
		await appendError(failedWithWakeThread.id, {});
		await prisma.threadWake.create({
			data: {
				investigationId: failedWithWakeThread.id,
				kind: "limit",
				at: new Date(),
				reason: "limit",
				state: "pending",
				payload: JSON.stringify({ mode: "usage_limit", window: "weekly" }),
			},
		});
		expect(await inbox.providerStop(failedWithWakeThread.id)).toEqual({
			mode: "usage_limit",
			window: "weekly",
		});

		const failedLimitedThread = await thread({
			status: "failed",
			endReason: "limited",
		});
		expect(await inbox.providerStop(failedLimitedThread.id)).toEqual({
			mode: "usage_limit",
		});
	});

	it("arrived on a limited thread records one message_inbound with state: 'waiting', the given messageId, source, arrivedAt ISO string, failure.mode, and line from inboundLine", async () => {
		const t = await thread({
			status: "failed",
			endReason: "limited",
			harness: "claude-code",
		});
		const arrivedAt = new Date("2026-11-12T10:00:00.000Z");
		await inbox.arrived(t.id, {
			messageId: "m-waiting-1",
			source: "thread",
			arrivedAt,
			text: "waiting message",
		});

		const rows = await prisma.investigationEvent.findMany({
			where: { investigationId: t.id },
		});
		const events = rows.map((r) => JSON.parse(r.event) as CanonicalEvent);
		const inbound = events.find((e) => e.kind === "message_inbound");

		expect(inbound).toEqual(
			expect.objectContaining({
				kind: "message_inbound",
				state: "waiting",
				messageId: "m-waiting-1",
				source: "thread",
				arrivedAt: arrivedAt.toISOString(),
				failure: { mode: "usage_limit" },
				line: inboundLine("waiting", {
					failure: { mode: "usage_limit" },
					agent: "Claude Code",
				}),
			}),
		);
	});

	it("the onEventsAppended hook: appending an operator_message delivered: true whose delivers names the waiting id records exactly one state: 'delivered' event; appending it again records no second one", async () => {
		const t = await thread({
			status: "failed",
			endReason: "limited",
			harness: "claude-code",
		});
		const arrivedAt = new Date("2026-11-12T10:00:00.000Z");
		await inbox.arrived(t.id, {
			messageId: "m-waiting-deliver",
			source: "thread",
			arrivedAt,
			text: "waiting message",
		});

		const op1 = {
			kind: "operator_message",
			runId: t.id,
			branchId: "run",
			path: [],
			seq: (await investigations.lastEventSeq(t.id)) + 1,
			ts: new Date().toISOString(),
			text: "First delivery",
			mode: "queue",
			delivered: true,
			delivers: ["m-waiting-deliver"],
		} as CanonicalEvent;
		await investigations.appendEvents(t.id, [op1]);

		const rows1 = await prisma.investigationEvent.findMany({
			where: { investigationId: t.id },
		});
		const delivered1 = rows1
			.map((r) => JSON.parse(r.event) as CanonicalEvent)
			.filter(
				(e) => e.kind === "message_inbound" && e.state === "delivered",
			);
		expect(delivered1).toHaveLength(1);
		expect(delivered1[0]).toMatchObject({
			kind: "message_inbound",
			state: "delivered",
			messageId: "m-waiting-deliver",
			line: "Delivered",
		});

		const op2 = {
			kind: "operator_message",
			runId: t.id,
			branchId: "run",
			path: [],
			seq: (await investigations.lastEventSeq(t.id)) + 1,
			ts: new Date().toISOString(),
			text: "Second delivery",
			mode: "queue",
			delivered: true,
			delivers: ["m-waiting-deliver"],
		} as CanonicalEvent;
		await investigations.appendEvents(t.id, [op2]);

		const rows2 = await prisma.investigationEvent.findMany({
			where: { investigationId: t.id },
		});
		const delivered2 = rows2
			.map((r) => JSON.parse(r.event) as CanonicalEvent)
			.filter(
				(e) => e.kind === "message_inbound" && e.state === "delivered",
			);
		expect(delivered2).toHaveLength(1);
	});

	it("failed(threadId, id, { cause: 'stopped' }) records state: 'failed', cause: 'stopped' only for a waiting message, and nothing for an unknown id", async () => {
		const t = await thread({
			status: "failed",
			endReason: "limited",
			harness: "claude-code",
		});
		const arrivedAt = new Date("2026-11-12T10:00:00.000Z");
		await inbox.arrived(t.id, {
			messageId: "m-waiting-fail",
			source: "thread",
			arrivedAt,
			text: "waiting message",
		});

		const countBefore = await prisma.investigationEvent.count({
			where: { investigationId: t.id },
		});
		await inbox.failed(t.id, "unknown-id", { cause: "stopped" });
		const countAfterUnknown = await prisma.investigationEvent.count({
			where: { investigationId: t.id },
		});
		expect(countAfterUnknown).toBe(countBefore);

		await inbox.failed(t.id, "m-waiting-fail", { cause: "stopped" });
		const rows = await prisma.investigationEvent.findMany({
			where: { investigationId: t.id },
		});
		const failed = rows
			.map((r) => JSON.parse(r.event) as CanonicalEvent)
			.filter(
				(e) =>
					e.kind === "message_inbound" &&
					e.state === "failed" &&
					e.messageId === "m-waiting-fail",
			);
		expect(failed).toHaveLength(1);
		expect(failed[0]).toMatchObject({
			kind: "message_inbound",
			state: "failed",
			messageId: "m-waiting-fail",
			cause: "stopped",
			line: "Not delivered: The thread was stopped",
		});
	});
});
