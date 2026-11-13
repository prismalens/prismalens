// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import type { CanonicalEvent, PendingAsk } from "@prismalens/contracts";
import { isFailure, type ToolOutcome } from "@prismalens/integrations/harness";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AsksPort, ClosedAsk, OpenAsk } from "../asks/asks.contract.js";

const env = await vi.hoisted(async () => {
	const fs = await import("node:fs");
	const os = await import("node:os");
	const path = await import("node:path");
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pl-tree-"));
	process.env.PRISMALENS_WORKSPACE_DIR = path.join(root, "data");
	return { root };
});

const { PrismaService } = await import("../../core/prisma/prisma.service.js");
const { PendingActionsService } = await import("./pending-actions.service.js");
const { ThreadTreeService } = await import("./thread-tree.service.js");
const { ProposalsService } = await import("./proposals.service.js");
const { TreeIo } = await import("./tree-io.service.js");
const { TreeSettings } = await import("./tree-settings.service.js");
const { actionReason } = await import("../threads/threads.service.js");
const { nodeState, threadLink } = await import("./thread-tree.service.js");
const { FollowUpRefused } = await import("../../infrastructure/dispatch/dispatch.service.js");
const { InboxService } = await import("../wakes/inbox.service.js");

type Prisma = InstanceType<typeof PrismaService>;
let prisma: Prisma;

/** The asks seat as surface A defines it, in memory. */
class FakeAsks implements AsksPort {
	asks = new Map<string, { ask: PendingAsk; closed: ClosedAsk | null }>();
	handlers = new Map<string, (c: ClosedAsk) => void>();
	async open(threadId: string, ask: OpenAsk): Promise<string> {
		const askId = randomUUID();
		this.asks.set(askId, {
			ask: { ...ask, askId, threadId, openedAt: new Date().toISOString() } as PendingAsk,
			closed: null,
		});
		return askId;
	}
	async answer(_t: string, askId: string, answer: ClosedAsk["answer"]): Promise<ClosedAsk> {
		const closed = this.closeQuietly(askId, answer);
		this.handlers.get(askId)?.(closed);
		return closed;
	}
	/** Closes the ask without telling the gate, as if PrismaLens was down when it closed. */
	closeQuietly(askId: string, answer: ClosedAsk["answer"]): ClosedAsk {
		const got = this.asks.get(askId);
		if (!got || got.closed) throw new Error("conflict");
		const closed: ClosedAsk = {
			ask: got.ask,
			outcome: "answered",
			...(answer ? { answer } : {}),
			closedAt: new Date().toISOString(),
		};
		got.closed = closed;
		return closed;
	}
	async close(askId: string, outcome: "stopped" | "expired"): Promise<ClosedAsk | null> {
		const got = this.asks.get(askId);
		if (!got) return null;
		if (got.closed) return got.closed;
		got.closed = { ask: got.ask, outcome, closedAt: new Date().toISOString() };
		this.handlers.get(askId)?.(got.closed);
		return got.closed;
	}
	async pending(threadId: string) {
		return [...this.asks.values()].filter((a) => !a.closed && a.ask.threadId === threadId).map((a) => a.ask);
	}
	async get(askId: string) {
		return this.asks.get(askId) ?? null;
	}
	onClosed(askId: string, handler: (c: ClosedAsk) => void) {
		this.handlers.set(askId, handler);
		return () => this.handlers.delete(askId);
	}
	/** Answers and waits for the gate's handler to finish. */
	async decide(askId: string, decision: "approve" | "deny", scope?: "once" | "tree") {
		// Quiet, then awaited: the test reads the outcome once the gate has acted on it.
		const closed = this.closeQuietly(askId, { kind: "permission", decision, ...(scope ? { scope } : {}) });
		const actions = (globalThis as { __actions?: InstanceType<typeof PendingActionsService> }).__actions;
		await actions?.closed(closed);
	}
}

/** What the run side did: messages to live runs, reopened sessions, stops. */
const sent: { id: string; text: string; mode: string }[] = [];
const resumed: { id: string; text: string }[] = [];
let live = new Set<string>();

const dispatch = {
	sendMessage: vi.fn((id: string, text: string, mode: string) => {
		if (!live.has(id)) return null;
		sent.push({ id, text, mode });
		return "queued";
	}),
	resumeInvestigation: vi.fn(async (id: string, text: string) => {
		resumed.push({ id, text });
		await prisma.investigation.update({ where: { id }, data: { status: "pending" } });
		return true;
	}),
	cancelPendingJob: vi.fn(async () => true),
	requestCancel: vi.fn(async () => 1),
	cancelOrphanedRun: vi.fn(async () => true),
};

const investigations = {
	lastEventSeq: async (id: string) =>
		(await prisma.investigationEvent.aggregate({ where: { investigationId: id }, _max: { seq: true } }))._max.seq ?? -1,
	appendEvents: async (id: string, events: CanonicalEvent[]) => {
		for (const e of events)
			await prisma.investigationEvent.create({
				data: { investigationId: id, seq: e.seq, branchId: "branchId" in e ? e.branchId : "__report__", event: JSON.stringify(e) },
			});
		return { inserted: events.length, duplicates: 0 };
	},
	cancelPending: vi.fn(async (id: string) =>
		prisma.investigation.update({ where: { id }, data: { status: "cancelled", completedAt: new Date() } }),
	),
	markStopRequested: vi.fn(async () => {}),
};

/** ThreadsService.start as far as starting sees it: one row, marked with who started it. */
const starts: { input: Record<string, unknown>; tree: Record<string, unknown>; pinned?: string }[] = [];
const threads = {
	start: vi.fn(async (input: Record<string, unknown>, tree: { parentId: string; rootId: string | null; role: string | null; depth: number; title: string; actionId: string; at?: (r: { url: string }) => string | undefined }) => {
		starts.push({ input, tree, pinned: tree.at?.({ url: "repo-url" }) });
		const subject = input.subject as { kind: string; repositoryId?: string; serviceId?: string };
		const row = await prisma.investigation.create({
			data: {
				status: "pending",
				kind: "chat",
				title: tree.title,
				triggerReason: actionReason(tree.actionId),
				parentId: tree.parentId,
				rootId: tree.rootId,
				role: tree.role,
				depth: tree.depth,
				accessLevel: (input.accessLevel as string) ?? null,
				...(subject.kind === "service" ? { serviceId: subject.serviceId } : {}),
				...(subject.kind === "project" ? { repositoryId: subject.repositoryId } : {}),
			},
		});
		return { investigationId: row.id, jobId: "j", queued: true };
	}),
};

const relay = { isActive: () => false, emit: vi.fn() };

let asks: FakeAsks;
let actions: InstanceType<typeof PendingActionsService>;
let tree: InstanceType<typeof ThreadTreeService>;
let settings: InstanceType<typeof TreeSettings>;

function build() {
	settings = new TreeSettings(prisma);
	const io = new TreeIo(prisma, dispatch as never, investigations as never, relay as never);
	actions = new PendingActionsService(prisma, settings, io, asks);
	(globalThis as { __actions?: unknown }).__actions = actions;
	tree = new ThreadTreeService(prisma, threads as never, dispatch as never, investigations as never, settings, actions, io);
	return { io };
}

const start = (callerId: string, over: Record<string, unknown> = {}) => {
	const args = {
		title: "Check the db",
		brief: "Find why the db pool is exhausted; return the cause.",
		workspace: { kind: "same_project_fresh" },
		requestId: randomUUID(),
		...over,
	};
	return actions.gate({ callerId, rootId: callerId, tool: "pl_thread_start", args, requestId: args.requestId as string });
};

/** The gate as the gateway calls it: keyed by where the caller's start chain began. */
async function startIn(callerId: string, over: Record<string, unknown> = {}) {
	const l = await tree.links(callerId);
	const args = {
		title: "Check the db",
		brief: "Find why the db pool is exhausted; return the cause.",
		workspace: { kind: "same_project_fresh" },
		requestId: randomUUID(),
		...over,
	};
	return actions.gate({ callerId, rootId: l?.chainId ?? callerId, tool: "pl_thread_start", args, requestId: args.requestId as string });
}

const value = (o: ToolOutcome) => {
	if (isFailure(o)) throw new Error(`failed: ${JSON.stringify(o.failure)}`);
	return o.value as Record<string, unknown>;
};

async function thread(data: Record<string, unknown> = {}) {
	return prisma.investigation.create({ data: { status: "running", kind: "chat", title: "root", accessLevel: "auto", ...data } });
}

async function events(id: string) {
	const rows = await prisma.investigationEvent.findMany({ where: { investigationId: id }, orderBy: { seq: "asc" } });
	return rows.map((r) => JSON.parse(r.event) as CanonicalEvent);
}

beforeAll(async () => {
	const { resolveMigrationsDir, runMigrations } = await import("@prismalens/database/migrator");
	await runMigrations({ migrationsDir: resolveMigrationsDir(), log: () => {} });
	prisma = new PrismaService();
	await prisma.$connect();
});

afterAll(async () => {
	await prisma?.$disconnect();
	rmSync(env.root, { recursive: true, force: true });
});

beforeEach(async () => {
	for (const m of ["threadMessage", "pendingAction", "treeAllowance", "proposal", "investigationEvent", "setting"] as const)
		await (prisma[m] as unknown as { deleteMany: () => Promise<unknown> }).deleteMany();
	await prisma.investigation.updateMany({ data: { parentId: null } });
	await prisma.investigation.deleteMany();
	sent.length = 0;
	resumed.length = 0;
	starts.length = 0;
	live = new Set();
	vi.clearAllMocks();
	asks = new FakeAsks();
	build();
});

