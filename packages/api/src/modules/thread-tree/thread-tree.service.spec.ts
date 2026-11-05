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

/** ThreadsService.start as far as the tree sees it: one row, placed in its tree. */
const starts: { input: Record<string, unknown>; tree: Record<string, unknown> }[] = [];
const threads = {
	start: vi.fn(async (input: Record<string, unknown>, tree: { parentId: string; rootId: string; role: string; depth: number; title: string; actionId: string; at?: (r: { url: string }) => string | undefined }) => {
		starts.push({ input, tree });
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
		role: "db",
		brief: "Find why the db pool is exhausted; return the cause.",
		workspace: { kind: "same_project_fresh" },
		requestId: randomUUID(),
		...over,
	};
	return actions.gate({ callerId, rootId: callerId, tool: "thread_start", args, requestId: args.requestId as string });
};

/** The gate as the gateway calls it: the caller's real root. */
async function startIn(callerId: string, over: Record<string, unknown> = {}) {
	const t = await tree.tree(callerId);
	const args = {
		title: "Check the db",
		role: `r${randomUUID().slice(0, 6)}`,
		brief: "Find why the db pool is exhausted; return the cause.",
		workspace: { kind: "same_project_fresh" },
		requestId: randomUUID(),
		...over,
	};
	return actions.gate({ callerId, rootId: t?.rootId ?? callerId, tool: "thread_start", args, requestId: args.requestId as string });
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
	for (const m of ["threadMessage", "threadWait", "pendingAction", "treeAllowance", "proposal", "investigationEvent", "setting"] as const)
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

describe("thread_start behind the host's approval (#1024 spec F)", () => {
	it("Given Allow within limits, Then it starts a child at once, makes the caller a root, and records it on the parent", async () => {
		await settings.set({ agentsStartThreads: "allow", depth: 2, children: 4, perTree: 10 });
		const root = await thread();
		const v = value(await start(root.id));
		expect(v).toMatchObject({ status: "started", role: "db", number: 2, link: `/threads/${v.childId}` });
		const child = await prisma.investigation.findUniqueOrThrow({ where: { id: v.childId as string } });
		expect(child).toMatchObject({ parentId: root.id, rootId: root.id, role: "db", depth: 1 });
		expect((await prisma.investigation.findUniqueOrThrow({ where: { id: root.id } })).rootId).toBe(root.id);
		expect((await events(root.id)).map((e) => e.kind)).toEqual(["thread_started"]);
		// The brief is the child's only context, behind the roster.
		expect(starts[0]?.input.text).toMatch(/^You are "db", #2 in a tree/);
		expect(starts[0]?.input.text).toContain("Find why the db pool is exhausted");
	});

	it("Given the same requestId twice, Then one thread starts and the retry gets the same answer", async () => {
		await settings.set({ agentsStartThreads: "allow", depth: 2, children: 4, perTree: 10 });
		const root = await thread();
		const a = value(await start(root.id, { requestId: "r1" }));
		const b = value(await start(root.id, { requestId: "r1" }));
		expect(b.childId).toBe(a.childId);
		expect(starts).toHaveLength(1);
	});

	it("Given an incident's thread, Then its child is about the incident's service, never the incident", async () => {
		await settings.set({ agentsStartThreads: "allow", depth: 2, children: 4, perTree: 10 });
		const service = await prisma.service.create({ data: { name: `svc-${randomUUID()}` } });
		const incident = await prisma.incident.create({
			data: { number: Math.floor(Math.random() * 1e6), title: "boom", severity: "high", serviceId: service.id },
		});
		const root = await thread({ incidentId: incident.id, kind: "investigation" });
		const v = value(await start(root.id));
		expect(starts[0]?.input.subject).toEqual({ kind: "service", serviceId: service.id });
		const child = await prisma.investigation.findUniqueOrThrow({ where: { id: v.childId as string } });
		expect(child.incidentId).toBeNull();
		await prisma.investigation.deleteMany({ where: { incidentId: incident.id } });
		await prisma.incident.delete({ where: { id: incident.id } });
	});

	it("Given a wider access than the parent's, Then the child is clamped to the parent's and told so", async () => {
		await settings.set({ agentsStartThreads: "allow", depth: 2, children: 4, perTree: 10 });
		const root = await thread({ accessLevel: "auto-edits" });
		const v = value(await start(root.id, { access: "full-access" }));
		expect(v.access).toBe("auto-edits");
		expect(v.note).toMatch(/clamped/);
		expect(starts[0]?.input.accessLevel).toBe("auto-edits");
	});

	it("Given each cap, Then the start refuses with limit_reached and names its Settings row", async () => {
		await settings.set({ agentsStartThreads: "allow", depth: 1, children: 1, perTree: 3 });
		const root = await thread();
		const child = value(await startIn(root.id));
		const depth = await startIn(child.childId as string);
		expect(isFailure(depth) && depth.failure).toMatchObject({ error: "limit_reached", next: expect.stringContaining("Thread depth") });
		const children = await startIn(root.id);
		expect(isFailure(children) && children.failure).toMatchObject({ error: "limit_reached", next: expect.stringContaining("Children per thread") });
		await settings.set({ agentsStartThreads: "allow", depth: 2, children: 5, perTree: 2 });
		const perTree = await startIn(root.id);
		expect(isFailure(perTree) && perTree.failure).toMatchObject({ error: "limit_reached", next: expect.stringContaining("Threads per tree") });
	});

	it("Given Never, Then it refuses as disabled", async () => {
		await settings.set({ agentsStartThreads: "never", depth: 2, children: 4, perTree: 10 });
		const root = await thread();
		const r = await start(root.id);
		expect(isFailure(r) && r.failure.error).toBe("disabled");
	});

	it("Given Ask each time, Then it answers pending_approval and opens one host-only card from the tool", async () => {
		const root = await thread();
		const v = value(await start(root.id, { requestId: "r1" }));
		expect(v).toMatchObject({ status: "pending_approval", next: expect.stringContaining("Do not poll") });
		const [open] = await asks.pending(root.id);
		expect(open).toMatchObject({ requiresHost: true, source: { kind: "tool", tool: "thread_start", requestId: "r1" }, kind: "permission" });
		expect(starts).toHaveLength(0);
		// A retry while it waits opens no second card.
		value(await start(root.id, { requestId: "r1" }));
		expect(await asks.pending(root.id)).toHaveLength(1);
	});

	it("Given an approval, Then the child starts and the caller hears it at its next pause", async () => {
		const root = await thread();
		live.add(root.id);
		value(await start(root.id, { requestId: "r1" }));
		const [open] = await asks.pending(root.id);
		await asks.decide(open?.askId as string, "approve");
		expect(starts).toHaveLength(1);
		expect(sent.find((m) => m.id === root.id)?.text).toMatch(/thread_start call \(requestId "r1"\) was approved: started db #2, \/threads\//);
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

	it("Given Allow for this thread tree, Then later starts in the tree run at once, until it is revoked", async () => {
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

	it("Given a crash after the child was made, Then running the action again finds that child", async () => {
		const root = await thread();
		value(await start(root.id));
		const [open] = await asks.pending(root.id);
		await asks.decide(open?.askId as string, "approve");
		const row = await prisma.pendingAction.findFirstOrThrow();
		await prisma.pendingAction.update({ where: { id: row.id }, data: { state: "executing" } });
		await actions.execute(row.id);
		expect(starts).toHaveLength(1);
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
		await settings.set({ agentsStartThreads: "never", depth: 2, children: 4, perTree: 10 });
		await asks.decide(open?.askId as string, "approve");
		expect(starts).toHaveLength(0);
		expect((await prisma.pendingAction.findFirstOrThrow()).state).toBe("failed");
		expect(sent[0]?.text).toMatch(/did not run: The user turned off starting threads/);
	});

	it("Given a cap filled before approval, Then the approved action fails with limit_reached", async () => {
		await settings.set({ agentsStartThreads: "ask", depth: 2, children: 1, perTree: 10 });
		const root = await thread();
		value(await start(root.id, { role: "a" }));
		value(await start(root.id, { role: "b" }));
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

describe("messages, roster and wake on finish (#1024 spec F)", () => {
	async function family() {
		await settings.set({ agentsStartThreads: "allow", depth: 2, children: 4, perTree: 10 });
		const root = await thread();
		const a = value(await start(root.id, { role: "api" }));
		const b = value(await start(root.id, { role: "db" }));
		return { root: root.id, api: a.childId as string, db: b.childId as string };
	}

	it("lists the roster with each member's relation, and tells running siblings who joined", async () => {
		const f = await family();
		const roster = await tree.roster(f.api);
		expect(roster?.members.map((m) => [m.role, m.relation])).toEqual([
			["root", "parent"],
			["api", "you"],
			["db", "sibling"],
		]);
		const joined = await prisma.threadMessage.findFirstOrThrow({ where: { toId: f.api } });
		expect(joined.text).toMatch(/^db #3 joined the tree/);
	});

	it("delivers a typed message at the receiver's next pause, records both ends, and never twice for one requestId", async () => {
		const f = await family();
		live.add(f.db);
		await prisma.threadMessage.deleteMany();
		const r = value(await tree.send(f.api, { to: "db", type: "fact", text: "the pool is 10", mode: "queue", requestId: "m1" }));
		expect(r.status).toBe("delivered");
		expect(sent.at(-1)).toMatchObject({ id: f.db, text: "[FROM api #2] fact: the pool is 10", mode: "queue" });
		value(await tree.send(f.api, { to: "db", type: "fact", text: "the pool is 10", mode: "queue", requestId: "m1" }));
		expect(await prisma.threadMessage.count()).toBe(1);
		const sentEv = (await events(f.api)).find((e) => e.kind === "thread_message");
		const gotEv = (await events(f.db)).find((e) => e.kind === "thread_message");
		expect(sentEv).toMatchObject({ direction: "sent", peerRole: "db", type: "fact" });
		expect(gotEv).toMatchObject({ direction: "received", peerRole: "api", messageId: expect.any(String) });
	});

	it("lets only a parent's blocker to its own child steer", async () => {
		const f = await family();
		live.add(f.db);
		const sib = await tree.send(f.api, { to: "db", type: "blocker", text: "stop", mode: "steer", requestId: "s1" });
		expect(isFailure(sib) && sib.failure.error).toBe("invalid_input");
		const parent = await tree.send(f.root, { to: "db", type: "fact", text: "x", mode: "steer", requestId: "s2" });
		expect(isFailure(parent)).toBe(true);
		value(await tree.send(f.root, { to: "db", type: "blocker", text: "wrong table", mode: "steer", requestId: "s3" }));
		expect(sent.at(-1)).toMatchObject({ id: f.db, mode: "now" });
	});

	it("refuses a member outside the tree", async () => {
		const f = await family();
		const other = await thread();
		const r = await tree.send(f.api, { to: other.id, type: "fact", text: "x", mode: "queue", requestId: "o1" });
		expect(isFailure(r) && r.failure.error).toBe("not_found");
	});

	async function finish(id: string, summary = "The pool is too small.") {
		await prisma.investigation.update({ where: { id }, data: { status: "completed", completedAt: new Date(), summary } });
	}

	it("wakes a live parent with the child's result", async () => {
		const f = await family();
		live.add(f.root);
		await finish(f.api);
		await tree.tick();
		expect(sent.find((m) => m.id === f.root && m.text.includes("finished: answered"))?.text).toContain("The pool is too small.");
		expect((await events(f.root)).find((e) => e.kind === "child_finished")).toMatchObject({ outcome: "answered", role: "api" });
	});

	it("reopens an ended parent that waits on the child, once every awaited child has finished", async () => {
		const f = await family();
		value(await tree.wait(f.root, ["api", "db"], "all"));
		await prisma.investigation.update({ where: { id: f.root }, data: { status: "completed" } });
		await finish(f.api);
		await tree.tick();
		expect(resumed).toHaveLength(0);
		await finish(f.db);
		await tree.tick();
		expect(resumed.map((r) => r.id)).toContain(f.root);
	});

	it("records a result on an ended parent that did not wait, without reopening it", async () => {
		const f = await family();
		await prisma.investigation.update({ where: { id: f.root }, data: { status: "completed" } });
		await finish(f.api);
		await tree.tick();
		expect(resumed).toHaveLength(0);
		const result = await prisma.threadMessage.findFirstOrThrow({ where: { type: "result" } });
		expect(result.state).toBe("queued");
		expect((await events(f.root)).some((e) => e.kind === "child_finished")).toBe(true);
	});

	it("moves a wait on a pending start onto the thread it starts", async () => {
		const root = await thread();
		value(await start(root.id, { requestId: "r9" }));
		value(await tree.wait(root.id, ["r9"], "all"));
		const [open] = await asks.pending(root.id);
		await asks.decide(open?.askId as string, "approve");
		const child = await prisma.investigation.findFirstOrThrow({ where: { parentId: root.id } });
		expect(await prisma.threadWait.findMany()).toMatchObject([{ waiterId: root.id, targetId: child.id }]);
	});

	it("serves the panel's tree with states, unread counts and links", async () => {
		const f = await family();
		const t = await tree.tree(f.db);
		expect(t?.rootId).toBe(f.root);
		expect(t?.nodes.map((n) => [n.number, n.role, n.state])).toEqual([
			[1, null, "running"],
			[2, "api", "queued"],
			[3, "db", "queued"],
		]);
		expect(t?.nodes[1]?.unread).toBe(1);
	});

	it("cancels a child as the Stop button does, and only a descendant", async () => {
		const f = await family();
		const sib = await actions.gate({ callerId: f.api, rootId: f.root, tool: "thread_cancel", args: { id: "db", reason: "dup", requestId: "c0" }, requestId: "c0" });
		expect(isFailure(sib) && sib.failure.error).toBe("not_found");
		value(await actions.gate({ callerId: f.root, rootId: f.root, tool: "thread_cancel", args: { id: "db", reason: "replaced", requestId: "c1" }, requestId: "c1" }));
		expect(dispatch.cancelPendingJob).toHaveBeenCalledWith(f.db);
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
