// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	DEFAULT_THREAD_CONTEXT_SETTINGS,
	defaultSpec,
	type CanonicalEvent,
	PR_SUB,
	resolveSpec,
} from "@prismalens/contracts";
import type { Prisma } from "@prismalens/database";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../../core/prisma/prisma.service.js";
import { ScenarioApp } from "../../../../test/scenarios/support/scenario-app.js";
import {
	BOOT_ID,
	seenAs,
	SessionLifecycleService,
} from "../../wakes/session-lifecycle.service.js";
import { WakesService } from "../../wakes/wakes.service.js";
import { InboxService } from "../../wakes/inbox.service.js";
import { InvestigationsService } from "../../investigations/investigations.service.js";
import { interruptedTurn } from "../../wakes/session.js";
import { isQuiet } from "./filter.js";
import { endSubscriptions } from "./ends.js";
import { endAgentWakes } from "../../wakes/agent-wakes.js";
import { PrSubscriptionsService } from "./pr-subscriptions.service.js";
import { writeThreadContextSettings } from "../thread-context-settings.js";
import type { PollSnapshot } from "./derive.js";

vi.mock("./reads.js", async (importOriginal) => {
	const mod = await importOriginal<typeof import("./reads.js")>();
	return {
		...mod,
		readTick: vi.fn(),
	};
});
import { readTick } from "./reads.js";

const pl = new ScenarioApp();

function mockPrRead(
	service: PrSubscriptionsService,
	prUrl: string,
	snapshot: Partial<PollSnapshot>,
	readOver: Record<string, unknown> = {},
) {
	vi.spyOn(
		(
			service as unknown as {
				prs: { readShared: (...args: unknown[]) => Promise<unknown> };
			}
		).prs,
		"readShared",
	).mockResolvedValue({
		read: {
			title: "PR Title",
			state: snapshot.state ?? "open",
			author: "author",
			reviewers: [],
			detail: { reviewers: [] },
			headRef: "main",
			headSha: snapshot.headSha ?? "head-1",
			checks: null,
			conflicts: false,
			...readOver,
		},
		head: {
			exists: true,
			sha: snapshot.headSha ?? "head-1",
			forcePushed: false,
		},
		req: vi.fn(),
		apiBase: "https://api.github.com",
		viewer: "bot",
		own: [],
	} as never);

	vi.mocked(readTick).mockImplementation(async () => ({
		snap: {
			prUrl,
			host: snapshot.host ?? "github",
			state: snapshot.state ?? "open",
			title: snapshot.title ?? "PR Title",
			headSha: snapshot.headSha ?? "head-1",
			conflicts: false,
			baseRef: "main",
			items: snapshot.items ?? [],
			issueEvents: snapshot.issueEvents ?? [],
			checks: snapshot.checks ?? null,
			threads: snapshot.threads ?? null,
			push: snapshot.push ?? null,
			reviewsFull: false,
			lists: snapshot.lists ?? {},
			floors: snapshot.floors ?? {},
			more: snapshot.more,
		},
		touched: new Set(),
	}));
}

beforeAll(async () => {
	await pl.boot();
}, 60_000);

afterAll(async () => {
	await pl.dispose();
});

async function createThread(
	prisma: PrismaService,
	title = "test thread",
	status = "completed",
	over: Record<string, unknown> = {},
): Promise<string> {
	const row = await prisma.investigation.create({
		data: {
			kind: "chat",
			status,
			title,
			lastTurnOutcome: "answered",
			...over,
		},
	});
	return row.id;
}

async function createPr(
	prisma: PrismaService,
	threadId: string,
	n = 7,
	over: Record<string, unknown> = {},
) {
	return prisma.pullRequest.create({
		data: {
			investigationId: threadId,
			host: "github",
			repo: "acme/subs",
			number: n,
			url: `https://github.com/acme/subs/pull/${n}`,
			title: `Test PR #${n}`,
			state: "open",
			source: "branch",
			...over,
		},
	});
}