describe("pl_thread_start behind the host's approval (#1024 spec F)", () => {
	it("Given Allow within limits, Then it starts a sibling at once, marks who started it, and the brief opens with the starter (#1101 cat 10, 2cc93e1ad)", async () => {
		await settings.set({ agentsStartThreads: "allow", depth: 2, children: 4, perTree: 10, turnsPerDay: 200 });
		const root = await thread();
		const v = value(await start(root.id));
		expect(v).toMatchObject({ status: "started", link: `/threads/${v.id}` });
		const made = await prisma.investigation.findUniqueOrThrow({ where: { id: v.id as string } });
		expect(made).toMatchObject({ parentId: root.id, rootId: root.id, role: null, depth: 1 });
		// The starter is not made a tree root: nothing on it changes.
		expect((await prisma.investigation.findUniqueOrThrow({ where: { id: root.id } })).rootId).toBeNull();
		expect((await events(root.id)).map((e) => e.kind)).toEqual(["thread_started"]);
		expect(starts[0]?.input.text).toBe(
			`Started by root (/threads/${root.id}). If the brief asks you to report back, message it with pl_thread_send. Nothing is sent on your behalf.\n\nFind why the db pool is exhausted; return the cause.`,
		);
	});
	it("Given the same requestId twice, Then one thread starts and the retry gets the same answer", async () => {
		await settings.set({ agentsStartThreads: "allow", depth: 2, children: 4, perTree: 10, turnsPerDay: 200 });
		const root = await thread();
		const a = value(await start(root.id, { requestId: "r1" }));
		const b = value(await start(root.id, { requestId: "r1" }));
		expect(b.id).toBe(a.id);
		expect(starts).toHaveLength(1);
	});

	it("Given an incident's thread, Then its child is about the incident's service, never the incident", async () => {
		await settings.set({ agentsStartThreads: "allow", depth: 2, children: 4, perTree: 10, turnsPerDay: 200 });
		const service = await prisma.service.create({ data: { name: `svc-${randomUUID()}` } });
		const incident = await prisma.incident.create({
			data: { number: Math.floor(Math.random() * 1e6), title: "boom", severity: "high", serviceId: service.id },
		});
		const root = await thread({ incidentId: incident.id, kind: "investigation" });
		const v = value(await start(root.id));
		expect(starts[0]?.input.subject).toEqual({ kind: "service", serviceId: service.id });
		const child = await prisma.investigation.findUniqueOrThrow({ where: { id: v.id as string } });
		expect(child.incidentId).toBeNull();
		await prisma.investigation.deleteMany({ where: { incidentId: incident.id } });
		await prisma.incident.delete({ where: { id: incident.id } });
	});

	it("Given a wider access than the parent's, Then the child is clamped to the parent's and told so", async () => {
		await settings.set({ agentsStartThreads: "allow", depth: 2, children: 4, perTree: 10, turnsPerDay: 200 });
		const root = await thread({ accessLevel: "auto-edits" });
		const v = value(await start(root.id, { access: "full-access" }));
		expect(v.access).toBe("auto-edits");
		expect(v.note).toMatch(/clamped/);
		expect(starts[0]?.input.accessLevel).toBe("auto-edits");
	});

	it("Given each cap, Then the start refuses with limit_reached and names its Settings row, and a started thread may start its own (#1101 cat 10, 2cc93e1ad)", async () => {
		await settings.set({ agentsStartThreads: "allow", depth: 1, children: 1, perTree: 3, turnsPerDay: 200 });
		const root = await thread();
		const first = value(await startIn(root.id));
		const perStarter = await startIn(root.id);
		expect(isFailure(perStarter) && perStarter.failure).toMatchObject({ error: "limit_reached", next: expect.stringContaining("At once per starter") });
		// No chain limit: the started thread starts one of its own.
		value(await startIn(first.id as string));
		await settings.set({ agentsStartThreads: "allow", depth: 1, children: 5, perTree: 2, turnsPerDay: 200 });
		const total = await startIn((await thread()).id);
		expect(isFailure(total) && total.failure).toMatchObject({ error: "limit_reached", next: expect.stringContaining("At once in total") });
	});
	it("Given Never, Then it refuses as disabled", async () => {
		await settings.set({ agentsStartThreads: "never", depth: 2, children: 4, perTree: 10, turnsPerDay: 200 });
		const root = await thread();
		const r = await start(root.id);
		expect(isFailure(r) && r.failure.error).toBe("disabled");
	});

	it("Given Ask each time, Then it answers pending_approval and opens one host-only card from the tool", async () => {
		const root = await thread();
		const v = value(await start(root.id, { requestId: "r1" }));
		expect(v).toMatchObject({ status: "pending_approval", next: expect.stringContaining("Do not poll") });
		const [open] = await asks.pending(root.id);
		expect(open).toMatchObject({ requiresHost: true, source: { kind: "tool", tool: "pl_thread_start", requestId: "r1" }, kind: "permission" });
		expect(starts).toHaveLength(0);
		// A retry while it waits opens no second card.
		value(await start(root.id, { requestId: "r1" }));
		expect(await asks.pending(root.id)).toHaveLength(1);
	});

	it("Given an approval, Then the thread starts and the caller hears its link at its next pause", async () => {
		const root = await thread();
		live.add(root.id);
		value(await start(root.id, { requestId: "r1" }));
		const [open] = await asks.pending(root.id);
		await asks.decide(open?.askId as string, "approve");
		expect(starts).toHaveLength(1);
		expect(sent.find((m) => m.id === root.id)?.text).toMatch(/pl_thread_start call \(requestId "r1"\) was approved: started \/threads\/[0-9a-f-]+\. Nothing comes back by itself/);
		const row = await prisma.pendingAction.findFirstOrThrow();
		expect(row).toMatchObject({ state: "done" });
		expect(row.deliveredAt).not.toBeNull();
	});

	it("Given a denial, Then nothing starts and the agent is told as a message", async () => {
		const root = await thread();
		live.add(root.id);
		value(await start(root.id));
		const [open] = await asks.pending(root.id);
		await asks.decide(open?.askId as string, "deny");
		expect(starts).toHaveLength(0);
		expect(sent[0]?.text).toMatch(/was denied by the user/);
	});

	it("Given an ended caller, Then the outcome reopens its session", async () => {
		const root = await thread({ status: "completed" });
		value(await start(root.id));
		const [open] = await asks.pending(root.id);
		await asks.decide(open?.askId as string, "approve");
		expect(resumed[0]?.id).toBe(root.id);
	});

	it("Given Allow for threads started from here, Then later starts in the chain run at once, until it is revoked", async () => {
		const root = await thread();
		value(await start(root.id));
		const [open] = await asks.pending(root.id);
		await asks.decide(open?.askId as string, "approve", "tree");
		expect(await prisma.treeAllowance.findUnique({ where: { rootId: root.id } })).not.toBeNull();
		const second = value(await startIn(root.id));
		expect(second.status).toBe("started");
		await tree.revokeAllowance(root.id);
		expect(value(await startIn(root.id)).status).toBe("pending_approval");
	});

	it("Given a restart between approval and execution, Then boot runs it once", async () => {
		const root = await thread();
		value(await start(root.id));
		const row = await prisma.pendingAction.findFirstOrThrow();
		await prisma.pendingAction.update({ where: { id: row.id }, data: { state: "approved", decidedAt: new Date() } });
		build();
		await actions.resume();
		expect(starts).toHaveLength(1);
		await actions.resume();
		expect(starts).toHaveLength(1);
		expect((await prisma.pendingAction.findFirstOrThrow()).state).toBe("done");
	});

	it("Given a crash after the thread was made, Then running the action again finds that thread", async () => {
		const root = await thread();
		value(await start(root.id));
		const [open] = await asks.pending(root.id);
		await asks.decide(open?.askId as string, "approve");
		const row = await prisma.pendingAction.findFirstOrThrow();
		await prisma.pendingAction.update({ where: { id: row.id }, data: { state: "executing" } });
		// The thread it made fills its own cap slot; the rerun must not refuse on that.
		expect(value(await actions.execute(row.id))).toMatchObject({ status: "started" });
		expect(starts).toHaveLength(1);
		expect((await prisma.pendingAction.findUniqueOrThrow({ where: { id: row.id } })).state).toBe("done");
	});

	it("Given a crash after a stop landed, Then the rerun reports the stop instead of failing", async () => {
		await settings.set({ agentsStartThreads: "allow", depth: 2, children: 4, perTree: 10, turnsPerDay: 200 });
		const root = await thread();
		const made = value(await startIn(root.id)).link as string;
		const stop = { id: made, reason: "replaced", requestId: "stop-1" };
		await prisma.investigation.updateMany({ where: { parentId: root.id }, data: { status: "running" } });
		value(await actions.gate({ callerId: root.id, rootId: root.id, tool: "pl_thread_cancel", args: stop, requestId: "stop-1" }));
		const row = await prisma.pendingAction.findFirstOrThrow({ where: { requestId: "stop-1" } });
		await prisma.investigation.updateMany({ where: { parentId: root.id }, data: { status: "cancelled" } });
		await prisma.pendingAction.update({ where: { id: row.id }, data: { state: "executing" } });
		value(await actions.execute(row.id));
		expect((await prisma.pendingAction.findUniqueOrThrow({ where: { id: row.id } })).state).toBe("done");
	});

	it("Given concurrent starts from one thread, Then its cap still holds", async () => {
		await settings.set({ agentsStartThreads: "allow", depth: 2, children: 1, perTree: 10, turnsPerDay: 200 });
		const root = await thread();
		const outcomes = await Promise.all([1, 2, 3].map(() => startIn(root.id)));
		expect(outcomes.filter((o) => !isFailure(o))).toHaveLength(1);
		expect(outcomes.filter((o) => isFailure(o) && o.failure.error === "limit_reached")).toHaveLength(2);
		expect(await prisma.investigation.count({ where: { parentId: root.id } })).toBe(1);
	});

	it("Given concurrent approvals from one thread, Then the cap holds at execution too", async () => {
		await settings.set({ agentsStartThreads: "ask", depth: 2, children: 1, perTree: 10, turnsPerDay: 200 });
		const root = await thread();
		for (const _ of [1, 2, 3]) value(await start(root.id));
		const cards = await asks.pending(root.id);
		await Promise.all(cards.map((c) => asks.decide(c.askId, "approve")));
		expect(starts).toHaveLength(1);
		expect(await prisma.pendingAction.count({ where: { state: "failed" } })).toBe(2);
	});

	it("Given a duplicate approval, Then one thread starts", async () => {
		const root = await thread();
		value(await start(root.id));
		const [open] = await asks.pending(root.id);
		await asks.decide(open?.askId as string, "approve");
		const closed = (await asks.get(open?.askId as string))?.closed as ClosedAsk;
		await actions.closed(closed);
		expect(starts).toHaveLength(1);
	});

	it("Given an ask closed while PrismaLens was down, Then boot reads it and acts", async () => {
		const root = await thread();
		value(await start(root.id));
		const [open] = await asks.pending(root.id);
		asks.closeQuietly(open?.askId as string, { kind: "permission", decision: "approve" });
		build();
		await actions.resume();
		expect(starts).toHaveLength(1);
	});

	it("Given the caller cancelled before approval, Then its action is cancelled and a late approval starts nothing", async () => {
		const root = await thread();
		value(await start(root.id));
		const [open] = await asks.pending(root.id);
		await prisma.investigation.update({ where: { id: root.id }, data: { status: "cancelled" } });
		await tree.tick();
		expect((await prisma.pendingAction.findFirstOrThrow()).state).toBe("cancelled");
		// Its card is closed too, so nobody can approve it late.
		expect((await asks.get(open?.askId as string))?.closed?.outcome).toBe("stopped");
		await expect(asks.decide(open?.askId as string, "approve")).rejects.toThrow(/conflict/);
		expect(starts).toHaveLength(0);
	});

	it("Given the setting switched to Never before approval, Then the approved action fails as disabled", async () => {
		const root = await thread();
		live.add(root.id);
		value(await start(root.id));
		const [open] = await asks.pending(root.id);
		await settings.set({ agentsStartThreads: "never", depth: 2, children: 4, perTree: 10, turnsPerDay: 200 });
		await asks.decide(open?.askId as string, "approve");
		expect(starts).toHaveLength(0);
		expect((await prisma.pendingAction.findFirstOrThrow()).state).toBe("failed");
		expect(sent[0]?.text).toMatch(/did not run: The user turned off starting threads/);
	});

	it("Given a cap filled before approval, Then the approved action fails with limit_reached", async () => {
		await settings.set({ agentsStartThreads: "ask", depth: 2, children: 1, perTree: 10, turnsPerDay: 200 });
		const root = await thread();
		value(await start(root.id, {}));
		value(await start(root.id, {}));
		const [first, second] = await asks.pending(root.id);
		await asks.decide(first?.askId as string, "approve");
		await asks.decide(second?.askId as string, "approve");
		expect(starts).toHaveLength(1);
		const failed = await prisma.pendingAction.findFirstOrThrow({ where: { state: "failed" } });
		expect(JSON.parse(failed.result as string).failure.error).toBe("limit_reached");
	});

	it("Given no asks seat, Then Ask each time refuses instead of hanging", async () => {
		const root = await thread();
		const io = new TreeIo(prisma, dispatch as never, investigations as never, relay as never);
		actions = new PendingActionsService(prisma, settings, io);
		tree = new ThreadTreeService(prisma, threads as never, dispatch as never, investigations as never, settings, actions, io);
		const r = await start(root.id);
		expect(isFailure(r) && r.failure.error).toBe("disabled");
	});
});

