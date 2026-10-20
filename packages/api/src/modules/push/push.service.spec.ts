// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Phone push (#859) over a temp SQLite database: the outbox rides the state
 * change's transaction, a restart sends what was owed, payloads carry ids only.
 */
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import type { CanonicalEvent } from "@prismalens/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const env = await vi.hoisted(async () => {
	const fs = await import("node:fs");
	const os = await import("node:os");
	const path = await import("node:path");
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pl-push-"));
	process.env.PRISMALENS_WORKSPACE_DIR = path.join(root, "data");
	return { root };
});

const sent = vi.hoisted(() => ({
	calls: [] as Array<{ endpoint: string; payload: string }>,
	fail: null as null | { statusCode: number },
}));

vi.mock("web-push", () => {
	class WebPushError extends Error {
		constructor(
			message: string,
			readonly statusCode: number,
		) {
			super(message);
		}
	}
	return {
		default: {
			WebPushError,
			generateVAPIDKeys: () => ({ publicKey: "pub-key", privateKey: "priv-key" }),
			sendNotification: vi.fn(async (sub: { endpoint: string }, payload: string) => {
				if (sent.fail) throw new WebPushError("gone", sent.fail.statusCode);
				sent.calls.push({ endpoint: sub.endpoint, payload });
				return { statusCode: 201 };
			}),
		},
	};
});

const { PrismaService } = await import("../../core/prisma/prisma.service.js");
const { InvestigationsService } = await import("../investigations/investigations.service.js");
const { PushService } = await import("./push.service.js");
const { createPairingLink, prismaPairingStore, redeemPairingLink } = await import("@prismalens/auth");

const INCIDENT_TEXT = "checkout-db disk full on prod-eu";

