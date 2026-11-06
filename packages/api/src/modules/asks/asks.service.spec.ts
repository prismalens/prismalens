// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import { AskConflict, AskForbidden } from "./asks.contract.js";
import { AskInvalid, AsksService, TOOL_ASK_BRANCH } from "./asks.service.js";

const THREAD = "6a3b1c2d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const HOST = { host: true, via: "session" as const };
const DEVICE = { host: false, via: "device" as const };
const approve = { kind: "permission", decision: "approve" } as const;

type Row = {
	askId: string;
	threadId: string;
	ask: string;
	status: string;
	outcome: string | null;
	answer: string | null;
	openedAt: Date;
	closedAt: Date | null;
};

/**
 * A durable store shared across service instances (a second instance is a restart).
 * Like the real log, a second event at the same (branch, seq) is refused (P2002) or,
 * through appendEvents, dropped as a duplicate; reads yield, so writers interleave.
 */
function store(events: CanonicalEvent[] = []) {
	const rows = new Map<string, Row>();
	const log: CanonicalEvent[] = [...events];
	const pushes: unknown[] = [];
	const tick = () => new Promise((r) => setTimeout(r, 0));
	const taken = (e: CanonicalEvent) =>
		log.some((x) => x.seq === e.seq && "branchId" in x && "branchId" in e && x.branchId === e.branchId);
	const maxSeq = async () => {
		await tick();
		return log.reduce((m, e) => Math.max(m, e.seq), -1);
	};
	const toolAsk = (staged: (() => void)[]) => ({
		create: vi.fn(async ({ data }: { data: Pick<Row, "askId" | "threadId" | "ask" | "status"> }) => {
			const row = { ...data, outcome: null, answer: null, openedAt: new Date(), closedAt: null };
			staged.push(() => rows.set(data.askId, row));
			return row;
		}),
		findUnique: vi.fn(async ({ where }: { where: { askId: string } }) => {
			const r = rows.get(where.askId);
			return r ? { ...r } : null;
		}),
		findMany: vi.fn(async ({ where }: { where: { threadId: string; status: string } }) =>
			[...rows.values()].filter((r) => r.threadId === where.threadId && r.status === where.status),
		),
		updateMany: vi.fn(
			async ({ where, data }: { where: { askId: string; status: string }; data: Partial<Row> }) => {
				const r = rows.get(where.askId);
				if (!r || r.status !== where.status) return { count: 0 };
				staged.push(() => Object.assign(r, data));
				return { count: 1 };
			},
		),
	});
	const direct = toolAsk([]);
	// Outside a transaction a write lands at once.
	direct.create = vi.fn(async ({ data }) => {
		const row = { ...data, outcome: null, answer: null, openedAt: new Date(), closedAt: null };
		rows.set(data.askId, row);
		return row;
	});
	const prisma = {
		investigation: { findUnique: vi.fn(async () => ({ id: THREAD })) },
		investigationEvent: {
			findFirst: vi.fn(async ({ where }: { where: { event: { contains: string } } }) =>
				log.some((e) => JSON.stringify(e).includes(where.event.contains)) ? { investigationId: THREAD } : null,
			),
		},
		toolAsk: direct,
		$transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
			const staged: (() => void)[] = [];
			const events: CanonicalEvent[] = [];
			const tx = {
				toolAsk: { ...toolAsk(staged), findUnique: direct.findUnique },
				investigationEvent: {
					aggregate: vi.fn(async () => ({ _max: { seq: (await maxSeq()) < 0 ? null : await maxSeq() } })),
					create: vi.fn(async ({ data }: { data: { event: string } }) => {
						events.push(JSON.parse(data.event));
					}),
				},
				pushOutbox: { create: vi.fn(async (a: unknown) => staged.push(() => pushes.push(a))) },
			};
			const out = await fn(tx);
			// Commit: a seq a concurrent writer took first fails the whole transaction.
			if (events.some(taken)) throw Object.assign(new Error("unique"), { code: "P2002" });
			log.push(...events);
			for (const apply of staged) apply();
			return out;
		}),
	};
	const investigations = {
		allEvents: vi.fn(async () => log),
		lastEventSeq: vi.fn(maxSeq),
		appendEvents: vi.fn(async (_id: string, es: CanonicalEvent[]) => {
			for (const e of es) if (!taken(e)) log.push(e);
		}),
	};
	const bus = { publish: vi.fn(() => 1) };
	const dispatch = { answerAsk: vi.fn(() => ({ outcome: "approved" as const })) };
	const make = () => new AsksService(prisma as never, dispatch as never, investigations as never, bus as never);
	return { make, rows, log, dispatch, bus, pushes };
}