describe("messages between sibling threads (#1101 cat 10, 2cc93e1ad)", () => {
	async function family() {
		await settings.set({ agentsStartThreads: "allow", depth: 2, children: 4, perTree: 10, turnsPerDay: 200 });
		const root = await thread();
		const api = value(await start(root.id, { title: "api" })).id as string;
		const db = value(await start(root.id, { title: "db" })).id as string;
		await prisma.threadMessage.deleteMany();
		return { root: root.id, api, db };
	}
	const msg = (to: string, text: string, requestId: string, mode: "queue" | "steer" = "queue") => ({ to, text, mode, requestId });

	it("delivers a report to `starter` at its next pause, records both ends by title, and never twice for one requestId", async () => {
		const f = await family();
		live.add(f.root);
		const r = value(await tree.send(f.api, msg("starter", "the pool is 10", "m1")));
		expect(r).toMatchObject({ status: "delivered", link: `/threads/${f.root}` });
		expect(sent.at(-1)).toEqual({ id: f.root, text: `[Message from api (/threads/${f.api})] the pool is 10`, mode: "queue" });
		value(await tree.send(f.api, msg("starter", "the pool is 10", "m1")));
		expect(await prisma.threadMessage.count()).toBe(1);
		expect((await prisma.threadMessage.findFirstOrThrow()).type).toBe("message");
		const sentEv = (await events(f.api)).find((e) => e.kind === "thread_message");
		const gotEv = (await events(f.root)).find((e) => e.kind === "thread_message");
		expect(sentEv).toMatchObject({ direction: "sent", peerTitle: "root", peerLink: `/threads/${f.root}`, type: "message", text: "the pool is 10" });
		expect(gotEv).toMatchObject({ direction: "received", peerTitle: "api", peerLink: `/threads/${f.api}`, messageId: expect.any(String) });
	});

	it("reopens an idle receiver, as a person's message does, and tells the sender it reopened", async () => {
		const f = await family();
		await prisma.investigation.update({ where: { id: f.root }, data: { status: "completed", completedAt: new Date() } });
		const r = value(await tree.send(f.api, msg(`/threads/${f.root}`, "done: raise the pool to 20", "w1")));
		expect(r.status).toBe("reopened");
		expect(resumed).toEqual([{ id: f.root, text: `[Message from api (/threads/${f.api})] done: raise the pool to 20` }]);
	});

	it("refuses a settled receiver up front, and never reopens one for a message already queued", async () => {
		const f = await family();
		const past = new Date(Date.now() - 60_000);
		await prisma.investigation.update({
			where: { id: f.root },
			data: { status: "completed", completedAt: past, lastActivityAt: past, settledAt: new Date() },
		});
		const r = await tree.send(f.api, msg("starter", "late news", "s1"));
		expect(isFailure(r) && r.failure).toMatchObject({ error: "invalid_input", message: `/threads/${f.root} is settled; a message would stay unread.` });
		await prisma.threadMessage.create({ data: { rootId: f.root, fromId: f.api, toId: f.root, type: "message", text: "queued before", requestId: "q1" } });
		await tree.drain();
		expect(resumed).toEqual([]);
		expect((await prisma.threadMessage.findFirstOrThrow({ where: { requestId: "q1" } })).state).toBe("queued");
	});

	it("holds messages past the pair cap unread, wakes nothing, and shows the cap on both threads", async () => {
		const f = await family();
		await settings.set({ ...(await settings.get()), pairPerDay: 2 });
		live.add(f.root);
		value(await tree.send(f.api, msg("starter", "one", "p1")));
		value(await tree.send(f.api, msg("starter", "two", "p2")));
		const third = value(await tree.send(f.api, msg("starter", "three", "p3")));
		expect(third).toMatchObject({ status: "held", note: expect.stringContaining("have sent each other 2 messages in 24 hours, the cap") });
		expect(sent.filter((m) => m.id === f.root).map((m) => m.text)).toEqual([
			`[Message from api (/threads/${f.api})] one`,
			`[Message from api (/threads/${f.api})] two`,
		]);
		expect((await prisma.threadMessage.findFirstOrThrow({ where: { requestId: "p3" } })).state).toBe("held");
		const held = (e: CanonicalEvent) => e.kind === "thread_message" && e.held === true;
		expect((await events(f.api)).filter(held)).toMatchObject([{ direction: "sent", text: "three" }]);
		expect((await events(f.root)).filter(held)).toMatchObject([{ direction: "received", text: "three" }]);
		await tree.drain();
		expect(sent.filter((m) => m.id === f.root)).toHaveLength(2);
	});

	it("lets any sender steer a thread it can read: delivered now", async () => {
		const f = await family();
		tree.canRead = async () => true;
		live.add(f.db);
		value(await tree.send(f.api, msg(`/threads/${f.db}`, "wrong table", "st1", "steer")));
		expect(sent.at(-1)).toEqual({ id: f.db, text: `[Message from api (/threads/${f.api})] wrong table`, mode: "now" });
	});

	it("refuses a thread it cannot read, itself, and `starter` on a thread nobody started", async () => {
		const f = await family();
		const other = await thread();
		const out = await tree.send(f.api, msg(other.id, "x", "o1"));
		expect(isFailure(out) && out.failure).toMatchObject({ error: "not_found", message: `No thread "${other.id}" that this thread can read.` });
		const self = await tree.send(f.api, msg(f.api, "x", "o2"));
		expect(isFailure(self) && self.failure.error).toBe("not_found");
		const none = await tree.send(f.root, msg("starter", "x", "o3"));
		expect(isFailure(none) && none.failure).toMatchObject({ error: "invalid_input", message: "No thread started this one." });
	});

	it("sends nothing back when a started thread finishes, and records nothing on its starter", async () => {
		const f = await family();
		live.add(f.root);
		await prisma.investigation.update({ where: { id: f.api }, data: { status: "completed", completedAt: new Date(), summary: "done" } });
		await tree.tick();
		expect(sent.filter((m) => m.id === f.root)).toEqual([]);
		expect(await prisma.threadMessage.count()).toBe(0);
		expect((await events(f.root)).map((e) => e.kind)).toEqual(["thread_started", "thread_started"]);
	});

	it("delivers an old database's queued result once, as a plain message", async () => {
		const f = await family();
		live.add(f.root);
		await prisma.threadMessage.create({
			data: { rootId: f.root, fromId: f.api, toId: f.root, type: "result", text: "/threads/x finished: answered.", requestId: "result:old" },
		});
		await tree.drain();
		await tree.drain();
		expect(sent.filter((m) => m.id === f.root).map((m) => m.text)).toEqual([`[Message from api (/threads/${f.api})] /threads/x finished: answered.`]);
	});

	it("serves start links: its starter, the threads it started with state and unread, and a fork's forked-from", async () => {
		const f = await family();
		await prisma.threadMessage.create({ data: { rootId: f.root, fromId: f.root, toId: f.api, type: "message", text: "x", requestId: "u1" } });
		const fork = await thread({ parentId: f.root, role: "fork", title: "fork" });
		const rootLinks = await tree.links(f.root);
		expect(rootLinks).toMatchObject({ startedBy: null, chainId: f.root, limits: { perStarter: 4, total: 10, pairPerDay: 20 } });
		expect(rootLinks?.started.map((l) => [l.id, l.state, l.unread])).toEqual([
			[f.api, "queued", 1],
			[f.db, "queued", 0],
		]);
		expect((await tree.links(f.db))?.startedBy).toMatchObject({ id: f.root, via: "agent", link: `/threads/${f.root}` });
		expect((await tree.links(fork.id))?.startedBy).toMatchObject({ id: f.root, via: "fork" });
		expect(await tree.links(randomUUID())).toBeNull();
	});

	it("stops any thread it can read, as the Stop button does, but not one it cannot read or itself", async () => {
		const f = await family();
		const stop = (caller: string, id: string, requestId: string) =>
			actions.gate({ callerId: caller, rootId: f.root, tool: "pl_thread_cancel", args: { id, reason: "dup", requestId }, requestId });
		const unread = await stop(f.api, f.db, "c0");
		expect(isFailure(unread) && unread.failure.error).toBe("not_found");
		tree.canRead = async () => true;
		value(await stop(f.api, `/threads/${f.db}`, "c1"));
		expect(dispatch.cancelPendingJob).toHaveBeenCalledWith(f.db);
		const self = await stop(f.api, f.api, "c2");
		expect(isFailure(self) && self.failure.error).toBe("invalid_input");
	});
});