describe("PushService", () => {
	let prisma: InstanceType<typeof PrismaService>;
	let investigations: InstanceType<typeof InvestigationsService>;
	let deviceId: string;

	async function run(status = "running", kind = "investigation") {
		const last = await prisma.incident.findFirst({ orderBy: { number: "desc" } });
		const incident = await prisma.incident.create({
			data: { number: (last?.number ?? 0) + 1, title: INCIDENT_TEXT },
		});
		return prisma.investigation.create({
			data: { incidentId: incident.id, status, kind, title: INCIDENT_TEXT },
		});
	}

	function askEvent(askId: string, seq: number): CanonicalEvent {
		return {
			kind: "permission_ask",
			runId: randomUUID(),
			branchId: "main",
			path: [],
			seq,
			ts: new Date().toISOString(),
			askId,
			title: "rm -rf /var/lib/postgres",
			detail: null,
			toolKind: "execute",
			expiresAt: new Date(Date.now() + 60_000).toISOString(),
		} as CanonicalEvent;
	}

	function answerEvent(askId: string, seq: number, outcome: string): CanonicalEvent {
		return {
			kind: "permission_answer",
			runId: randomUUID(),
			branchId: "main",
			path: [],
			seq,
			ts: new Date().toISOString(),
			askId,
			outcome,
			title: "rm -rf /var/lib/postgres",
		} as CanonicalEvent;
	}

	beforeAll(async () => {
		const { resolveMigrationsDir, runMigrations } = await import("@prismalens/database/migrator");
		await runMigrations({ migrationsDir: resolveMigrationsDir(), log: () => {} });
		prisma = new PrismaService();
		await prisma.$connect();
		investigations = new InvestigationsService(prisma, {} as never, {} as never, {} as never);
		const store = prismaPairingStore(prisma);
		const link = await createPairingLink(store, { label: "phone" });
		deviceId = (await redeemPairingLink(store, { token: link.token, name: "phone" })).device.id;
	}, 120_000);

	afterAll(async () => {
		await prisma?.$disconnect();
		rmSync(env.root, { recursive: true, force: true });
	});

	beforeEach(async () => {
		sent.calls.length = 0;
		sent.fail = null;
		await prisma.pushOutbox.deleteMany({});
		await prisma.pushSubscription.deleteMany({});
	});

	const subscribe = (push: InstanceType<typeof PushService>) =>
		push.subscribe(deviceId, {
			endpoint: "https://push.example/sub/1",
			keys: { p256dh: "p256", auth: "auth" },
		});

	it("writes a run_failed outbox row with the failure, and none when the write is refused", async () => {
		const failing = await run();
		await investigations.updateStatusInternal(failing.id, "failed", undefined, "boom");
		expect(await prisma.pushOutbox.findMany({ where: { investigationId: failing.id } })).toMatchObject([
			{ kind: "run_failed", deliveredAt: null },
		]);

		const cancelled = await run("cancelled");
		expect(await investigations.updateStatusInternal(cancelled.id, "failed")).toBeNull();
		expect(await prisma.pushOutbox.count({ where: { investigationId: cancelled.id } })).toBe(0);
	});

	it("writes finding_ready with a completed report, and none for a chat's answer", async () => {
		const inv = await run();
		await investigations.writeResultWithRelations(inv.id, {
			incidentId: inv.incidentId,
			status: "completed",
			summary: "s",
		} as never);
		expect(await prisma.pushOutbox.findMany({ where: { investigationId: inv.id } })).toMatchObject([
			{ kind: "finding_ready" },
		]);

		const chat = await run("running", "chat");
		await investigations.writeResultWithRelations(chat.id, {
			incidentId: chat.incidentId,
			status: "completed",
			summary: "s",
		} as never);
		expect(await prisma.pushOutbox.count({ where: { investigationId: chat.id } })).toBe(0);
	});

	it("owes a push per waiting ask and per refused one; a duplicate event's transaction rolls its outbox row back", async () => {
		const inv = await run();
		const askId = randomUUID();
		const refused = randomUUID();
		await investigations.appendEvents(inv.id, [askEvent(askId, 1), answerEvent(refused, 2, "unattended")]);
		const replay = await investigations.appendEvents(inv.id, [askEvent(askId, 1)]);

		expect(replay.duplicates).toBe(1);
		const rows = await prisma.pushOutbox.findMany({
			where: { investigationId: inv.id },
			orderBy: { createdAt: "asc" },
		});
		expect(rows.map((r) => [r.kind, r.askId])).toEqual([
			["ask_waiting", askId],
			["ask_refused", refused],
		]);
	});

	it("after a restart, boot reconciliation sends what was not delivered, and only once", async () => {
		const before = new PushService(prisma);
		await subscribe(before);
		const inv = await run();
		await investigations.updateStatusInternal(inv.id, "failed", undefined, "boom");
		// The process died before its tick: a new service boots.
		const after = new PushService(prisma);
		await after.onApplicationBootstrap();
		after.onApplicationShutdown();

		expect(sent.calls).toHaveLength(1);
		expect((await prisma.pushOutbox.findFirstOrThrow({ where: { investigationId: inv.id } })).deliveredAt).not.toBeNull();
		await after.flush();
		expect(sent.calls).toHaveLength(1);
		expect((await prisma.pushSubscription.findFirstOrThrow()).lastDeliveryAt).not.toBeNull();
	});

	it("a payload carries ids only, never the incident's text", async () => {
		const push = new PushService(prisma);
		await subscribe(push);
		const inv = await run();
		const askId = randomUUID();
		await investigations.appendEvents(inv.id, [askEvent(askId, 1)]);
		await push.flush();

		const [call] = sent.calls;
		expect(call?.payload).not.toContain(INCIDENT_TEXT);
		expect(call?.payload).not.toContain("rm -rf");
		const payload = JSON.parse(call?.payload ?? "{}");
		expect(Object.keys(payload).sort()).toEqual(["askId", "id", "investigationId", "kind"]);
		expect(payload).toMatchObject({ kind: "ask_waiting", investigationId: inv.id, askId });
		// The words come from this instance when the device asks.
		const words = await push.notification(payload.id);
		expect(words.title).toBe("An ask is waiting");
		expect(words.body).toContain(INCIDENT_TEXT);
		expect(words.url).toBe(`/investigations/${inv.id}?ask=${askId}`);
	});

	it("marks a subscription the push service dropped as expired, and stops sending to it", async () => {
		const push = new PushService(prisma);
		await subscribe(push);
		sent.fail = { statusCode: 410 };
		const health = await push.sendTest(deviceId);
		expect(health.state).toBe("expired");
		expect(health.lastError).toContain("410");

		sent.fail = null;
		const inv = await run();
		await investigations.updateStatusInternal(inv.id, "failed");
		await push.flush();
		expect(sent.calls).toHaveLength(0);
		expect((await prisma.pushOutbox.findFirstOrThrow({ where: { investigationId: inv.id } })).deliveredAt).not.toBeNull();

		// Turning push on again clears it.
		expect((await subscribe(push)).state).toBe("active");
	});

	it("a deep link resolves its own ask to its real state, not the current one", async () => {
		const push = new PushService(prisma);
		const inv = await run();
		const [answered, timedOut, refused, waiting, stopped] = Array.from({ length: 5 }, () => randomUUID());
		await investigations.appendEvents(inv.id, [
			askEvent(answered, 1),
			answerEvent(answered, 2, "approved"),
			askEvent(timedOut, 3),
			answerEvent(timedOut, 4, "timed_out"),
			answerEvent(refused, 5, "unattended"),
			askEvent(stopped, 6),
			answerEvent(stopped, 7, "stopped"),
			askEvent(waiting, 8),
		]);
		const state = async (askId: string) => (await push.askState(inv.id, askId)).state;

		expect(await state(answered)).toBe("answered");
		expect(await state(timedOut)).toBe("timed_out");
		expect(await state(refused)).toBe("needed_approval");
		expect(await state(stopped)).toBe("run_ended");
		expect(await state(waiting)).toBe("waiting");
		expect(await state(randomUUID())).toBe("unknown");
		expect((await push.askState(inv.id, refused)).title).toBe("rm -rf /var/lib/postgres");

		await prisma.investigation.update({ where: { id: inv.id }, data: { status: "completed" } });
		expect(await state(waiting)).toBe("run_ended");
	});
});