const toolAsk = {
	kind: "permission" as const,
	requiresHost: false,
	source: { kind: "tool" as const, tool: "act", requestId: "r1" },
	title: "Restart checkout-api",
	permission: { toolKind: "execute", options: [] },
};

describe("AsksService (#1024)", () => {
	it("a tool's ask is recorded out of run: a row, and ask_opened on the asks branch, live stream told", async () => {
		const { make, rows, log, bus } = store();
		const svc = make();
		const askId = await svc.open(THREAD, toolAsk);
		expect(rows.get(askId)?.status).toBe("open");
		expect(log.at(-1)).toMatchObject({
			kind: "ask_opened",
			branchId: TOOL_ASK_BRANCH,
			ask: { askId, requiresHost: true },
		});
		expect(bus.publish).toHaveBeenCalled();
		expect((await svc.pending(THREAD)).map((a) => a.askId)).toEqual([askId]);
	});

	it("concurrent asks each record their event: no seq is shared, none is dropped, each owes a push", async () => {
		const { make, log, pushes } = store();
		const svc = make();
		const ids = await Promise.all(
			Array.from({ length: 5 }, (_, i) =>
				svc.open(THREAD, { ...toolAsk, source: { kind: "tool" as const, tool: "act", requestId: `r${i}` } }),
			),
		);
		const opened = log.filter((e) => e.kind === "ask_opened");
		expect(opened.map((e) => (e.kind === "ask_opened" ? e.ask.askId : "")).sort()).toEqual([...ids].sort());
		expect(new Set(opened.map((e) => e.seq)).size).toBe(5);
		expect(pushes).toHaveLength(5);
	});

	it("outlives the run and a restart: a new instance lists it, and the host answers it with no run live", async () => {
		const { make, log, dispatch } = store();
		const askId = await make().open(THREAD, toolAsk);
		const afterRestart = make();
		expect((await afterRestart.get(askId))?.closed).toBeNull();
		expect((await afterRestart.pending(THREAD)).map((a) => a.askId)).toEqual([
			askId,
		]);
		const closed = await afterRestart.answer(THREAD, askId, approve, HOST);
		expect(closed).toMatchObject({ outcome: "approved", answer: approve });
		expect(dispatch.answerAsk).not.toHaveBeenCalled();
		expect(log.at(-1)).toMatchObject({
			kind: "ask_closed",
			askId,
			outcome: "approved",
		});
		expect((await afterRestart.get(askId))?.closed?.outcome).toBe("approved");
		await expect(
			afterRestart.answer(THREAD, askId, approve, HOST),
		).rejects.toBeInstanceOf(AskConflict);
	});

	it("refuses a paired device, a push link and a run's bearer on a tool's ask", async () => {
		const { make } = store();
		const svc = make();
		const askId = await svc.open(THREAD, toolAsk);
		for (const by of [
			DEVICE,
			{ host: false, via: "push" as const },
			{ host: true, via: "run" as const },
		])
			await expect(svc.answer(THREAD, askId, approve, by)).rejects.toBeInstanceOf(
				AskForbidden,
			);
		expect((await svc.get(askId))?.closed).toBeNull();
	});

	it("a tree answer is only for a tool's ask; an answer of the wrong kind is refused", async () => {
		const { make } = store();
		const svc = make();
		await expect(
			svc.answer(THREAD, "agent-ask", { ...approve, scope: "tree" }, HOST),
		).rejects.toBeInstanceOf(AskInvalid);
		const askId = await svc.open(THREAD, toolAsk);
		await expect(
			svc.answer(THREAD, askId, { kind: "input", values: {} }, HOST),
		).rejects.toBeInstanceOf(AskInvalid);
		await expect(
			svc.answer(THREAD, askId, { ...approve, scope: "tree" }, HOST),
		).resolves.toMatchObject({ outcome: "approved" });
	});

	it("close() is idempotent, runs onClosed once, and a secret's value is never kept", async () => {
		const { make, rows } = store();
		const svc = make();
		const askId = await svc.open(THREAD, toolAsk);
		const heard: unknown[] = [];
		svc.onClosed(askId, (c) => heard.push(c));
		await vi.waitFor(() => expect(heard).toHaveLength(0));
		expect(await svc.close(askId, "stopped")).toMatchObject({
			outcome: "stopped",
		});
		expect((await svc.close(askId, "expired"))?.outcome).toBe("stopped");
		expect(heard).toHaveLength(1);
		const late: unknown[] = [];
		svc.onClosed(askId, (c) => late.push(c));
		await vi.waitFor(() => expect(late).toHaveLength(1));
		expect(
			await svc.close("0b3c2f1e-1111-4222-8333-444455556666", "stopped"),
		).toBeNull();

		const secret = await svc.open(THREAD, {
			...toolAsk,
			kind: "secret",
			permission: undefined,
		});
		await expect(
			svc.answer(THREAD, secret, { kind: "decline" }, HOST),
		).rejects.toBeInstanceOf(AskInvalid);
		await svc.close(secret, "stopped");
		expect(rows.get(secret)?.answer).toBeNull();
	});

	it("a tool's ask past its expiresAt closes as expired on the next read", async () => {
		const { make } = store();
		const svc = make();
		const askId = await svc.open(THREAD, {
			...toolAsk,
			expiresAt: "2020-01-01T00:00:00.000Z",
		});
		expect(await svc.pending(THREAD)).toEqual([]);
		expect((await svc.get(askId))?.closed?.outcome).toBe("expired");
	});

	it("an agent's ask goes straight to its run; a second answer is a conflict; a legacy ask is read back", async () => {
		const ts = "2026-11-07T10:00:00.000Z";
		const legacy = "8c8b1c0e-0d55-4f27-9f0a-3e7d1d1b6b11";
		const { make, dispatch } = store([
			{
				runId: THREAD,
				branchId: "run",
				path: [],
				label: null,
				ts,
				kind: "permission_ask",
				seq: 1,
				askId: legacy,
				title: "Run kubectl",
				detail: null,
				toolKind: "execute",
				expiresAt: ts,
			},
		] as CanonicalEvent[]);
		const svc = make();
		expect((await svc.pending(THREAD)).map((a) => a.askId)).toEqual([legacy]);
		expect(await svc.get(legacy)).toMatchObject({
			ask: { title: "Run kubectl" },
			closed: null,
		});
		await expect(
			svc.answer(THREAD, legacy, approve, DEVICE),
		).resolves.toMatchObject({ outcome: "approved" });
		dispatch.answerAsk.mockReturnValueOnce(null as never);
		await expect(
			svc.answer(THREAD, legacy, approve, DEVICE),
		).rejects.toBeInstanceOf(AskConflict);
		await expect(
			svc.answer(THREAD, legacy, approve, { host: true, via: "run" }),
		).rejects.toBeInstanceOf(AskForbidden);
		expect(await svc.get("0b3c2f1e-1111-4222-8333-444455556666")).toBeNull();
	});

	it("an answer the agent's form refuses is a 400 and the ask stays open, not a 409", async () => {
		const { make, dispatch } = store();
		dispatch.answerAsk.mockReturnValueOnce("invalid" as never);
		await expect(
			make().answer(THREAD, "q1", { kind: "input", values: { hours: 0 } }, DEVICE),
		).rejects.toBeInstanceOf(AskInvalid);
	});
});