describe("proposals (#1024 spec F)", () => {
	it("records a card and applies a setting only when applied", async () => {
		const root = await thread();
		const io = new TreeIo(prisma, dispatch as never, investigations as never, relay as never);
		const proposals = new ProposalsService(prisma, io, settings, {} as never, {} as never);
		const p = await proposals.propose(root.id, { kind: "setting", key: "children", value: 2 }, "fewer at once");
		if ("error" in p) throw new Error(p.error);
		expect((await settings.get()).children).toBe(4);
		const applied = await proposals.apply(root.id, p.id, null);
		expect(applied.state).toBe("applied");
		expect((await settings.get()).children).toBe(2);
		await expect(proposals.dismiss(root.id, p.id)).rejects.toThrow(/already applied/);
		expect((await events(root.id)).map((e) => e.kind)).toEqual(["action_proposed", "action_resolved"]);
	});
});

describe("start and stop edges (#1101 cat 10)", () => {
	const allow = () => settings.set({ agentsStartThreads: "allow", depth: 2, children: 4, perTree: 10, turnsPerDay: 200 });
	const fails = (o: ToolOutcome) => (isFailure(o) ? o.failure : null);

	it("links each kind of thread where the app shows it, and rings each status", () => {
		expect(threadLink({ id: "t", incidentId: "i", scheduleId: null })).toBe("/incidents/i/conversation?investigation=t");
		expect(threadLink({ id: "t", incidentId: null, scheduleId: "s" })).toBe("/schedules/s/runs/t");
		expect(["pending", "running", "completed", "failed", "cancelled"].map((status) => nodeState({ status }))).toEqual([
			"queued",
			"running",
			"answered",
			"failed",
			"stopped",
		]);
	});

	it("starts a thread at the starter's commit, at a named ref, or fresh, with the agent, model and effort it names", async () => {
		await allow();
		const head = "a".repeat(40);
		const repo = (dir: string, sourceKind: string) => ({
			name: "repo",
			dir,
			sourceKind,
			url: "repo-url",
			subPath: null,
			connectionId: null,
			head,
			branch: null,
			services: [],
		});
		const ws = (r: unknown) => JSON.stringify({ layout: "single", cwd: "/nowhere", repos: [r] });
		const root = await thread({ workspace: ws(repo("/nowhere", "url")), harness: "claude-code", model: "m1", effort: "high" });
		value(await startIn(root.id, { workspace: { kind: "new_from_parent" } }));
		value(await startIn(root.id, { workspace: { kind: "new_from_ref", ref: "release-1" }, agent: "codex", model: "m2", effort: "low" }));
		value(await startIn(root.id, { workspace: { kind: "same_project_fresh" } }));
		expect(starts.map((s) => s.pinned)).toEqual([head, "release-1", undefined]);
		expect(starts[0]?.input).toMatchObject({ harness: "claude-code", model: "m1", effort: "high" });
		expect(starts[1]?.input).toMatchObject({ harness: "codex", model: "m2", effort: "low" });
		// A folder whose worktree cannot be read falls back to the recorded commit.
		const folder = await thread({ workspace: ws(repo("/no/such/dir", "folder")) });
		value(await startIn(folder.id, { workspace: { kind: "new_from_parent" } }));
		expect(starts.at(-1)?.pinned).toBe(head);
		const bare = await thread({ workspace: null });
		value(await startIn(bare.id, { workspace: { kind: "new_from_parent" } }));
		expect(starts.at(-1)?.pinned).toBeUndefined();
	});

	it("gives a project thread's start the project, and a service thread's the service", async () => {
		await allow();
		const repo = await prisma.repository.create({
			data: { fullName: `org/r-${randomUUID()}`, sourceKind: "url", url: `https://example.test/${randomUUID()}.git` },
		});
		const service = await prisma.service.create({ data: { name: `svc-${randomUUID()}` } });
		value(await startIn((await thread({ repositoryId: repo.id })).id));
		value(await startIn((await thread({ serviceId: service.id })).id));
		expect(starts.map((s) => s.input.subject)).toEqual([
			{ kind: "project", repositoryId: repo.id },
			{ kind: "service", serviceId: service.id },
		]);
	});

	it("refuses a caller that is gone", async () => {
		await allow();
		const gone = await actions.gate({ callerId: randomUUID(), rootId: "x", tool: "pl_thread_start", args: {}, requestId: "g1" });
		expect(fails(gone)?.error).toBe("run_ended");
	});
	it("resolves `to` by link, id or `starter` (2cc93e1ad)", async () => {
		await allow();
		const root = await thread();
		const a = value(await startIn(root.id)).id as string;
		expect((await tree.resolve(a, "starter"))?.id).toBe(root.id);
		expect((await tree.resolve(a, `/threads/${root.id}`))?.id).toBe(root.id);
		expect((await tree.resolve(root.id, a))?.id).toBe(a);
		expect(await tree.resolve(a, "nobody")).toBeNull();
		expect(await tree.resolve(root.id, "starter")).toBeNull();
		expect(await tree.linked(root.id, a)).toBe(true);
		expect(await tree.linked(root.id, (await thread()).id)).toBe(false);
	});
	it("answers a gone sender, and a stop of a thread it cannot name, without guessing (2cc93e1ad)", async () => {
		const solo = await thread();
		expect(fails(await tree.send(randomUUID(), { to: "starter", text: "x", mode: "queue", requestId: "n1" }))?.error).toBe("run_ended");
		const cancel = await actions.gate({
			callerId: solo.id,
			rootId: solo.id,
			tool: "pl_thread_cancel",
			args: { id: "x", reason: "r", requestId: "c" },
			requestId: "c",
		});
		expect(fails(cancel)?.error).toBe("not_found");
	});
	it("keeps a message for an idle thread that cannot reopen now, and says so (2cc93e1ad)", async () => {
		await allow();
		const root = await thread();
		const db = value(await startIn(root.id)).id as string;
		await prisma.investigation.update({ where: { id: db }, data: { status: "completed", completedAt: new Date() } });
		dispatch.resumeInvestigation.mockRejectedValueOnce(new FollowUpRefused("Pick an agent to continue in."));
		const m = { to: `/threads/${db}`, text: "use replica", mode: "queue" as const, requestId: "h1" };
		const r = value(await tree.send(root.id, m));
		expect(r).toMatchObject({ status: "queued", note: `/threads/${db} can't reopen now (a usage limit or a stop); it gets this when it next runs.` });
		// A retry with the key answers the same message.
		expect(value(await tree.send(root.id, m)).messageId).toBe(r.messageId);
	});
	it("ends a chain's allowance once nothing in it runs", async () => {
		const root = await thread({ status: "completed" });
		await prisma.treeAllowance.create({ data: { rootId: root.id, grantedBy: "host" } });
		await tree.tick();
		expect(await prisma.treeAllowance.count()).toBe(0);
	});

	it("stops a running thread it started through the run, or as an orphan when nothing holds it, and refuses one already ended", async () => {
		await allow();
		const root = await thread();
		const a = value(await startIn(root.id)).id as string;
		const b = value(await startIn(root.id)).id as string;
		await prisma.investigation.updateMany({ where: { id: { in: [a, b] } }, data: { status: "running" } });
		const stop = (id: string, requestId: string) =>
			actions.gate({ callerId: root.id, rootId: root.id, tool: "pl_thread_cancel", args: { id, reason: "replaced", requestId }, requestId });
		value(await stop(a, "s1"));
		expect(investigations.markStopRequested).toHaveBeenCalledWith(a);
		dispatch.requestCancel.mockResolvedValueOnce(0);
		value(await stop(b, "s2"));
		expect(dispatch.cancelOrphanedRun).toHaveBeenCalledWith(b);
		expect(fails(await stop(b, "s3"))?.error).toBe("invalid_input");
	});
});

