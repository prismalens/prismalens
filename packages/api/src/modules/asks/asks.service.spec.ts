// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent, PendingAsk } from "@prismalens/contracts";
import type { HeldOutcome } from "@prismalens/engine";
import { AskConflict, AskForbidden } from "./asks.contract.js";
import { AskInvalid, AsksService } from "./asks.service.js";

const THREAD = "6a3b1c2d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const HOST = { host: true, via: "session" as const };
const DEVICE = { host: false, via: "device" as const };
const approve = { kind: "permission", decision: "approve" } as const;

function setup(events: CanonicalEvent[] = []) {
	let settle!: (o: HeldOutcome) => void;
	const opened: PendingAsk[] = [];
	const dispatch = {
		openToolAsk: vi.fn((ask: PendingAsk) => {
			opened.push(ask);
			return new Promise<HeldOutcome>((r) => {
				settle = r;
			});
		}),
		answerAsk: vi.fn(() => ({ outcome: "approved" as const })),
	};
	const svc = new AsksService(
		{ investigationEvent: { findFirst: vi.fn(async () => null) } } as never,
		dispatch as never,
		{ allEvents: vi.fn(async () => events) } as never,
	);
	return { svc, dispatch, opened, settle: (o: HeldOutcome) => settle(o) };
}

const toolAsk = {
	kind: "permission" as const,
	requiresHost: false,
	source: { kind: "tool" as const, tool: "act", requestId: "r1" },
	title: "Restart checkout-api",
	permission: { toolKind: "execute", options: [] },
};

describe("AsksService (#1024)", () => {
	it("a PrismaLens tool's ask is held by the live run and always needs the host", async () => {
		const { svc, opened } = setup();
		const askId = await svc.open(THREAD, toolAsk);
		expect(opened[0]).toMatchObject({ askId, threadId: THREAD, requiresHost: true });
		expect((await svc.pending(THREAD)).map((a) => a.askId)).toEqual([askId]);
	});

	it("refuses a paired device and a run's bearer on a tool's ask; the host may answer", async () => {
		const { svc, dispatch } = setup();
		const askId = await svc.open(THREAD, toolAsk);
		await expect(svc.answer(THREAD, askId, approve, DEVICE)).rejects.toBeInstanceOf(
			AskForbidden,
		);
		await expect(
			svc.answer(THREAD, askId, approve, { host: true, via: "run" }),
		).rejects.toBeInstanceOf(AskForbidden);
		// A push link opens the app as a paired device: the same refusal.
		await expect(
			svc.answer(THREAD, askId, approve, { host: false, via: "push" }),
		).rejects.toBeInstanceOf(AskForbidden);
		expect(dispatch.answerAsk).not.toHaveBeenCalled();
		await expect(svc.answer(THREAD, askId, approve, HOST)).resolves.toMatchObject({
			outcome: "approved",
		});
	});

	it("a tree-scope answer is only for a tool's ask, and only from the host", async () => {
		const { svc } = setup();
		const tree = { ...approve, scope: "tree" } as const;
		await expect(svc.answer(THREAD, "agent-ask", tree, HOST)).rejects.toBeInstanceOf(
			AskInvalid,
		);
		const askId = await svc.open(THREAD, { ...toolAsk, kind: "question", permission: undefined });
		await expect(svc.answer(THREAD, askId, tree, DEVICE)).rejects.toBeInstanceOf(
			AskForbidden,
		);
	});

	it("an agent's ask goes straight to the run; a second answer is a conflict", async () => {
		const { svc, dispatch } = setup();
		await expect(svc.answer(THREAD, "a1", approve, DEVICE)).resolves.toMatchObject({
			outcome: "approved",
		});
		dispatch.answerAsk.mockReturnValueOnce(null as never);
		await expect(svc.answer(THREAD, "a1", approve, DEVICE)).rejects.toBeInstanceOf(
			AskConflict,
		);
	});

	it("opening with no live run is a conflict", async () => {
		const { svc, dispatch } = setup();
		dispatch.openToolAsk.mockReturnValueOnce(null as never);
		await expect(svc.open(THREAD, toolAsk)).rejects.toBeInstanceOf(AskConflict);
	});

	it("onClosed hears how a tool's ask ended, and get() reads it back; a secret's value is never kept", async () => {
		const { svc, settle, dispatch } = setup();
		const askId = await svc.open(THREAD, { ...toolAsk, kind: "secret", permission: undefined });
		const heard: unknown[] = [];
		svc.onClosed(askId, (c) => heard.push(c));
		settle({ outcome: "answered", answer: { kind: "input", values: { token: "s3cret" } } });
		await vi.waitFor(() => expect(heard).toHaveLength(1));
		expect(heard[0]).toMatchObject({ outcome: "answered" });
		expect(heard[0]).not.toHaveProperty("answer");
		const got = await svc.get(askId);
		expect(got?.closed?.outcome).toBe("answered");
		const late: unknown[] = [];
		svc.onClosed(askId, (c) => late.push(c));
		expect(late).toHaveLength(1);
		// The run no longer holds it.
		dispatch.answerAsk.mockReturnValueOnce(null as never);
		await expect(
			svc.answer(THREAD, askId, { kind: "decline" }, HOST),
		).rejects.toBeInstanceOf(AskConflict);
	});

	it("pending() and get() read stored asks, legacy and new", async () => {
		const ts = "2026-11-07T10:00:00.000Z";
		const b = { runId: THREAD, branchId: "run", path: [], label: null, ts };
		const legacy = "8c8b1c0e-0d55-4f27-9f0a-3e7d1d1b6b11";
		const events = [
			{ ...b, kind: "permission_ask", seq: 1, askId: legacy, title: "Run kubectl", detail: null, toolKind: "execute", expiresAt: ts },
		] as CanonicalEvent[];
		const { svc } = setup(events);
		expect((await svc.pending(THREAD)).map((a) => a.askId)).toEqual([legacy]);
		const lookup = new AsksService(
			{ investigationEvent: { findFirst: vi.fn(async () => ({ investigationId: THREAD })) } } as never,
			{} as never,
			{ allEvents: vi.fn(async () => events) } as never,
		);
		expect(await lookup.get(legacy)).toMatchObject({ ask: { title: "Run kubectl" }, closed: null });
		expect(await lookup.get("0b3c2f1e-1111-4222-8333-444455556666")).toBeNull();
	});

	it("close() ends a cancelled caller's tool ask once: handlers run, a late answer is refused, a second close returns the first", async () => {
		const { svc, dispatch } = setup();
		(dispatch as Record<string, unknown>).closeToolAsk = vi.fn(() => true);
		const askId = await svc.open(THREAD, toolAsk);
		const heard: unknown[] = [];
		svc.onClosed(askId, (c) => heard.push(c));
		const closed = await svc.close(askId, "stopped");
		expect(closed).toMatchObject({ outcome: "stopped", ask: { askId } });
		expect(closed).not.toHaveProperty("answer");
		expect((dispatch as unknown as { closeToolAsk: ReturnType<typeof vi.fn> }).closeToolAsk).toHaveBeenCalledWith(THREAD, askId, "stopped");
		expect(await svc.close(askId, "expired")).toBe(closed);
		expect(heard).toHaveLength(1);
		dispatch.answerAsk.mockReturnValueOnce(null as never);
		await expect(svc.answer(THREAD, askId, approve, HOST)).rejects.toBeInstanceOf(AskConflict);
		expect(await svc.close("0b3c2f1e-1111-4222-8333-444455556666", "stopped")).toBeNull();
	});
});