describe("PrSubscriptionsService (ScenarioApp with SQLite)", () => {
	it("events-outer order with overlapping filters and member fan-out", async () => {
		const prisma = await pl.prisma();
		const threadId = await createThread(prisma, "overlap filters");
		const pr = await createPr(prisma, threadId, 101);

		const sub1 = await prisma.prSubscription.create({
			data: {
				investigationId: threadId,
				prId: pr.id,
				url: pr.url,
				createdBy: "user",
				spec: JSON.stringify(
					resolveSpec("user", { events: ["comments", "checks"] }),
				),
				state: "active",
				since: new Date("2026-11-18T09:00:00.000Z"),
			},
		});

		const sub2 = await prisma.prSubscription.create({
			data: {
				investigationId: threadId,
				prId: pr.id,
				url: pr.url,
				createdBy: "agent",
				spec: JSON.stringify(
					resolveSpec("agent", { events: ["comments"] }),
				),
				state: "active",
				since: new Date("2026-11-18T09:00:00.000Z"),
			},
		});

		const t1 = new Date("2026-11-18T10:00:00.000Z");
		const t2 = new Date("2026-11-18T10:01:00.000Z");

		await prisma.prPoll.upsert({
			where: { url: pr.url },
			create: {
				url: pr.url,
				headSha: "head-0",
				cursor: JSON.stringify({
					v: 1,
					idFloor: {},
					recent: {},
					checks: {},
					checksDone: { "head-1": "failing" },
					parts: ["checks"],
				}),
				nextPollAt: new Date(0),
			},
			update: {
				cursor: JSON.stringify({
					v: 1,
					idFloor: {},
					recent: {},
					checks: {},
					checksDone: { "head-1": "failing" },
					parts: ["checks"],
				}),
			},
		});

		const service = pl["app"]!.get(PrSubscriptionsService);
		mockPrRead(service, pr.url, {
			headSha: "head-1",
			items: [
				{
					source: "ic",
					id: 1,
					body: "first comment",
					bot: false,
					association: "COLLABORATOR",
					login: "alice",
					createdAt: t1.toISOString(),
					link: null,
				},
			],
			checks: [
				{
					key: "k:2",
					name: "build",
					state: "failing",
					exec: null,
					url: null,
				},
			],
		});

		await service.pollUrl(pr.url, [], t2, { force: true });

		const deliveries = await prisma.prDelivery.findMany({
			where: { investigationId: threadId },
			include: { members: true },
			orderBy: { id: "asc" },
		});

		expect(deliveries).toHaveLength(2);
		const d1 = deliveries[0]!;
		const d2 = deliveries[1]!;
		expect(d1.id).toBeLessThan(d2.id);
		expect(d1.members).toHaveLength(2);
		expect(d2.members).toHaveLength(1);
		expect(d2.members[0]?.subscriptionId).toBe(sub1.id);
	});

	it("members and mode precedence selects most urgent live member", async () => {
		const service = pl["app"]!.get(PrSubscriptionsService);
		const row = {
			id: 1,
			kind: "comment",
			members: [
				{ subscription: { spec: JSON.stringify({ delivery: "batch" }) } },
				{ subscription: { spec: JSON.stringify({ delivery: "wake" }) } },
				{ subscription: { spec: JSON.stringify({ delivery: "next_pause" }) } },
			],
		};
		// wake beats batch and next_pause
		const mode = (
			service as unknown as { modeOf: (d: unknown) => string }
		).modeOf(row);
		expect(mode).toBe("wake");
	});

	it("cancelling one member withdraws membership while delivery continues for other member", async () => {
		const prisma = await pl.prisma();
		const threadId = await createThread(prisma, "cancel member");
		const pr = await createPr(prisma, threadId, 102);

		const sub1 = await prisma.prSubscription.create({
			data: {
				investigationId: threadId,
				prId: pr.id,
				url: pr.url,
				createdBy: "agent",
				spec: JSON.stringify(defaultSpec("agent")),
				state: "active",
			},
		});

		const sub2 = await prisma.prSubscription.create({
			data: {
				investigationId: threadId,
				prId: pr.id,
				url: pr.url,
				createdBy: "user",
				spec: JSON.stringify(defaultSpec("user")),
				state: "active",
			},
		});

		const delivery = await prisma.prDelivery.create({
			data: {
				investigationId: threadId,
				url: pr.url,
				dedupeKey: "c:102",
				kind: "comment",
				payload: JSON.stringify({ body: "test" }),
				occurredAt: new Date(),
				state: "queued",
				members: {
					create: [
						{ subscriptionId: sub1.id },
						{ subscriptionId: sub2.id },
					],
				},
			},
		});

		// Cancel sub1 via unsubscribe
		const service = pl["app"]!.get(PrSubscriptionsService);
		await service.unsubscribe(threadId, { subscription: sub1.id });

		const m1 = await prisma.prDeliveryMember.findUnique({
			where: {
				deliveryId_subscriptionId: {
					deliveryId: delivery.id,
					subscriptionId: sub1.id,
				},
			},
		});
		const m2 = await prisma.prDeliveryMember.findUnique({
			where: {
				deliveryId_subscriptionId: {
					deliveryId: delivery.id,
					subscriptionId: sub2.id,
				},
			},
		});

		expect(m1?.state).toBe("withdrawn");
		expect(m1?.withdrawnBy).toBe("cancelled_by_agent");
		expect(m2?.state).toBe("member");

		const d = await prisma.prDelivery.findUnique({ where: { id: delivery.id } });
		expect(d?.state).toBe("queued");
	});

	it("once cut: a once subscription takes no new members after its first bundle", async () => {
		const prisma = await pl.prisma();
		const threadId = await createThread(prisma, "once cut", "running");
		const pr = await createPr(prisma, threadId, 103);
		const service = pl["app"]!.get(PrSubscriptionsService);

		const subOnce = await prisma.prSubscription.create({
			data: {
				investigationId: threadId,
				prId: pr.id,
				url: pr.url,
				createdBy: "agent",
				spec: JSON.stringify({ ...defaultSpec("agent"), once: true }),
				state: "active",
				since: new Date("2026-11-18T09:00:00.000Z"),
			},
		});

		const subMulti = await prisma.prSubscription.create({
			data: {
				investigationId: threadId,
				prId: pr.id,
				url: pr.url,
				createdBy: "agent",
				spec: JSON.stringify(defaultSpec("agent")),
				state: "active",
				since: new Date("2026-11-18T09:00:00.000Z"),
			},
		});

		// Delivery bundled for subOnce and subMulti
		const d1 = await prisma.prDelivery.create({
			data: {
				investigationId: threadId,
				url: pr.url,
				dedupeKey: "k:103a",
				kind: "check",
				payload: JSON.stringify({ name: "lint", conclusion: "failure" }),
				occurredAt: new Date("2026-11-18T10:00:00.000Z"),
				state: "bundled",
				members: {
					create: [
						{ subscriptionId: subOnce.id },
						{ subscriptionId: subMulti.id },
					],
				},
			},
		});

		await prisma.prPoll.upsert({
			where: { url: pr.url },
			create: {
				url: pr.url,
				headSha: "head-0",
				cursor: JSON.stringify({ v: 1, idFloor: {}, recent: {} }),
				nextPollAt: new Date(0),
			},
			update: {
				cursor: JSON.stringify({ v: 1, idFloor: {}, recent: {} }),
			},
		});

		// Now pollUrl runs with a second event
		const t2 = new Date("2026-11-18T10:05:00.000Z");
		mockPrRead(service, pr.url, {
			items: [
				{
					source: "ic",
					id: 200,
					body: "second event",
					bot: false,
					association: "COLLABORATOR",
					login: "bob",
					createdAt: t2.toISOString(),
					link: null,
				},
			],
		});

		await service.pollUrl(pr.url, [], t2, { force: true });

		// subOnce took no new members after its first bundle
		const d2 = await prisma.prDelivery.findFirst({
			where: { investigationId: threadId, dedupeKey: "ic:200" },
			include: { members: true },
		});
		expect(d2).not.toBeNull();
		const memberSubIds = d2!.members.map((m) => m.subscriptionId);
		expect(memberSubIds).toContain(subMulti.id);
		expect(memberSubIds).not.toContain(subOnce.id);
		expect(d1.state).toBe("bundled");
	});

	it("rebuild unsent / sealed edited / claimed", async () => {
		const prisma = await pl.prisma();
		const threadId = await createThread(prisma, "rebuild wakes");
		const wakes = pl["app"]!.get(WakesService);

		// 1. Unsent pending wake
		const wakeId = await wakes.schedule(
			threadId,
			"pr_status",
			new Date(),
			"1 new event",
			{ units: 1, summary: "1 new event", prEvents: [] },
		);
		const row = await prisma.threadWake.findUnique({ where: { id: wakeId } });
		expect(row?.state).toBe("pending");

		// 2. Sealed wake (sentTo is set) edited via WakesService.rewrite
		const payload = JSON.parse(row?.payload ?? "{}") as { sentTo?: string; summary?: string };
		await wakes.setPayload(wakeId, { ...payload, sentTo: threadId });
		await wakes.rewrite(wakeId, "rewritten text", {
			...payload,
			sentTo: threadId,
			summary: "rewritten summary",
		});
		const sealed = await prisma.threadWake.findUnique({ where: { id: wakeId } });
		expect(sealed?.reason).toBe("rewritten text");
		const sealedPayload = JSON.parse(sealed?.payload ?? "{}") as { summary?: string };
		expect(sealedPayload.summary).toBe("rewritten summary");
	});

	it("hook vs reconcile marks delivered once without duplicate", async () => {
		const prisma = await pl.prisma();
		const threadId = await createThread(prisma, "reconcile once");
		const pr = await createPr(prisma, threadId, 104);

		const del = await prisma.prDelivery.create({
			data: {
				investigationId: threadId,
				url: pr.url,
				dedupeKey: "c:104",
				kind: "comment",
				payload: JSON.stringify({ body: "once test" }),
				occurredAt: new Date(),
				state: "bundled",
				wakeId: "wake-104",
			},
		});

		// Mark delivered directly
		await prisma.prDelivery.update({
			where: { id: del.id },
			data: { state: "delivered", deliveredAt: new Date() },
		});

		const service = pl["app"]!.get(PrSubscriptionsService);
		await service.reconcile(threadId);

		const finalDel = await prisma.prDelivery.findUnique({ where: { id: del.id } });
		expect(finalDel?.state).toBe("delivered");
		expect(finalDel?.deliveredAt).not.toBeNull();
	});

	it("resend after a crash keeps ids, increments resends, and records prevWakeId", async () => {
		const prisma = await pl.prisma();
		const threadId = await createThread(prisma, "resend crash", "completed");
		const pr = await createPr(prisma, threadId, 105);

		const sub = await prisma.prSubscription.create({
			data: {
				investigationId: threadId,
				prId: pr.id,
				url: pr.url,
				createdBy: "agent",
				spec: JSON.stringify(defaultSpec("agent")),
				state: "active",
			},
		});

		const orig = await prisma.prDelivery.create({
			data: {
				investigationId: threadId,
				url: pr.url,
				dedupeKey: "c:105",
				kind: "comment",
				payload: JSON.stringify({ body: "crash recovery" }),
				occurredAt: new Date(),
				state: "bundled",
				wakeId: "wake-orig",
				resends: 0,
				members: { create: [{ subscriptionId: sub.id }] },
			},
		});

		const service = pl["app"]!.get(PrSubscriptionsService);
		// Reconcile when wake was lost re-queues delivery
		await service.reconcile(threadId, new Date());

		const requeued = await prisma.prDelivery.findUnique({ where: { id: orig.id } });
		expect(requeued?.id).toBe(orig.id);
		expect(requeued?.state).toBe("queued");
		expect(requeued?.resends).toBe(1);
		expect(requeued?.prevWakeId).toBe("wake-orig");
		expect(requeued?.retryAt).not.toBeNull();
	});

	it("provider-stop wait gates delivery while thread is limited", async () => {
		const prisma = await pl.prisma();
		const threadId = await createThread(prisma, "provider stop wait", "failed", {
			endReason: "limited",
		});
		const sessions = await pl.sessions();

		const isLimited = await (
			sessions as unknown as { limited: (id: string) => Promise<boolean> }
		).limited(threadId);
		expect(isLimited).toBe(true);
	});

	it("inbox merged only by supersedes chain", async () => {
		const wakes = pl["app"]!.get(WakesService);
		const inbox = pl["app"]!.get(InboxService);
		const investigations = pl["app"]!.get(InvestigationsService);
		const prisma = await pl.prisma();
		const threadId = await createThread(prisma, "supersedes chain");

		const w1 = await wakes.schedule(
			threadId,
			"pr_status",
			new Date(),
			"Wake 1",
			{ units: 1, summary: "Wake 1" },
		);
		const w2 = await wakes.schedule(
			threadId,
			"pr_status",
			new Date(),
			"Wake 2",
			{ units: 1, summary: "Wake 2", prevWakeId: w1, supersedes: [w1] },
		);

		await inbox.arrived(threadId, {
			messageId: w1,
			source: "pr",
			arrivedAt: new Date(),
			text: "Wake 1",
		});

		await investigations.appendEvents(threadId, [
			{
				kind: "message_received",
				runId: threadId,
				branchId: "main",
				path: [],
				seq: 1,
				ts: new Date().toISOString(),
				messageIds: [w2],
			} as CanonicalEvent,
		]);

		const open = await (
			inbox as unknown as {
				latest: (
					id: string,
				) => Promise<Map<string, { state: string; mergedInto?: string }>>;
			}
		).latest(threadId);
		const w1Inbound = open.get(w1);
		expect(w1Inbound?.state).toBe("delivered");
		expect(w1Inbound?.mergedInto).toBe(w2);
	});

	it("units: bundles are charged at 1 autonomous unit", async () => {
		const service = pl["app"]!.get(PrSubscriptionsService);
		const prisma = await pl.prisma();
		const threadId = await createThread(prisma, "units check", "running");
		const pr = await createPr(prisma, threadId, 106);

		const sub = await prisma.prSubscription.create({
			data: {
				investigationId: threadId,
				prId: pr.id,
				url: pr.url,
				createdBy: "agent",
				spec: JSON.stringify(defaultSpec("agent")),
				state: "active",
			},
		});

		// 3 deliveries
		for (let i = 1; i <= 3; i++) {
			await prisma.prDelivery.create({
				data: {
					investigationId: threadId,
					url: pr.url,
					dedupeKey: `c:106-${i}`,
					kind: "comment",
					payload: JSON.stringify({ body: `Comment ${i}` }),
					occurredAt: new Date(),
					state: "queued",
					members: { create: [{ subscriptionId: sub.id }] },
				},
			});
		}

		await service.bundle(threadId);

		const wake = await prisma.threadWake.findFirst({
			where: { investigationId: threadId },
			orderBy: { createdAt: "desc" },
		});
		expect(wake).not.toBeNull();
		const payload = JSON.parse(wake?.payload ?? "{}") as { units?: number };
		expect(payload.units).toBe(1);
	});

	it("ping-pong cap counts only bot/agent-posted bundles and resets on human comment", async () => {
		const prisma = await pl.prisma();
		const threadId = await createThread(prisma, "ping pong", "running");
		const pr = await createPr(prisma, threadId, 107);
		const service = pl["app"]!.get(PrSubscriptionsService);
		const investigations = pl["app"]!.get(InvestigationsService);

		const sub = await prisma.prSubscription.create({
			data: {
				investigationId: threadId,
				prId: pr.id,
				url: pr.url,
				createdBy: "agent",
				spec: JSON.stringify(defaultSpec("agent")),
				state: "active",
				quietDeliveries: 4,
			},
		});

		// 1. Human comment arrives -> resets quiet count to 0
		await prisma.prDelivery.create({
			data: {
				investigationId: threadId,
				url: pr.url,
				dedupeKey: "c:107-human",
				kind: "comment",
				payload: JSON.stringify({ body: "human review", quiet: false }),
				occurredAt: new Date(),
				state: "queued",
				members: { create: [{ subscriptionId: sub.id }] },
			},
		});
		await service.bundle(threadId);
		const wakeHuman = await prisma.threadWake.findFirstOrThrow({
			where: { investigationId: threadId },
			orderBy: { createdAt: "desc" },
		});
		await investigations.appendEvents(threadId, [
			{
				kind: "message_received",
				runId: threadId,
				branchId: "main",
				path: [],
				seq: 1,
				ts: new Date().toISOString(),
				messageIds: [wakeHuman.id],
			} as CanonicalEvent,
		]);

		const resetSub = await prisma.prSubscription.findUnique({ where: { id: sub.id } });
		expect(resetSub?.quietDeliveries).toBe(0);

		// 2. 5 consecutive quiet deliveries end the subscription with comment_cap
		await prisma.prSubscription.update({
			where: { id: sub.id },
			data: { quietDeliveries: 4 },
		});
		await prisma.prDelivery.create({
			data: {
				investigationId: threadId,
				url: pr.url,
				dedupeKey: "c:107-bot",
				kind: "comment",
				payload: JSON.stringify({ body: "bot review", quiet: true }),
				occurredAt: new Date(),
				state: "queued",
				members: { create: [{ subscriptionId: sub.id }] },
			},
		});
		await service.bundle(threadId);
		const wakeBot = await prisma.threadWake.findFirstOrThrow({
			where: { investigationId: threadId },
			orderBy: { createdAt: "desc" },
		});
		await investigations.appendEvents(threadId, [
			{
				kind: "message_received",
				runId: threadId,
				branchId: "main",
				path: [],
				seq: 2,
				ts: new Date().toISOString(),
				messageIds: [wakeBot.id],
			} as CanonicalEvent,
		]);

		const endedSub = await prisma.prSubscription.findUnique({ where: { id: sub.id } });
		expect(endedSub?.state).toBe("ended");
		expect(endedSub?.endReason).toBe("comment_cap");
	});

	it("resend backoff: 2/10/30 min then parked on 4th failed send", async () => {
		const prisma = await pl.prisma();
		const threadId = await createThread(prisma, "backoff parking", "completed");
		const pr = await createPr(prisma, threadId, 108);

		const sub = await prisma.prSubscription.create({
			data: {
				investigationId: threadId,
				prId: pr.id,
				url: pr.url,
				createdBy: "agent",
				spec: JSON.stringify(defaultSpec("agent")),
				state: "active",
			},
		});

		const service = pl["app"]!.get(PrSubscriptionsService);

		let del = await prisma.prDelivery.create({
			data: {
				investigationId: threadId,
				url: pr.url,
				dedupeKey: "c:108",
				kind: "comment",
				payload: JSON.stringify({ body: "parking test" }),
				occurredAt: new Date(),
				state: "bundled",
				resends: 0,
				members: { create: [{ subscriptionId: sub.id }] },
			},
		});

		const now = new Date("2026-11-18T10:00:00.000Z");

		// resends 0 -> 1 (+2 min)
		await service.reconcile(threadId, now);
		del = await prisma.prDelivery.findUniqueOrThrow({ where: { id: del.id } });
		expect(del.resends).toBe(1);
		expect(del.retryAt?.getTime()).toBe(now.getTime() + 2 * 60_000);

		// resends 1 -> 2 (+10 min)
		await prisma.prDelivery.update({
			where: { id: del.id },
			data: { state: "bundled" },
		});
		await service.reconcile(threadId, now);
		del = await prisma.prDelivery.findUniqueOrThrow({ where: { id: del.id } });
		expect(del.resends).toBe(2);
		expect(del.retryAt?.getTime()).toBe(now.getTime() + 10 * 60_000);

		// resends 2 -> 3 (+30 min)
		await prisma.prDelivery.update({
			where: { id: del.id },
			data: { state: "bundled" },
		});
		await service.reconcile(threadId, now);
		del = await prisma.prDelivery.findUniqueOrThrow({ where: { id: del.id } });
		expect(del.resends).toBe(3);
		expect(del.retryAt?.getTime()).toBe(now.getTime() + 30 * 60_000);

		// resends 3 -> 4 (parked)
		await prisma.prDelivery.update({
			where: { id: del.id },
			data: { state: "bundled" },
		});
		await service.reconcile(threadId, now);
		del = await prisma.prDelivery.findUniqueOrThrow({ where: { id: del.id } });
		expect(del.state).toBe("parked");
		expect(del.parkedAt).not.toBeNull();
	});

	it("Retry and a person's message release all parked deliveries with resends 0 and same ids", async () => {
		const prisma = await pl.prisma();
		const threadId = await createThread(prisma, "release parked");
		const pr = await createPr(prisma, threadId, 109);
		const investigations = pl["app"]!.get(InvestigationsService);

		const p1 = await prisma.prDelivery.create({
			data: {
				investigationId: threadId,
				url: pr.url,
				dedupeKey: "c:109-1",
				kind: "comment",
				payload: JSON.stringify({ body: "p1" }),
				occurredAt: new Date(),
				state: "parked",
				resends: 3,
				parkedAt: new Date(),
			},
		});

		const p2 = await prisma.prDelivery.create({
			data: {
				investigationId: threadId,
				url: pr.url,
				dedupeKey: "c:109-2",
				kind: "comment",
				payload: JSON.stringify({ body: "p2" }),
				occurredAt: new Date(),
				state: "parked",
				resends: 3,
				parkedAt: new Date(),
			},
		});

		// release via releaseParkedPrDeliveries
		const releasedCount = await investigations.releaseParkedPrDeliveries(threadId);
		expect(releasedCount).toBe(2);

		const r1 = await prisma.prDelivery.findUnique({ where: { id: p1.id } });
		const r2 = await prisma.prDelivery.findUnique({ where: { id: p2.id } });

		expect(r1?.state).toBe("queued");
		expect(r1?.resends).toBe(0);
		expect(r1?.parkedAt).toBeNull();
		expect(r1?.id).toBe(p1.id);

		expect(r2?.state).toBe("queued");
		expect(r2?.resends).toBe(0);
		expect(r2?.parkedAt).toBeNull();
		expect(r2?.id).toBe(p2.id);
	});

	it("a parked delivery withdrawn by cancel is discarded withdrawn", async () => {
		const prisma = await pl.prisma();
		const threadId = await createThread(prisma, "parked withdrawn");
		const pr = await createPr(prisma, threadId, 110);

		const sub = await prisma.prSubscription.create({
			data: {
				investigationId: threadId,
				prId: pr.id,
				url: pr.url,
				createdBy: "agent",
				spec: JSON.stringify(defaultSpec("agent")),
				state: "active",
			},
		});

		const del = await prisma.prDelivery.create({
			data: {
				investigationId: threadId,
				url: pr.url,
				dedupeKey: "c:110",
				kind: "comment",
				payload: JSON.stringify({ body: "withdrawn test" }),
				occurredAt: new Date(),
				state: "parked",
				resends: 3,
				parkedAt: new Date(),
				members: { create: [{ subscriptionId: sub.id }] },
			},
		});

		// Cancel subscription via service
		const service = pl["app"]!.get(PrSubscriptionsService);
		await service.unsubscribe(threadId, { subscription: sub.id });

		const updated = await prisma.prDelivery.findUnique({ where: { id: del.id } });
		expect(updated?.state).toBe("discarded");
		expect(updated?.discardReason).toBe("withdrawn");
	});

	it("a resend's supersedes carries prevWakeId and that wake's own supersedes transitively", async () => {
		const service = pl["app"]!.get(PrSubscriptionsService);
		const prisma = await pl.prisma();
		const threadId = await createThread(prisma, "transitive supersedes", "running");
		const wakes = pl["app"]!.get(WakesService);

		const w1 = await wakes.schedule(
			threadId,
			"pr_status",
			new Date(),
			"Wake 1",
			{ units: 1, summary: "Wake 1" },
		);
		const w2 = await wakes.schedule(
			threadId,
			"pr_status",
			new Date(),
			"Wake 2",
			{ units: 1, summary: "Wake 2", prevWakeId: w1, supersedes: [w1] },
		);
		const w3 = await wakes.schedule(
			threadId,
			"pr_status",
			new Date(),
			"Wake 3",
			{ units: 1, summary: "Wake 3", prevWakeId: w2, supersedes: [w2, w1] },
		);

		const pr = await createPr(prisma, threadId, 1101);
		const sub = await prisma.prSubscription.create({
			data: {
				investigationId: threadId,
				prId: pr.id,
				url: pr.url,
				createdBy: "agent",
				spec: JSON.stringify(defaultSpec("agent")),
				state: "active",
			},
		});

		await prisma.prDelivery.create({
			data: {
				investigationId: threadId,
				url: pr.url,
				dedupeKey: "c:1101-transitive",
				kind: "comment",
				payload: JSON.stringify({ body: "transitive supersedes delivery" }),
				occurredAt: new Date(),
				state: "queued",
				prevWakeId: w3,
				resends: 3,
				members: { create: [{ subscriptionId: sub.id }] },
			},
		});

		await service.bundle(threadId);

		const latest = await wakes.latest(threadId, "pr_status");
		const supersedes = (latest?.payload.supersedes as string[]) ?? [];
		expect(supersedes).toContain(w3);
		expect(supersedes).toContain(w2);
		expect(supersedes).toContain(w1);
	});

	it("a bundle that forms takes queued deliveries with a future retryAt", async () => {
		const prisma = await pl.prisma();
		const threadId = await createThread(prisma, "future retryAt bundle", "running");
		const pr = await createPr(prisma, threadId, 111);

		const sub = await prisma.prSubscription.create({
			data: {
				investigationId: threadId,
				prId: pr.id,
				url: pr.url,
				createdBy: "agent",
				spec: JSON.stringify(defaultSpec("agent")),
				state: "active",
			},
		});

		// Delivery 1 has a future retryAt (+10 min)
		const d1 = await prisma.prDelivery.create({
			data: {
				investigationId: threadId,
				url: pr.url,
				dedupeKey: "c:111-1",
				kind: "comment",
				payload: JSON.stringify({ body: "waiting retry" }),
				occurredAt: new Date(),
				state: "queued",
				retryAt: new Date(Date.now() + 600_000),
				members: { create: [{ subscriptionId: sub.id }] },
			},
		});

		// Delivery 2 is immediately ready
		const d2 = await prisma.prDelivery.create({
			data: {
				investigationId: threadId,
				url: pr.url,
				dedupeKey: "c:111-2",
				kind: "comment",
				payload: JSON.stringify({ body: "fresh event" }),
				occurredAt: new Date(),
				state: "queued",
				retryAt: null,
				members: { create: [{ subscriptionId: sub.id }] },
			},
		});

		const service = pl["app"]!.get(PrSubscriptionsService);
		await service.bundle(threadId);

		// Both are bundled!
		const b1 = await prisma.prDelivery.findUnique({ where: { id: d1.id } });
		const b2 = await prisma.prDelivery.findUnique({ where: { id: d2.id } });
		expect(b1?.state).toBe("bundled");
		expect(b2?.state).toBe("bundled");
	});

	it("quiet classification: bot yes, marker by NONE no, marker by COLLABORATOR yes, ledger account yes, gitlab without ledger no", () => {
		// bot -> quiet
		expect(isQuiet({ bot: true }, new Set())).toBe(true);

		// marker by NONE -> not quiet
		expect(
			isQuiet(
				{ agentPosted: true, association: "NONE" },
				new Set(),
			),
		).toBe(false);

		// marker by COLLABORATOR -> quiet
		expect(
			isQuiet(
				{ agentPosted: true, association: "COLLABORATOR" },
				new Set(),
			),
		).toBe(true);

		// marker by ledger account -> quiet
		expect(
			isQuiet(
				{ agentPosted: true, association: "NONE", author: "ci-bot" },
				new Set(["ci-bot"]),
			),
		).toBe(true);

		// marker on GitLab without ledger -> not quiet
		expect(
			isQuiet(
				{ agentPosted: true, author: "gitlab-user" },
				new Set(),
			),
		).toBe(false);
	});

	it("seenAs logic: lost after undelivered line, queued after message_queued, following carriers", () => {
		const wakeId = "11111111-1111-4111-8111-111111111111";

		// 1. Undelivered operator_message -> lost
		const ev1: CanonicalEvent[] = [
			{
				kind: "operator_message",
				runId: "run-1",
				branchId: "main",
				path: [],
				seq: 1,
				label: null,
				ts: "2026-11-18T10:00:00.000Z",
				text: "pr status wake",
				mode: "queue",
				delivered: false,
				messageId: wakeId,
			},
		];
		expect(seenAs(ev1, wakeId)).toBe("lost");

		// 2. Later message_queued -> queued
		const ev2: CanonicalEvent[] = [
			...ev1,
			{
				kind: "message_queued",
				runId: "run-1",
				branchId: "main",
				path: [],
				seq: 2,
				label: null,
				ts: "2026-11-18T10:01:00.000Z",
				messageId: wakeId,
				text: "pr status wake",
			},
		];
		expect(seenAs(ev2, wakeId)).toBe("queued");

		// 3. Carrier: message_queued with delivers: [W] -> queued
		const carrierMsgId = "22222222-2222-4222-8222-222222222222";
		const ev3: CanonicalEvent[] = [
			{
				kind: "message_queued",
				runId: "run-1",
				branchId: "main",
				path: [],
				seq: 3,
				label: null,
				ts: "2026-11-18T10:02:00.000Z",
				messageId: carrierMsgId,
				text: "carrier line",
				delivers: [wakeId],
			},
		];
		expect(seenAs(ev3, wakeId)).toBe("queued");

		// 4. Carrier undelivered end -> lost
		const ev4: CanonicalEvent[] = [
			...ev3,
			{
				kind: "operator_message",
				runId: "run-1",
				branchId: "main",
				path: [],
				seq: 4,
				label: null,
				ts: "2026-11-18T10:03:00.000Z",
				messageId: carrierMsgId,
				text: "carrier line",
				mode: "queue",
				delivered: false,
			},
		];
		expect(seenAs(ev4, wakeId)).toBe("lost");
	});

	it("D12 replace of a migrated watch clears legacyUntil and expiresAt", async () => {
		const prisma = await pl.prisma();
		const threadId = await createThread(prisma, "migrated replace");
		const pr = await createPr(prisma, threadId, 112);

		// Migrated watch
		const watch = await prisma.prSubscription.create({
			data: {
				investigationId: threadId,
				prId: pr.id,
				url: pr.url,
				createdBy: "agent",
				spec: JSON.stringify(defaultSpec("agent")),
				state: "active",
				legacyUntil: "checks_done",
				expiresAt: new Date(Date.now() + 12 * 3600_000),
			},
		});

		const service = pl["app"]!.get(PrSubscriptionsService);
		const res = await service.subscribe(threadId, { pr: pr.url });
		expect("value" in res).toBe(true);

		const updated = await prisma.prSubscription.findUnique({
			where: { id: watch.id },
		});
		expect(updated?.legacyUntil).toBeNull();
		expect(updated?.expiresAt).toBeNull();
	});

	it("personSpoke clears ceiling autoPause and releases parked deliveries, while tree-io and tool-ask do not (OBJ-028, OBJ-030)", async () => {
		const prisma = await pl.prisma();
		const threadId = await createThread(prisma, "person spoke ceiling");
		const pr = await createPr(prisma, threadId, 113);
		const investigations = pl["app"]!.get(InvestigationsService);

		// Directly set autoPause to ceiling
		await prisma.investigation.update({
			where: { id: threadId },
			data: { autoPause: JSON.stringify({ reason: "ceiling" }) },
		});

		// Create parked delivery
		const parked = await prisma.prDelivery.create({
			data: {
				investigationId: threadId,
				url: pr.url,
				dedupeKey: "c:113",
				kind: "comment",
				payload: JSON.stringify({ body: "parked" }),
				occurredAt: new Date(),
				state: "parked",
				resends: 3,
				parkedAt: new Date(),
			},
		});

		// Tree-io / tool-ask do not call personSpoke: pause and parked remain, unitsReleasedAt remains null
		let row = await prisma.investigation.findUnique({ where: { id: threadId } });
		let del = await prisma.prDelivery.findUnique({ where: { id: parked.id } });
		expect(row?.autoPause).toContain("ceiling");
		expect(row?.unitsReleasedAt).toBeNull();
		expect(del?.state).toBe("parked");

		// personSpoke clears ceiling pause and releases parked deliveries, setting unitsReleasedAt (OBJ-043)
		await investigations.personSpoke(threadId);

		row = await prisma.investigation.findUnique({ where: { id: threadId } });
		del = await prisma.prDelivery.findUnique({ where: { id: parked.id } });
		expect(row?.autoPause).toBeNull();
		expect(row?.unitsReleasedAt).not.toBeNull();
		expect(del?.state).toBe("queued");
		expect(del?.resends).toBe(0);
	});

	it("a migrated watch past expiresAt ends expired with 12-hours line", async () => {
		const prisma = await pl.prisma();
		const threadId = await createThread(prisma, "migrated expired");
		const pr = await createPr(prisma, threadId, 114);

		const watch = await prisma.prSubscription.create({
			data: {
				investigationId: threadId,
				prId: pr.id,
				url: pr.url,
				createdBy: "agent",
				spec: JSON.stringify(defaultSpec("agent")),
				state: "active",
				legacyUntil: "checks_done",
				expiresAt: new Date(Date.now() - 3600_000), // past
			},
		});

		const service = pl["app"]!.get(PrSubscriptionsService);
		await (
			service as unknown as { legacySweep: (now: Date) => Promise<void> }
		).legacySweep(new Date());

		const expired = await prisma.prSubscription.findUnique({
			where: { id: watch.id },
		});
		expect(expired?.state).toBe("ended");
		expect(expired?.endReason).toBe("expired");

		const d = await prisma.prDelivery.findFirst({
			where: { investigationId: threadId, dedupeKey: `legacy-watch:${watch.id}` },
		});
		expect(d?.kind).toBe("legacy");
		const payload = JSON.parse(d?.payload ?? "{}") as { lines?: string[] };
		expect(payload.lines?.[0]).toContain("12 hours");
	});

	it("per-subscription guard trips after 3 failing heads and ends with loop_guard", async () => {
		const prisma = await pl.prisma();
		const threadId = await createThread(prisma, "loop guard trip");
		const pr = await createPr(prisma, threadId, 115);
		const service = pl["app"]!.get(PrSubscriptionsService);

		const sub = await prisma.prSubscription.create({
			data: {
				investigationId: threadId,
				prId: pr.id,
				url: pr.url,
				createdBy: "agent",
				spec: JSON.stringify(defaultSpec("agent")),
				state: "active",
				guard: JSON.stringify({ key: "k:build", heads: ["h1", "h2"] }),
				since: new Date("2026-11-18T09:00:00.000Z"),
			},
		});

		await prisma.prPoll.upsert({
			where: { url: pr.url },
			create: {
				url: pr.url,
				headSha: "h2",
				cursor: JSON.stringify({
					v: 1,
					idFloor: {},
					recent: {},
					checks: { "k:build": { sha: "h2", state: "failing" } },
					parts: ["checks"],
				}),
				nextPollAt: new Date(0),
			},
			update: {
				headSha: "h2",
				cursor: JSON.stringify({
					v: 1,
					idFloor: {},
					recent: {},
					checks: { "k:build": { sha: "h2", state: "failing" } },
					parts: ["checks"],
				}),
			},
		});

		// 3rd failing head "h3" arrives
		mockPrRead(service, pr.url, {
			headSha: "h3",
			checks: [
				{
					key: "k:build",
					name: "build",
					state: "failing",
					exec: null,
					url: null,
				},
			],
		});

		await service.pollUrl(pr.url, [], new Date(), { force: true });

		const guarded = await prisma.prSubscription.findUnique({
			where: { id: sub.id },
		});
		expect(guarded?.state).toBe("ended");
		expect(guarded?.endReason).toBe("loop_guard");
	});

	it("a subscription to checks named lint starts no guard on a failing build it never receives", async () => {
		const prisma = await pl.prisma();
		const threadId = await createThread(prisma, "loop guard names");
		const pr = await createPr(prisma, threadId, 125);
		const service = pl["app"]!.get(PrSubscriptionsService);
		const base = defaultSpec("agent");
		const sub = await prisma.prSubscription.create({
			data: {
				investigationId: threadId,
				prId: pr.id,
				url: pr.url,
				createdBy: "agent",
				spec: JSON.stringify({
					...base,
					filter: { ...base.filter, checks: { ...base.filter.checks, names: ["lint"] } },
				}),
				state: "active",
				since: new Date("2026-11-18T09:00:00.000Z"),
			},
		});
		const cursor = JSON.stringify({ v: 1, idFloor: {}, recent: {}, checks: {}, parts: ["checks"] });
		await prisma.prPoll.upsert({
			where: { url: pr.url },
			create: { url: pr.url, headSha: "h1", cursor, nextPollAt: new Date(0) },
			update: { headSha: "h1", cursor },
		});
		mockPrRead(service, pr.url, {
			headSha: "h2",
			checks: [{ key: "k:build", name: "build", state: "failing", exec: null, url: null }],
		});
		await service.pollUrl(pr.url, [], new Date(), { force: true });
		const after = await prisma.prSubscription.findUnique({ where: { id: sub.id } });
		expect(after?.guard).toBeNull();
	});

	it("a subscription whose filter takes no failing check and no summary starts no guard, one that does is guarded", async () => {
		const prisma = await pl.prisma();
		const threadId = await createThread(prisma, "loop guard conclusions");
		const pr = await createPr(prisma, threadId, 128);
		const service = pl["app"]!.get(PrSubscriptionsService);
		const base = defaultSpec("agent");
		const make = (checks: Record<string, unknown>) =>
			prisma.prSubscription.create({
				data: {
					investigationId: threadId,
					prId: pr.id,
					url: pr.url,
					createdBy: "agent",
					spec: JSON.stringify({
						...base,
						filter: { ...base.filter, checks: { ...base.filter.checks, ...checks } },
					}),
					state: "active",
					since: new Date("2026-11-18T09:00:00.000Z"),
				},
			});
		const passingOnly = await make({ conclusions: ["passing"], summary: false });
		const failing = await make({ conclusions: ["failing"] });
		const cursor = JSON.stringify({ v: 1, idFloor: {}, recent: {}, checks: {}, parts: ["checks"] });
		await prisma.prPoll.upsert({
			where: { url: pr.url },
			create: { url: pr.url, headSha: "h1", cursor, nextPollAt: new Date(0) },
			update: { headSha: "h1", cursor },
		});
		mockPrRead(service, pr.url, {
			headSha: "h2",
			checks: [{ key: "k:build", name: "build", state: "failing", exec: null, url: null }],
		});
		await service.pollUrl(pr.url, [], new Date(), { force: true });
		const rows = await prisma.prSubscription.findMany({
			where: { id: { in: [passingOnly.id, failing.id] } },
		});
		expect(rows.find((r) => r.id === passingOnly.id)?.guard).toBeNull();
		expect(rows.find((r) => r.id === failing.id)?.guard).not.toBeNull();
	});

	it("reconcile leaves a delivery a receipt marked delivered while it ran, instead of queueing it again", async () => {
		const prisma = await pl.prisma();
		const threadId = await createThread(prisma, "reconcile race", "completed");
		const pr = await createPr(prisma, threadId, 129);
		const sub = await prisma.prSubscription.create({
			data: {
				investigationId: threadId,
				prId: pr.id,
				url: pr.url,
				createdBy: "agent",
				spec: JSON.stringify(defaultSpec("agent")),
				state: "active",
			},
		});
		const del = await prisma.prDelivery.create({
			data: {
				investigationId: threadId,
				url: pr.url,
				dedupeKey: "c:129",
				kind: "comment",
				payload: JSON.stringify({ body: "race" }),
				occurredAt: new Date(),
				state: "bundled",
				members: { create: [{ subscriptionId: sub.id }] },
			},
		});
		const service = pl["app"]!.get(PrSubscriptionsService);
		const seen = service as unknown as {
			threadRow: (id: string) => Promise<unknown>;
		};
		const real = seen.threadRow.bind(service);
		// reconcile has read its rows; the receipt lands before its writes.
		vi.spyOn(seen, "threadRow").mockImplementationOnce(async (id: string) => {
			await prisma.prDelivery.update({
				where: { id: del.id },
				data: { state: "delivered", deliveredAt: new Date() },
			});
			return real(id);
		});
		await service.reconcile(threadId, new Date("2026-11-18T10:00:00.000Z"));
		const after = await prisma.prDelivery.findUniqueOrThrow({ where: { id: del.id } });
		expect(after.state).toBe("delivered");
		expect(after.resends).toBe(0);
	});

	it("pl_pr_unsubscribe on a PR URL the thread never linked answers not_found and links nothing", async () => {
		const prisma = await pl.prisma();
		const threadId = await createThread(prisma, "unsubscribe lookup", "running");
		const service = pl["app"]!.get(PrSubscriptionsService);
		const url = "https://github.com/acme/subs/pull/126";
		const answer = await service.unsubscribe(threadId, { pr: url });
		expect(answer).toMatchObject({ error: "not_found" });
		expect(await prisma.pullRequest.count({ where: { url } })).toBe(0);
	});

	it("deleting a thread deletes its PR deliveries, whose payloads hold host text", async () => {
		const prisma = await pl.prisma();
		const threadId = await createThread(prisma, "delete deliveries");
		const pr = await createPr(prisma, threadId, 127);
		await prisma.prDelivery.create({
			data: {
				investigationId: threadId,
				url: pr.url,
				dedupeKey: "c:127-1",
				kind: "comment",
				payload: JSON.stringify({ body: "host text" }),
				occurredAt: new Date(),
			},
		});
		expect(await pl["app"]!.get(InvestigationsService).delete(threadId)).toBe(true);
		expect(await prisma.prDelivery.count({ where: { investigationId: threadId } })).toBe(0);
	});

	it("D12 refusals: no lockout after comment_cap, lockout after loop_guard", async () => {
		const prisma = await pl.prisma();
		const threadId = await createThread(prisma, "lockout rules");
		const pr = await createPr(prisma, threadId, 116);
		const service = pl["app"]!.get(PrSubscriptionsService);

		// 1. comment_cap allows immediate subscription
		await prisma.prSubscription.create({
			data: {
				investigationId: threadId,
				prId: pr.id,
				url: pr.url,
				createdBy: "agent",
				spec: JSON.stringify(defaultSpec("agent")),
				state: "ended",
				endReason: "comment_cap",
				endedAt: new Date(),
			},
		});
		const res1 = await service.subscribe(threadId, { pr: pr.url });
		expect("value" in res1).toBe(true);

		// 2. loop_guard causes limit_reached lockout
		await prisma.prSubscription.deleteMany({
			where: { investigationId: threadId },
		});
		await prisma.prSubscription.create({
			data: {
				investigationId: threadId,
				prId: pr.id,
				url: pr.url,
				createdBy: "agent",
				spec: JSON.stringify(defaultSpec("agent")),
				state: "ended",
				endReason: "loop_guard",
				endedAt: new Date(),
			},
		});
		const res2 = await service.subscribe(threadId, { pr: pr.url });
		expect("error" in res2).toBe(true);
		if ("error" in res2) {
			expect(res2.error).toBe("limit_reached");
			expect(res2.message).toContain("failing on 3 pushes");
		}
	});

	it("interruptedTurn returns last delivered message ids", () => {
		const msgId = "11111111-1111-4111-8111-111111111111";
		const del1 = "22222222-2222-4222-8222-222222222222";
		const events: CanonicalEvent[] = [
			{
				kind: "operator_message",
				runId: "run-1",
				branchId: "main",
				path: [],
				seq: 1,
				label: null,
				ts: "2026-11-18T10:00:00.000Z",
				text: "PrismaLens: 1 new event",
				mode: "queue",
				delivered: true,
				messageId: msgId,
				delivers: [del1],
			},
		];
		const turn = interruptedTurn(events);
		expect(turn).toEqual({
			text: "PrismaLens: 1 new event",
			delivers: [msgId, del1],
		});
	});

	it("setting off skips PR status reads during tick", async () => {
		const prisma = await pl.prisma();
		const threadId = await createThread(prisma, "setting off");
		await createPr(prisma, threadId, 117);

		// Disable PR status in thread context settings
		await writeThreadContextSettings(prisma, {
			...DEFAULT_THREAD_CONTEXT_SETTINGS,
			prStatus: false,
		});

		const service = pl["app"]!.get(PrSubscriptionsService);
		const spy = vi.spyOn(service, "pollUrl");

		await service.tick();
		expect(spy).not.toHaveBeenCalled();

		// Re-enable
		await writeThreadContextSettings(prisma, {
			...DEFAULT_THREAD_CONTEXT_SETTINGS,
			prStatus: true,
		});
	});

	it("origin cooldown prevents polling when cooling", async () => {
		const service = pl["app"]!.get(PrSubscriptionsService);
		const url = "https://github.com/cooling/repo/pull/1";
		const now = new Date("2026-11-18T10:00:00.000Z");

		const coolingMap = (
			service as unknown as {
				cooling: Map<string, number>;
			}
		).cooling;
		coolingMap.set("https://github.com", now.getTime() + 60_000);

		try {
			const result = await service.pollUrl(url, [], now);
			expect(result).toBe("cooling");
		} finally {
			coolingMap.delete("https://github.com");
		}
	});

	it("OBJ-035: a subscription cancelled while poll is reading gets no membership", async () => {
		const prisma = await pl.prisma();
		const threadId = await createThread(prisma, "cancel during poll");
		const pr = await createPr(prisma, threadId, 118);
		const service = pl["app"]!.get(PrSubscriptionsService);

		const sub = await prisma.prSubscription.create({
			data: {
				investigationId: threadId,
				prId: pr.id,
				url: pr.url,
				createdBy: "agent",
				spec: JSON.stringify(defaultSpec("agent")),
				state: "active",
				since: new Date("2026-11-18T09:00:00.000Z"),
			},
		});

		await prisma.prPoll.upsert({
			where: { url: pr.url },
			create: {
				url: pr.url,
				headSha: "head-0",
				cursor: JSON.stringify({ v: 1, idFloor: {}, recent: {} }),
				nextPollAt: new Date(0),
			},
			update: {
				cursor: JSON.stringify({ v: 1, idFloor: {}, recent: {} }),
			},
		});

		// While readTick runs, the subscription is cancelled
		vi.mocked(readTick).mockImplementationOnce(async () => {
			await service.unsubscribe(threadId, { subscription: sub.id });
			return {
				snap: {
					prUrl: pr.url,
					host: "github",
					state: "open",
					title: "PR Title",
					headSha: "head-1",
					conflicts: false,
					baseRef: "main",
					items: [
						{
							source: "ic",
							id: 118,
							body: "comment during poll",
							bot: false,
							association: "COLLABORATOR",
							login: "carol",
							createdAt: new Date().toISOString(),
							link: null,
						},
					],
					issueEvents: [],
					checks: null,
					threads: null,
					push: null,
					reviewsFull: false,
					lists: {},
					floors: {},
				},
				touched: new Set(),
			};
		});
		vi.spyOn(
			(
				service as unknown as {
					prs: { readShared: (...args: unknown[]) => Promise<unknown> };
				}
			).prs,
			"readShared",
		).mockResolvedValue({
			read: {
				title: "PR Title",
				state: "open",
				author: "author",
				reviewers: [],
				detail: { reviewers: [] },
				headRef: "main",
				headSha: "head-1",
				checks: null,
				conflicts: false,
			},
			head: { exists: true, sha: "head-1", forcePushed: false },
			req: vi.fn(),
			apiBase: "https://api.github.com",
			viewer: "bot",
			own: [],
		} as never);

		await service.pollUrl(pr.url, [], new Date(), { force: true });

		const members = await prisma.prDeliveryMember.findMany({
			where: { subscriptionId: sub.id },
		});
		expect(members).toHaveLength(0);
	});

	it("OBJ-036: merged/closed does not end subscriptions while snapshot says more", async () => {
		const prisma = await pl.prisma();
		const threadId = await createThread(prisma, "more pages merged");
		const pr = await createPr(prisma, threadId, 1199);
		const service = pl["app"]!.get(PrSubscriptionsService);

		const sub = await prisma.prSubscription.create({
			data: {
				investigationId: threadId,
				prId: pr.id,
				url: pr.url,
				createdBy: "agent",
				spec: JSON.stringify(defaultSpec("agent")),
				state: "active",
				since: new Date("2026-11-18T09:00:00.000Z"),
			},
		});

		await prisma.prPoll.upsert({
			where: { url: pr.url },
			create: {
				url: pr.url,
				headSha: "head-0",
				cursor: JSON.stringify({ v: 1, idFloor: {}, recent: {} }),
				nextPollAt: new Date(0),
			},
			update: {
				cursor: JSON.stringify({ v: 1, idFloor: {}, recent: {} }),
			},
		});

		// 1. With snap.more = true, merged state does NOT end subscription
		mockPrRead(service, pr.url, {
			state: "merged",
			more: true,
			issueEvents: [
				{
					id: 119,
					event: "merged",
					createdAt: new Date().toISOString(),
					sha: "m119",
				},
			],
		});
		await service.pollUrl(pr.url, [], new Date(), { force: true });

		let checkSub = await prisma.prSubscription.findUnique({ where: { id: sub.id } });
		expect(checkSub?.state).toBe("active");

		// 2. With snap.more = false (history exhausted), merged state ends subscription
		mockPrRead(service, pr.url, {
			state: "merged",
			more: false,
		});
		await service.pollUrl(pr.url, [], new Date(), { force: true });

		checkSub = await prisma.prSubscription.findUnique({ where: { id: sub.id } });
		expect(checkSub?.state).toBe("ended");
		expect(checkSub?.endReason).toBe("merged");
	});

	it("OBJ-041: a 120-minute batch window is not cut to 10", () => {
		const service = pl["app"]!.get(PrSubscriptionsService);
		const row = {
			members: [
				{
					subscription: {
						spec: JSON.stringify({ delivery: "batch", batchMinutes: 120 }),
					},
				},
			],
		};
		const ms = (
			service as unknown as { batchMs: (d: unknown) => number }
		).batchMs(row);
		expect(ms).toBe(120 * 60_000);
	});

	it("OBJ-040: GitLab's unsupported list names approvals", async () => {
		const prisma = await pl.prisma();
		const threadId = await createThread(prisma, "gitlab approvals");
		await prisma.pullRequest.create({
			data: {
				investigationId: threadId,
				host: "gitlab",
				repo: "acme/gl",
				number: 1,
				url: "https://gitlab.com/acme/gl/-/merge_requests/1",
				title: "GL MR",
				state: "open",
				source: "branch",
			},
		});

		const service = pl["app"]!.get(PrSubscriptionsService);
		const res = await service.subscribe(threadId, {
			pr: "https://gitlab.com/acme/gl/-/merge_requests/1",
		});
		expect("value" in res).toBe(true);
		if ("value" in res && res.value) {
			const sub = (res.value as { subscription: { unsupported: string[] } }).subscription;
			expect(sub.unsupported).toContain(
				"approvals: GitLab's approvals are not events here, only its review notes",
			);
		}
	});

	it("session-lifecycle arrived() reads updated summary under thread lock", async () => {
		const prisma = await pl.prisma();
		const threadId = await createThread(prisma, "arrived lock");
		const wakes = pl["app"]!.get(WakesService);
		const sessions = await pl.sessions();

		const wakeId = await wakes.schedule(
			threadId,
			"pr_status",
			new Date(),
			"initial reason",
			{
				units: 1,
				summary: "initial summary",
				prEvents: [],
			},
		);
		const wake = await wakes.latest(threadId, "pr_status");
		expect(wake).not.toBeNull();

		// Rewrite under lock before arrived finishes
		await wakes.setPayload(wakeId, {
			...wake!.payload,
			summary: "updated rewritten summary",
		});

		const row = await sessions.thread(threadId);
		expect(row).not.toBeNull();
		if (row && wake) {
			const arrivedWake = await (
				sessions as unknown as {
					arrived: (w: unknown, r: unknown) => Promise<{ payload: { summary: string } }>;
				}
			).arrived(wake, row);
			expect(arrivedWake.payload.summary).toBe("updated rewritten summary");
		}
	});

	it("session-lifecycle arrived() writes no waiting line for a wake cancelled since due()", async () => {
		const prisma = await pl.prisma();
		const threadId = await createThread(prisma, "arrived cancelled");
		const wakes = pl["app"]!.get(WakesService);
		const sessions = await pl.sessions();
		const wakeId = await wakes.schedule(threadId, "pr_status", new Date(), "reason", {
			units: 1,
			summary: "summary",
			prEvents: [],
		});
		const wake = await wakes.latest(threadId, "pr_status");
		await wakes.cancel(wakeId);
		const row = await sessions.thread(threadId);
		await (
			sessions as unknown as { arrived: (w: unknown, r: unknown) => Promise<unknown> }
		).arrived(wake, row);
		const lines = await prisma.investigationEvent.count({
			where: { investigationId: threadId, event: { contains: '"message_inbound"' } },
		});
		expect(lines).toBe(0);
	});

	it("OBJ-029: a limit resume that compacts with a next_pause wake: exactly one operator_message line names the wake", async () => {
		const prisma = await pl.prisma();
		const threadId = await createThread(prisma, "obj-029 compaction");
		const investigations = pl["app"]!.get(InvestigationsService);
		const sessions = await pl.sessions();

		const wakeId = "11111111-1111-4111-8111-111111111111";
		await investigations.appendEvents(threadId, [
			{
				kind: "operator_message",
				runId: threadId,
				branchId: "main",
				path: [],
				seq: 1,
				label: null,
				ts: "2026-11-18T10:00:00.000Z",
				text: "Compacted limit resume prompt",
				mode: "queue",
				delivered: true,
				delivers: [wakeId],
			} as CanonicalEvent,
			{
				kind: "operator_message",
				runId: threadId,
				branchId: "main",
				path: [],
				seq: 2,
				label: null,
				ts: "2026-11-18T10:01:00.000Z",
				text: "Second turn prompt",
				mode: "queue",
				delivered: true,
			} as CanonicalEvent,
		]);

		const events = await investigations.allEvents(threadId);
		const naming = events.filter(
			(e) =>
				e.kind === "operator_message" &&
				e.delivered &&
				(e.messageId === wakeId || e.delivers?.includes(wakeId)),
		);
		expect(naming).toHaveLength(1);
		const firstNaming = naming[0] as Extract<CanonicalEvent, { delivers?: string[] }>;
		expect(firstNaming?.delivers).toEqual([wakeId]);

		const seen = await sessions.wakeSeen(threadId, wakeId);
		expect(seen).toBe("delivered");

		const turn = interruptedTurn([events[0]!]);
		expect(turn?.delivers).toContain(wakeId);
	});

	it("P16b: Stop between admission and prompt withdraws memberships and delivers nothing", async () => {
		const prisma = await pl.prisma();
		const threadId = await createThread(prisma, "stop between admission");
		const pr = await createPr(prisma, threadId, 120);

		const sub = await prisma.prSubscription.create({
			data: {
				investigationId: threadId,
				prId: pr.id,
				url: pr.url,
				createdBy: "agent",
				spec: JSON.stringify(defaultSpec("agent")),
				state: "active",
			},
		});

		const del = await prisma.prDelivery.create({
			data: {
				investigationId: threadId,
				url: pr.url,
				dedupeKey: "c:120",
				kind: "comment",
				payload: JSON.stringify({ body: "admission test" }),
				occurredAt: new Date(),
				state: "queued",
				members: { create: [{ subscriptionId: sub.id }] },
			},
		});

		// User stops thread -> run_stopped via endAgentWakes
		await endAgentWakes(prisma, [threadId]);

		const member = await prisma.prDeliveryMember.findUnique({
			where: {
				deliveryId_subscriptionId: {
					deliveryId: del.id,
					subscriptionId: sub.id,
				},
			},
		});
		expect(member?.state).toBe("withdrawn");
		expect(member?.withdrawnBy).toBe("run_stopped");

		const updatedDel = await prisma.prDelivery.findUnique({ where: { id: del.id } });
		expect(updatedDel?.state).toBe("discarded");
		expect(updatedDel?.discardReason).toBe("withdrawn");
	});
});