describe("the act gate's edges (#1024 spec F)", () => {
	const fails = (o: ToolOutcome) => (isFailure(o) ? o.failure : null);

	it("answers an unwired tool, and a retry of each ended state with what it ended as", async () => {
		const root = await thread();
		const unwired = await actions.gate({ callerId: root.id, rootId: root.id, tool: "nope", args: {}, requestId: "x" });
		expect(fails(unwired)?.error).toBe("internal");
		const cases = [
			["denied", { error: "not now" }, /not now/],
			["expired", {}, /expired/],
			["cancelled", {}, /cancelled/],
			["failed", { error: "boom" }, /boom/],
		] as const;
		for (const [state, extra, says] of cases) {
			await prisma.pendingAction.create({
				data: { callerId: root.id, rootId: root.id, tool: "pl_thread_start", args: "{}", requestId: state, state, ...extra },
			});
			expect(fails(await start(root.id, { requestId: state }))?.message).toMatch(says);
		}
	});

	it("records a card that lapsed unanswered as expired, a denial's reason, and tells the caller", async () => {
		const root = await thread();
		live.add(root.id);
		value(await start(root.id, { requestId: "lapse" }));
		value(await start(root.id, { requestId: "deny" }));
		const [lapse, deny] = await asks.pending(root.id);
		await actions.closed({ ask: lapse as PendingAsk, outcome: "expired", closedAt: new Date().toISOString() });
		await actions.closed(asks.closeQuietly(deny?.askId as string, { kind: "permission", decision: "deny", reason: "too many" }));
		const rows = await prisma.pendingAction.findMany({ orderBy: { createdAt: "asc" } });
		expect(rows.map((r) => [r.state, r.error])).toEqual([
			["expired", null],
			["denied", "too many"],
		]);
		expect(sent.map((m) => m.text).join("\n")).toMatch(/was expired before the user answered[\s\S]*was denied by the user: too many/);
	});

	it("runs nothing for an unknown row, answers a done row again, and survives an executor that throws", async () => {
		expect(fails(await actions.execute(randomUUID()))?.error).toBe("not_found");
		const root = await thread();
		await settings.set({ agentsStartThreads: "allow", depth: 2, children: 4, perTree: 10, turnsPerDay: 200 });
		value(await start(root.id, { requestId: "ok" }));
		const done = await prisma.pendingAction.findFirstOrThrow({ where: { requestId: "ok" } });
		expect(value(await actions.execute(done.id)).status).toBe("started");
		threads.start.mockRejectedValueOnce(new Error("disk full"));
		expect(fails(await start(root.id, { requestId: "boom" }))?.error).toBe("internal");
		const gone = await prisma.pendingAction.create({
			data: { callerId: root.id, rootId: root.id, tool: "gone_tool", args: "{}", requestId: "u", state: "approved" },
		});
		expect(fails(await actions.execute(gone.id))?.error).toBe("internal");
	});

	it("expires a card the asks seat no longer knows at boot, and refuses a card for a thread that is gone", async () => {
		const root = await thread();
		value(await start(root.id, { requestId: "lost" }));
		const row = await prisma.pendingAction.findFirstOrThrow({ where: { requestId: "lost" } });
		asks.asks.delete(row.askId as string);
		await actions.resume();
		expect((await prisma.pendingAction.findUniqueOrThrow({ where: { id: row.id } })).state).toBe("expired");
		const { AskConflict } = await import("../asks/asks.contract.js");
		const refusing = new FakeAsks();
		refusing.open = async () => {
			throw new AskConflict("gone");
		};
		const io = new TreeIo(prisma, dispatch as never, investigations as never, relay as never);
		actions = new PendingActionsService(prisma, settings, io, refusing);
		tree = new ThreadTreeService(prisma, threads as never, dispatch as never, investigations as never, settings, actions, io);
		expect(fails(await start(root.id, { requestId: "nocard" }))?.error).toBe("run_ended");
		actions.stop();
	});
});

describe("delivery (#1024 spec F)", () => {
	it("retries a busy or unclaimed run, keeps text for an ended thread, and retries a refused reopen", async () => {
		const io = new TreeIo(prisma, dispatch as never, investigations as never, relay as never);
		const t = await thread({ status: "pending" });
		dispatch.sendMessage.mockReturnValueOnce("conflict" as never);
		expect((await io.deliver(t.id, "x", { reopen: false })).state).toBe("later");
		expect((await io.deliver(t.id, "x", { reopen: false })).state).toBe("later");
		expect((await io.deliver(randomUUID(), "x", { reopen: true })).state).toBe("parked");
		const ended = await thread({ status: "completed" });
		expect((await io.deliver(ended.id, "x", { reopen: false })).state).toBe("parked");
		dispatch.resumeInvestigation.mockRejectedValueOnce(new FollowUpRefused("busy"));
		expect((await io.deliver(ended.id, "x", { reopen: true })).state).toBe("later");
		dispatch.resumeInvestigation.mockResolvedValueOnce(false);
		expect((await io.deliver(ended.id, "x", { reopen: true })).state).toBe("later");
		dispatch.resumeInvestigation.mockRejectedValueOnce(new Error("db down"));
		await expect(io.deliver(ended.id, "x", { reopen: true })).rejects.toThrow("db down");
	});

	it("emits a recorded node onto a live stream, and never throws when it cannot record", async () => {
		const stream = { isActive: () => true, emit: vi.fn() };
		const t = await thread();
		await new TreeIo(prisma, dispatch as never, investigations as never, stream as never).record(t.id, {
			kind: "thread_started",
			childId: "c",
			role: "db",
			title: "x",
			link: "/threads/c",
		});
		expect(stream.emit).toHaveBeenCalledTimes(1);
		const broken = {
			...investigations,
			lastEventSeq: async () => {
				throw new Error("no db");
			},
		};
		await expect(
			new TreeIo(prisma, dispatch as never, broken as never, relay as never).record(t.id, {
				kind: "action_resolved",
				proposalId: "p",
				state: "dismissed",
			}),
		).resolves.toBeUndefined();
	});

	it("reads stored settings, and falls back to the defaults on a broken row", async () => {
		await prisma.setting.create({ data: { key: "threads.tree", value: "{not json" } });
		expect((await settings.get()).agentsStartThreads).toBe("ask");
		await prisma.setting.update({ where: { key: "threads.tree" }, data: { value: JSON.stringify({ children: 2 }) } });
		expect(await settings.get()).toMatchObject({ children: 2, perTree: 10, pairPerDay: 20 });
	});

	it("TreeIo.deliver(id, 'x', { reopen: true }) to a failed thread with endReason: 'limited' returns { state: 'parked' } and never calls dispatch.resumeInvestigation when TreeIo gets an InboxService", async () => {
		const inbox = new InboxService(prisma, investigations as never);
		const io = new TreeIo(prisma, dispatch as never, investigations as never, relay as never, inbox);
		const t = await thread({ status: "failed", endReason: "limited" });
		dispatch.resumeInvestigation.mockClear();

		const result = await io.deliver(t.id, "x", { reopen: true });

		expect(result).toEqual({ state: "parked" });
		expect(dispatch.resumeInvestigation).not.toHaveBeenCalled();
	});

	it("with messageId: 'm-1', a live run's dispatch.sendMessage is called with 'm-1' as its 6th argument, and a reopen calls resumeInvestigation with { delivers: ['m-1'] } as its 8th", async () => {
		const io = new TreeIo(prisma, dispatch as never, investigations as never, relay as never);
		const liveRun = await thread({ status: "running" });
		live.add(liveRun.id);
		dispatch.sendMessage.mockClear();

		const liveResult = await io.deliver(liveRun.id, "x", { reopen: false, messageId: "m-1" });
		expect(liveResult).toEqual({ state: "delivered", messageId: "m-1" });
		expect(dispatch.sendMessage).toHaveBeenCalledWith(liveRun.id, "x", "queue", [], undefined, "m-1");
		live.delete(liveRun.id);

		const ended = await thread({ status: "completed" });
		dispatch.resumeInvestigation.mockClear();
		dispatch.resumeInvestigation.mockResolvedValueOnce(true);

		const reopenResult = await io.deliver(ended.id, "x", { reopen: true, messageId: "m-1" });
		expect(reopenResult).toEqual({ state: "delivered", messageId: "m-1" });
		expect(dispatch.resumeInvestigation).toHaveBeenCalledWith(
			ended.id,
			"x",
			"queue",
			"chat",
			[],
			{},
			undefined,
			{ delivers: ["m-1"] },
		);
	});
});

describe("applying proposals (#1024 spec F)", () => {
	function proposals(repos: Record<string, unknown> = {}, schedules: Record<string, unknown> = {}) {
		const io = new TreeIo(prisma, dispatch as never, investigations as never, relay as never);
		return new ProposalsService(prisma, io, settings, repos as never, schedules as never);
	}

	it("applies a link, a project and a schedule through their services", async () => {
		const linkToService = vi.fn(async () => ({}));
		const addSource = vi.fn(async () => ({ id: "repo-1" }));
		const create = vi.fn(async () => ({ id: "sched-1" }));
		const p = proposals({ linkToService, addSource }, { create });
		const service = await prisma.service.create({ data: { name: `svc-${randomUUID()}` } });
		const root = await thread({ harness: "claude-code", model: "m", effort: "high", serviceId: service.id });
		const apply = async (change: Parameters<typeof p.propose>[1]) => {
			const made = await p.propose(root.id, change, "because");
			if ("error" in made) throw new Error(made.error);
			return p.apply(root.id, made.id, "dev-1");
		};
		expect((await apply({ kind: "service_link", serviceId: "s", repositoryId: "r" })).outcome).toBe("Linked.");
		expect(linkToService).toHaveBeenCalledWith("r", { serviceId: "s" });
		expect((await apply({ kind: "project_add", source: "/code/shop" })).outcome).toBe("Added project repo-1.");
		const schedule = { kind: "schedule" as const, name: "Daily", brief: "Check it", cron: "0 9 * * 1-5", timezone: "UTC" };
		expect((await apply(schedule)).outcome).toBe("Scheduled sched-1.");
		expect(create).toHaveBeenCalledWith(expect.objectContaining({ serviceId: service.id, harness: "claude-code", report: false }), "dev-1");
	});

	it("refuses a schedule from a thread with no agent, an unknown or decided card, and more than ten open", async () => {
		const p = proposals();
		const root = await thread({ harness: null });
		const made = await p.propose(root.id, { kind: "schedule", name: "D", brief: "b", cron: "0 9 * * 1-5", timezone: "UTC" }, "w");
		if ("error" in made) throw new Error(made.error);
		await expect(p.apply(root.id, made.id, null)).rejects.toThrow(/no agent/);
		await expect(p.apply(root.id, randomUUID(), null)).rejects.toThrow(/No such proposal/);
		await p.dismiss(root.id, made.id);
		await expect(p.dismiss(root.id, made.id)).rejects.toThrow(/already dismissed/);
		for (let i = 0; i < 10; i++) await p.propose(root.id, { kind: "project_add", source: `/c/${i}` }, "w");
		expect(await p.propose(root.id, { kind: "project_add", source: "/c/x" }, "w")).toMatchObject({
			error: expect.stringContaining("10 open"),
		});
	});
});

describe("one runner per action, and messages put off (#1024 spec F)", () => {
	const allow = () => settings.set({ agentsStartThreads: "allow", depth: 2, children: 4, perTree: 10, turnsPerDay: 200 });
	const restoreResume = () => {
		dispatch.resumeInvestigation.mockReset();
		dispatch.resumeInvestigation.mockImplementation(async (id: string, text: string) => {
			resumed.push({ id, text });
			await prisma.investigation.update({ where: { id }, data: { status: "pending" } });
			return true;
		});
	};

	it("Given two runners of one approved action at once, Then one thread starts", async () => {
		const root = await thread();
		value(await start(root.id, { requestId: "twice" }));
		const row = await prisma.pendingAction.findFirstOrThrow({ where: { requestId: "twice" } });
		await prisma.pendingAction.update({ where: { id: row.id }, data: { state: "approved" } });
		const [a, b] = await Promise.all([actions.execute(row.id), actions.execute(row.id)]);
		expect(starts).toHaveLength(1);
		expect(value(a).id).toBe(value(b).id);
	});

	it("Given more messages than one batch for a thread that cannot reopen yet, Then a message to a running thread is still delivered (2cc93e1ad)", async () => {
		await allow();
		const root = await thread();
		const ended = value(await startIn(root.id)).id as string;
		const running = value(await startIn(root.id)).id as string;
		await prisma.investigation.update({ where: { id: ended }, data: { status: "completed", completedAt: new Date() } });
		await prisma.investigation.update({ where: { id: running }, data: { status: "running" } });
		await prisma.threadMessage.deleteMany();
		await prisma.threadMessage.createMany({
			data: Array.from({ length: 101 }, (_, i) => ({
				rootId: root.id,
				fromId: root.id,
				toId: ended,
				type: "message",
				text: `old ${i}`,
				requestId: `old-${i}`,
			})),
		});
		live.add(running);
		dispatch.resumeInvestigation.mockImplementation(async () => {
			throw new FollowUpRefused("Pick an agent to continue in.");
		});
		try {
			value(await tree.send(root.id, { to: `/threads/${running}`, text: "fresh news", mode: "queue", requestId: "fresh" }));
			await tree.drain();
		} finally {
			restoreResume();
		}
		expect(sent.some((m) => m.id === running && m.text.includes("fresh news"))).toBe(true);
		expect(await prisma.threadMessage.count({ where: { toId: ended, state: "queued" } })).toBe(101);
	});
	it("Given an idle receiver whose reopen keeps being refused, Then it stops after 30 tries and the message waits for its next run (2cc93e1ad)", async () => {
		await allow();
		const root = await thread({ status: "completed" });
		const db = value(await startIn(root.id)).id as string;
		await prisma.threadMessage.create({ data: { rootId: root.id, fromId: db, toId: root.id, type: "message", text: "done", requestId: "refused" } });
		dispatch.resumeInvestigation.mockImplementation(async () => {
			throw new FollowUpRefused("Pick an agent to continue in.");
		});
		let tries = 0;
		try {
			for (let i = 0; i < 80; i++) await tree.drain();
			tries = dispatch.resumeInvestigation.mock.calls.length;
		} finally {
			restoreResume();
		}
		expect(tries).toBe(30);
		// Once the receiver runs again, it takes the message at its next pause.
		await prisma.investigation.update({ where: { id: root.id }, data: { status: "running" } });
		live.add(root.id);
		await tree.drain();
		expect(sent.filter((m) => m.id === root.id).map((m) => m.text)).toEqual([`[Message from Check the db (/threads/${db})] done`]);
	});
});

describe("proposals are claimed before they apply (#1024 spec F)", () => {
	it("Given two applies at once, Then the change runs once and the second gets a conflict", async () => {
		let release = () => {};
		const gate = new Promise<void>((r) => {
			release = r;
		});
		const addSource = vi.fn(async () => {
			await gate;
			return { id: "repo-1" };
		});
		const io = new TreeIo(prisma, dispatch as never, investigations as never, relay as never);
		const p = new ProposalsService(prisma, io, settings, { addSource } as never, {} as never);
		const root = await thread();
		const made = await p.propose(root.id, { kind: "project_add", source: "/code/shop" }, "w");
		if ("error" in made) throw new Error(made.error);
		const first = p.apply(root.id, made.id, null);
		const second = p.apply(root.id, made.id, null);
		await expect(second).rejects.toThrow(/already being applied/);
		release();
		expect((await first).state).toBe("applied");
		expect(addSource).toHaveBeenCalledTimes(1);
	});

	it("Given a card a stop left applying, Then boot settles it as unconfirmed, and the user can dismiss one too", async () => {
		const io = new TreeIo(prisma, dispatch as never, investigations as never, relay as never);
		const p = new ProposalsService(prisma, io, settings, {} as never, {} as never);
		const root = await thread();
		const stuck = async () => {
			const made = await p.propose(root.id, { kind: "project_add", source: "/code/shop" }, "w");
			if ("error" in made) throw new Error(made.error);
			await prisma.proposal.update({ where: { id: made.id }, data: { state: "applying" } });
			return made.id;
		};
		const atBoot = await stuck();
		await p.onApplicationBootstrap();
		const settled = await prisma.proposal.findUniqueOrThrow({ where: { id: atBoot } });
		expect(settled).toMatchObject({ state: "dismissed", outcome: expect.stringContaining("Check whether it happened") });
		expect((await events(root.id)).some((e) => e.kind === "action_resolved" && e.proposalId === atBoot)).toBe(true);
		const byUser = await stuck();
		expect((await p.dismiss(root.id, byUser)).state).toBe("dismissed");
	});

	it("Given a card whose change is running now, Then dismissing it waits for the change", async () => {
		let release = () => {};
		const gate = new Promise<void>((r) => {
			release = r;
		});
		const io = new TreeIo(prisma, dispatch as never, investigations as never, relay as never);
		const addSource = vi.fn(async () => {
			await gate;
			return { id: "repo-2" };
		});
		const p = new ProposalsService(prisma, io, settings, { addSource } as never, {} as never);
		const root = await thread();
		const made = await p.propose(root.id, { kind: "project_add", source: "/code/shop" }, "w");
		if ("error" in made) throw new Error(made.error);
		const applying = p.apply(root.id, made.id, null);
		await vi.waitFor(() => expect(addSource).toHaveBeenCalled());
		await expect(p.dismiss(root.id, made.id)).rejects.toThrow(/being applied now/);
		release();
		expect((await applying).state).toBe("applied");
	});

	it("Given a change that fails, Then the card is open again to retry", async () => {
		const io = new TreeIo(prisma, dispatch as never, investigations as never, relay as never);
		const addSource = vi.fn(async () => {
			throw new Error("not a git repository");
		});
		const p = new ProposalsService(prisma, io, settings, { addSource } as never, {} as never);
		const root = await thread();
		const made = await p.propose(root.id, { kind: "project_add", source: "/nope" }, "w");
		if ("error" in made) throw new Error(made.error);
		await expect(p.apply(root.id, made.id, null)).rejects.toThrow(/not a git repository/);
		expect((await prisma.proposal.findUniqueOrThrow({ where: { id: made.id } })).state).toBe("open");
	});
});

describe("records follow their threads, and nothing waits forever (#1024 spec F)", () => {
	const allow = () => settings.set({ agentsStartThreads: "allow", depth: 2, children: 4, perTree: 10, turnsPerDay: 200 });

	it("Given a thread is deleted, Then its inbox, cards, actions and allowance go too, and its sent messages stay", async () => {
		await allow();
		const root = await thread();
		const a = value(await startIn(root.id)).id as string;
		const b = value(await startIn(root.id)).id as string;
		await prisma.proposal.create({ data: { threadId: root.id, kind: "setting", change: "{}", why: "w" } });
		await prisma.treeAllowance.create({ data: { rootId: root.id, grantedBy: "host" } });
		await prisma.threadMessage.create({
			data: { rootId: root.id, fromId: a, toId: b, type: "fact", text: "from a", requestId: "a-to-b" },
		});
		await prisma.threadMessage.create({
			data: { rootId: root.id, fromId: b, toId: a, type: "fact", text: "to a", requestId: "b-to-a" },
		});
		await prisma.investigation.delete({ where: { id: root.id } });
		expect(await prisma.pendingAction.count({ where: { callerId: root.id } })).toBe(0);
		expect(await prisma.proposal.count({ where: { threadId: root.id } })).toBe(0);
		expect(await prisma.treeAllowance.count({ where: { rootId: root.id } })).toBe(0);
		await prisma.investigation.delete({ where: { id: a } });
		const left = await prisma.threadMessage.findMany({ where: { rootId: root.id }, select: { requestId: true } });
		// a's inbox went with it; what a sent to b still waits for b.
		expect(left.some((m) => m.requestId === "b-to-a")).toBe(false);
		expect(left.some((m) => m.requestId === "a-to-b")).toBe(true);
	});

	it("Given more refused outcomes than one batch, Then an outcome for a running caller still goes out, and refused ones stop retrying", async () => {
		const ended = await thread({ status: "completed" });
		await prisma.pendingAction.createMany({
			data: Array.from({ length: 51 }, (_, i) => ({
				callerId: ended.id,
				rootId: ended.id,
				tool: "pl_thread_start",
				args: "{}",
				requestId: `refused-${i}`,
				state: "denied",
			})),
		});
		const running = await thread();
		live.add(running.id);
		await prisma.pendingAction.create({
			data: { callerId: running.id, rootId: running.id, tool: "pl_thread_start", args: "{}", requestId: "fresh", state: "denied" },
		});
		dispatch.resumeInvestigation.mockImplementation(async () => {
			throw new FollowUpRefused("Pick an agent to continue in.");
		});
		let tries = 0;
		try {
			await actions.deliverOutcomes();
			expect(sent.some((m) => m.id === running.id && m.text.includes('"fresh"'))).toBe(true);
			for (let i = 0; i < 70; i++) await actions.deliverOutcomes();
			tries = dispatch.resumeInvestigation.mock.calls.length;
		} finally {
			dispatch.resumeInvestigation.mockReset();
			dispatch.resumeInvestigation.mockImplementation(async (id: string, text: string) => {
				resumed.push({ id, text });
				await prisma.investigation.update({ where: { id }, data: { status: "pending" } });
				return true;
			});
		}
		// 50 per batch at most, 30 tries each, then they wait for the caller's next run.
		expect(tries).toBeLessThanOrEqual(51 * 30);
		expect(await prisma.pendingAction.count({ where: { callerId: ended.id, deliveredAt: null } })).toBe(51);
		dispatch.resumeInvestigation.mockClear();
		await actions.deliverOutcomes();
		expect(dispatch.resumeInvestigation).not.toHaveBeenCalled();
	});
});

describe("proposals refuse what cannot apply (#1024 spec F)", () => {
	function proposals(schedules: Record<string, unknown> = {}) {
		const io = new TreeIo(prisma, dispatch as never, investigations as never, relay as never);
		return new ProposalsService(prisma, io, settings, {} as never, schedules as never);
	}

	it("Given a setting out of its range, Then no card is made and the agent is told why", async () => {
		const root = await thread();
		const r = await proposals().propose(root.id, { kind: "setting", key: "children", value: 50 }, "w");
		expect(r).toMatchObject({ invalid: true, error: expect.stringContaining("children cannot be 50") });
		expect(await prisma.proposal.count({ where: { threadId: root.id } })).toBe(0);
	});

	it("Given a schedule the schedules service refuses, Then apply answers that refusal and reopens the card", async () => {
		const { ScheduleError } = await import("../schedules/schedules.service.js");
		const create = vi.fn(async () => {
			throw new ScheduleError("BAD_REQUEST", "That cron runs more than once a minute.");
		});
		const p = proposals({ create });
		const root = await thread({ harness: "claude-code" });
		const made = await p.propose(root.id, { kind: "schedule", name: "D", brief: "b", cron: "* * * * *", timezone: "UTC" }, "w");
		if ("error" in made) throw new Error(made.error);
		const { ORPCError } = await import("@orpc/nest");
		const refused = await p.apply(root.id, made.id, null).catch((e: unknown) => e);
		// The API answers it as a 400 with the reason, not as an internal error.
		expect(refused).toBeInstanceOf(ORPCError);
		expect(refused).toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("once a minute") });
		expect((await prisma.proposal.findUniqueOrThrow({ where: { id: made.id } })).state).toBe("open");
	});

	it("Given an apply that has run its change, Then a dismiss still waits until the card is recorded applied", async () => {
		const io = new TreeIo(prisma, dispatch as never, investigations as never, relay as never);
		const addSource = vi.fn(async () => ({ id: "repo-3" }));
		const p = new ProposalsService(prisma, io, settings, { addSource } as never, {} as never);
		const root = await thread();
		const made = await p.propose(root.id, { kind: "project_add", source: "/code/shop" }, "w");
		if ("error" in made) throw new Error(made.error);
		const held = p as unknown as { applyingNow: Set<string>; decide: (...args: unknown[]) => Promise<unknown> };
		const decide = held.decide.bind(p);
		let markedWhileDeciding = false;
		held.decide = async (...args: unknown[]) => {
			markedWhileDeciding = held.applyingNow.has(made.id);
			return decide(...args);
		};
		expect((await p.apply(root.id, made.id, null)).state).toBe("applied");
		expect(markedWhileDeciding).toBe(true);
		expect(held.applyingNow.has(made.id)).toBe(false);
	});
});

describe("outcome delivery runs one pass at a time (#1024 spec F)", () => {
	it("Given two delivery passes at once, Then each outcome reaches its caller once", async () => {
		const caller = await thread();
		live.add(caller.id);
		await prisma.pendingAction.create({
			data: { callerId: caller.id, rootId: caller.id, tool: "pl_thread_start", args: "{}", requestId: "once", state: "denied" },
		});
		await Promise.all([actions.deliverOutcomes(), actions.deliverOutcomes(), actions.deliverOutcomes()]);
		expect(sent.filter((m) => m.id === caller.id && m.text.includes('"once"'))).toHaveLength(1);
	});
});

describe("rows a pass puts off never hold back newer ones (#1024 spec F)", () => {
	it("Given 60 outcomes for a caller not yet claimed, Then a newer outcome for a running caller still goes out", async () => {
		const unclaimed = await thread({ status: "pending" });
		await prisma.pendingAction.createMany({
			data: Array.from({ length: 60 }, (_, i) => ({
				callerId: unclaimed.id,
				rootId: unclaimed.id,
				tool: "pl_thread_start",
				args: "{}",
				requestId: `wait-${i}`,
				state: "denied",
			})),
		});
		const running = await thread();
		live.add(running.id);
		await prisma.pendingAction.create({
			data: { callerId: running.id, rootId: running.id, tool: "pl_thread_start", args: "{}", requestId: "newer", state: "denied" },
		});
		for (let i = 0; i < 3; i++) await actions.deliverOutcomes();
		expect(sent.some((m) => m.id === running.id && m.text.includes('"newer"'))).toBe(true);
		// The put-off outcomes are kept, and go out once their caller runs.
		live.add(unclaimed.id);
		await prisma.investigation.update({ where: { id: unclaimed.id }, data: { status: "running" } });
		for (let i = 0; i < 4; i++) await actions.deliverOutcomes();
		expect(await prisma.pendingAction.count({ where: { callerId: unclaimed.id, deliveredAt: null } })).toBe(0);
	});

	it("Given 100 queued messages to a settled thread, Then a newer message to a running thread is still delivered (2cc93e1ad)", async () => {
		await settings.set({ agentsStartThreads: "allow", depth: 2, children: 4, perTree: 10, turnsPerDay: 200 });
		const past = new Date(Date.now() - 60_000);
		const root = await thread({ status: "completed", lastActivityAt: past, settledAt: new Date() });
		const peer = value(await startIn(root.id)).id as string;
		await prisma.investigation.update({ where: { id: peer }, data: { status: "running" } });
		await prisma.threadMessage.createMany({
			data: Array.from({ length: 100 }, (_, i) => ({
				rootId: root.id,
				fromId: peer,
				toId: root.id,
				type: "message",
				text: `old ${i}`,
				requestId: `old-${i}`,
			})),
		});
		await prisma.threadMessage.create({
			data: { rootId: root.id, fromId: root.id, toId: peer, type: "message", text: "newer fact", requestId: "newer" },
		});
		live.add(peer);
		await tree.drain();
		expect(sent.some((m) => m.id === peer && m.text.includes("newer fact"))).toBe(true);
		expect(resumed).toHaveLength(0);
		expect(await prisma.threadMessage.count({ where: { toId: root.id, state: "queued" } })).toBe(100);
	});
});

describe("plain folders and overlapping deliveries (#1024 spec F)", () => {
	it("Given a starter in a plain folder, Then a start is refused up front with the reason, before any card", async () => {
		const repo = await prisma.repository.create({
			data: { fullName: `plain-${randomUUID()}`, sourceKind: "folder", url: `/plain/${randomUUID()}`, plain: true },
		});
		const root = await thread({ repositoryId: repo.id });
		const r = await start(root.id);
		expect(isFailure(r) && r.failure).toMatchObject({ error: "invalid_input", message: expect.stringContaining("plain folder") });
		expect(await asks.pending(root.id)).toHaveLength(0);
		expect(starts).toHaveLength(0);
	});

	it("Given two delivery passes at once, Then a queued message reaches its receiver once", async () => {
		await settings.set({ agentsStartThreads: "allow", depth: 2, children: 4, perTree: 10, turnsPerDay: 200 });
		const root = await thread();
		const db = value(await startIn(root.id)).id as string;
		await prisma.investigation.update({ where: { id: db }, data: { status: "running" } });
		await prisma.threadMessage.deleteMany();
		await prisma.threadMessage.create({
			data: { rootId: root.id, fromId: root.id, toId: db, type: "fact", text: "only once", requestId: "once" },
		});
		live.add(db);
		await Promise.all([tree.drain(), tree.drain(), tree.drain()]);
		expect(sent.filter((m) => m.id === db && m.text.includes("only once"))).toHaveLength(1);
	});
});

describe("one failing delivery never stops the rest (#1024 spec F)", () => {
	const restore = () => {
		dispatch.resumeInvestigation.mockReset();
		dispatch.resumeInvestigation.mockImplementation(async (id: string, text: string) => {
			resumed.push({ id, text });
			await prisma.investigation.update({ where: { id }, data: { status: "pending" } });
			return true;
		});
	};

	it("Given a message whose reopen throws, Then a later message in the same pass is still delivered, and the failing one is put off (2cc93e1ad)", async () => {
		await settings.set({ agentsStartThreads: "allow", depth: 2, children: 4, perTree: 10, turnsPerDay: 200 });
		const root = await thread();
		const child = value(await startIn(root.id)).id as string;
		const peer = value(await startIn(root.id)).id as string;
		await prisma.investigation.update({ where: { id: root.id }, data: { status: "completed" } });
		await prisma.investigation.update({ where: { id: peer }, data: { status: "running" } });
		await prisma.threadMessage.deleteMany();
		await prisma.threadMessage.create({
			data: { rootId: root.id, fromId: child, toId: root.id, type: "message", text: "done", requestId: "boom" },
		});
		await prisma.threadMessage.create({
			data: { rootId: root.id, fromId: child, toId: peer, type: "message", text: "after the failure", requestId: "after" },
		});
		live.add(peer);
		dispatch.resumeInvestigation.mockImplementation(async () => {
			throw new Error("UNIQUE constraint failed: jobs.id");
		});
		try {
			await expect(tree.drain()).resolves.toBeUndefined();
		} finally {
			restore();
		}
		expect(sent.some((m) => m.id === peer && m.text.includes("after the failure"))).toBe(true);
		expect(await prisma.threadMessage.count({ where: { requestId: "boom", state: "queued" } })).toBe(1);
	});
	it("Given an outcome whose reopen throws, Then a later outcome in the same pass is still delivered", async () => {
		const ended = await thread({ status: "completed" });
		await prisma.pendingAction.create({
			data: { callerId: ended.id, rootId: ended.id, tool: "pl_thread_start", args: "{}", requestId: "boom", state: "denied" },
		});
		const later = await thread({ status: "completed" });
		await prisma.pendingAction.create({
			data: { callerId: later.id, rootId: later.id, tool: "pl_thread_start", args: "{}", requestId: "after", state: "denied" },
		});
		dispatch.resumeInvestigation.mockImplementation(async (id: string, text: string) => {
			if (id === ended.id) throw new Error("UNIQUE constraint failed: jobs.id");
			resumed.push({ id, text });
			return true;
		});
		try {
			await expect(actions.deliverOutcomes()).resolves.toBeUndefined();
		} finally {
			restore();
		}
		expect(resumed.map((r) => r.id)).toContain(later.id);
		expect((await prisma.pendingAction.findFirstOrThrow({ where: { requestId: "boom" } })).deliveredAt).toBeNull();
	});
});

describe("turnsPerDay limit and delegate default (#1101 cat 18)", () => {
	it("refuses thread_start with limit_reached and next naming A day when daily cap reached; message from 25h ago does not count", async () => {
		await settings.set({ agentsStartThreads: "allow", depth: 3, children: 15, perTree: 20, turnsPerDay: 10 });
		const root = await thread();

		const now = Date.now();
		const hourAgo = new Date(now - 60 * 60 * 1000);
		const oldDate = new Date(now - 25 * 60 * 60 * 1000);

		// Seed a message from 25 hours ago (does not count)
		await prisma.threadMessage.create({
			data: {
				rootId: root.id,
				fromId: root.id,
				toId: root.id,
				type: "message",
				text: "old",
				requestId: randomUUID(),
				createdAt: oldDate,
			},
		});

		// Seed 9 messages from 1 hour ago
		for (let i = 0; i < 9; i++) {
			await prisma.threadMessage.create({
				data: {
					rootId: root.id,
					fromId: root.id,
					toId: root.id,
					type: "message",
					text: `recent-${i}`,
					requestId: randomUUID(),
					createdAt: hourAgo,
				},
			});
		}

		// 9 messages created today + 1 old message. Limit is 10.
		// So starting 1 thread succeeds (total starts + messages today reaches 10).
		const outcome1 = await start(root.id, {});
		expect(isFailure(outcome1)).toBe(false);

		// Now we have 9 messages + 1 start today = 10 turns today.
		// Next thread_start attempt should be refused with limit_reached
		const outcome2 = await start(root.id, {});
		expect(isFailure(outcome2)).toBe(true);
		if (isFailure(outcome2)) {
			expect(outcome2.failure.error).toBe("limit_reached");
			// Renamed with the Settings row (2cc93e1ad).
			expect(outcome2.failure.next).toContain("Agent-started threads → A day");
		}
	});

	it("passes delegate useDefault from HARNESS setting to threads.start, but args.agent wins over it", async () => {
		await settings.set({ agentsStartThreads: "allow", depth: 3, children: 10, perTree: 10, turnsPerDay: 100 });
		const root = await thread({ harness: "claude-code", model: "claude-3-7-sonnet" });

		// Save delegate default in HARNESS setting row
		await prisma.setting.upsert({
			where: { key: "HARNESS" },
			create: {
				key: "HARNESS",
				type: "json",
				category: "ai",
				value: JSON.stringify({
					useDefaults: {
						delegate: { harness: "codex", model: "gpt-x" },
					},
				}),
			},
			update: {
				value: JSON.stringify({
					useDefaults: {
						delegate: { harness: "codex", model: "gpt-x" },
					},
				}),
			},
		});

		// Start without agent: passes harness: "codex", model: "gpt-x"
		starts.length = 0;
		const out1 = await start(root.id, {});
		expect(isFailure(out1)).toBe(false);
		expect(starts.length).toBe(1);
		expect(starts[0]?.input).toMatchObject({
			harness: "codex",
			model: "gpt-x",
		});

		// Start with args.agent: the agent's own choice wins
		starts.length = 0;
		const out2 = await start(root.id, { role: "delegate-custom", agent: "gemini-cli", model: "gemini-2.0-flash" });
		expect(isFailure(out2)).toBe(false);
		expect(starts.length).toBe(1);
		expect(starts[0]?.input).toMatchObject({
			harness: "gemini-cli",
			model: "gemini-2.0-flash",
		});
	});
});
