// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PendingAsk } from "@prismalens/contracts";
import { describe, expect, it, vi } from "vitest";
import { AskConflict, AskForbidden } from "../asks/asks.contract.js";
import { askQuestions, askTools } from "../gateway/tools/asks.js";
import { answerText, secretNameRefusal, ToolAsksService } from "./tool-asks.service.js";

const THREAD = "6a3b1c2d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ASK = "0b3c2f1e-1111-4222-8333-444455556666";

const question: PendingAsk = {
	askId: ASK,
	threadId: THREAD,
	kind: "question",
	requiresHost: true,
	source: { kind: "tool", tool: "pl_ask_user", requestId: ASK },
	title: "Roll back?",
	openedAt: new Date().toISOString(),
	questions: askQuestions([
		{
			question: "Roll back?",
			multiSelect: true,
			options: [{ label: "Yes" }, { label: "No", description: "Keep it" }],
		},
	]),
};

describe("pl_ask_user and pl_secret_request, their seams (#1024 spec B)", () => {
	it("Given an answer, Then the agent hears each question with the labels picked and any Other; an unanswered one says how it ended", () => {
		expect(
			answerText({
				ask: question,
				outcome: "answered",
				answer: { kind: "question", answers: { q1: { options: ["o1", "o2"], other: "both" } } },
				closedAt: "",
			}),
		).toBe("The user answered your question (pl_ask_user):\n- Roll back? → Yes; No; Other: both");
		expect(answerText({ ask: question, outcome: "expired", closedAt: "" })).toContain("was not answered: expired");
	});

	it("Given a variable name, Then only one shaped like an env var that PrismaLens does not set itself is taken", () => {
		expect(secretNameRefusal("BOOKS_API_TOKEN")).toBeNull();
		expect(secretNameRefusal("books token")).toMatch(/environment variable/);
		for (const own of ["PATH", "HOME", "PRISMALENS_DB_URL", "GIT_ASKPASS", "GH_TOKEN"])
			expect(secretNameRefusal(own), own).toMatch(/PrismaLens sets itself/);
	});

	it("Given a secret answer, Then a paired device is refused, an unknown request is a conflict, and a closed one never stores a value", async () => {
		const prisma = {
			secretRequested: {
				findUnique: vi.fn(async () => ({ investigationId: THREAD, requestId: ASK, name: "X_TOKEN" })),
			},
			$transaction: vi.fn(),
		};
		const asks = { get: vi.fn(async () => ({ ask: question, closed: { outcome: "expired" } })) };
		const svc = new ToolAsksService(prisma as never, asks as never, {} as never, {} as never, {} as never);
		await expect(svc.answerSecret(THREAD, ASK, "v", false)).rejects.toBeInstanceOf(AskForbidden);
		await expect(svc.answerSecret("other-thread", ASK, "v", true)).rejects.toBeInstanceOf(AskConflict);
		await expect(svc.answerSecret(THREAD, ASK, "v", true)).rejects.toBeInstanceOf(AskConflict);
		expect(prisma.$transaction).not.toHaveBeenCalled();
	});

	it("Given the tools, Then each is an ask, pl_ask_user is left to agents that elicit, and a refusal comes back in the failure contract", async () => {
		const data = {
			question: vi.fn(async () => ({ error: "This run is gone." })),
			secret: vi.fn(async () => ({ error: "PATH is one PrismaLens sets itself; pick another name." })),
		};
		const [ask, secret] = askTools(data);
		expect(ask?.effect).toBe("ask");
		expect(ask?.serves).toMatchObject({ attended: true, notFor: ["claude-code", "codex"] });
		expect(secret?.serves.notFor).toBeUndefined();
		const ctx = { runId: THREAD, signal: new AbortController().signal };
		expect(
			await ask?.run({ questions: [{ question: "Q?", multiSelect: false, options: [{ label: "A" }, { label: "B" }] }] }, ctx),
		).toMatchObject({ failure: { error: "run_ended" } });
		expect(await secret?.run({ name: "PATH", reason: "r" }, ctx)).toMatchObject({
			failure: { error: "invalid_input" },
		});
		expect(ask?.input.safeParse({ questions: [{ question: "Q?", options: [{ label: "only one" }] }] }).success).toBe(false);
		expect(
			ask?.input.safeParse({
				questions: [{ question: "Q?", options: [{ label: "A", preview: "x".repeat(4_001) }, { label: "B" }] }],
			}).success,
		).toBe(false);
	});

	it("Given a secret request, Then its ask expires like a question, so it never waits for good", async () => {
		const open = vi.fn(async () => ASK);
		const prisma = {
			secretRequested: { create: vi.fn(async () => ({})) },
			setting: { findUnique: vi.fn(async () => ({ value: "5" })) },
		};
		const svc = new ToolAsksService(
			prisma as never,
			{ open } as never,
			{} as never,
			{ findById: vi.fn(async () => ({ id: THREAD })) } as never,
			{} as never,
		);
		const before = Date.now();
		await svc.secret(THREAD, { name: "X_TOKEN", reason: "r" });
		const expiresAt = Date.parse((open.mock.calls[0] as unknown as [string, { expiresAt?: string }])[1].expiresAt ?? "");
		expect(expiresAt - before).toBeGreaterThanOrEqual(5 * 60_000 - 1_000);
		expect(expiresAt - before).toBeLessThanOrEqual(5 * 60_000 + 1_000);
	});

	/** The service over fakes: a thread in `status`, asks that close when told, and a dispatch that records. */
	function wired(status: string, send: "queued" | "conflict" | null = "queued") {
		const closers = new Map<string, (c: unknown) => void>();
		const asks = {
			open: vi.fn(async () => ASK),
			onClosed: vi.fn((id: string, fn: (c: unknown) => void) => closers.set(id, fn)),
			get: vi.fn(async () => ({ ask: question, closed: null })),
			close: vi.fn(async () => null),
		};
		const dispatch = {
			sendMessage: vi.fn(() => send),
			resumeInvestigation: vi.fn(async () => true),
		};
		const tx = { secretRequested: { updateMany: vi.fn(async () => ({ count: 1 })), deleteMany: vi.fn(async () => ({})) } };
		const prisma = {
			toolAsk: {
				findMany: vi.fn(async () => [
					{ askId: "a-user", ask: JSON.stringify(question) },
					{ askId: "a-other", ask: JSON.stringify({ ...question, source: { kind: "agent" } }) },
				]),
			},
			setting: { findUnique: vi.fn(async () => null) },
			secretRequested: {
				create: vi.fn(async () => ({})),
				findUnique: vi.fn(async () => ({ investigationId: THREAD, requestId: ASK, name: "X_TOKEN" })),
			},
			$transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
		};
		const investigations = { findById: vi.fn(async (id: string) => (id === THREAD ? { id, status } : null)) };
		const credentials = { encryptToBase64: vi.fn(() => "enc") };
		const svc = new ToolAsksService(prisma as never, asks as never, dispatch as never, investigations as never, credentials as never);
		const close = (id: string, outcome: string) =>
			closers.get(id)?.({ ask: question, outcome, ...(outcome === "answered" ? { answer: { kind: "question", answers: { q1: { options: ["o1"] } } } } : {}), closedAt: "" });
		return { svc, asks, dispatch, tx, prisma, close };
	}
	const settle = () => new Promise((r) => setTimeout(r, 0));

	it("Given a question to a live run, Then its answer is queued as a message; a finished run is continued only for an answer", async () => {
		const live = wired("running");
		expect(await live.svc.question(THREAD, question.questions ?? [])).toMatchObject({ askId: expect.any(String) });
		const askId = (live.asks.open.mock.calls[0] as unknown as [string, { askId: string }])[1].askId;
		live.close(askId, "answered");
		await settle();
		expect(live.dispatch.sendMessage).toHaveBeenCalledWith(THREAD, expect.stringContaining("→ Yes"), "queue", [], undefined, expect.any(String));
		expect(live.dispatch.resumeInvestigation).not.toHaveBeenCalled();

		const done = wired("completed");
		await done.svc.question(THREAD, question.questions ?? []);
		const id = (done.asks.open.mock.calls[0] as unknown as [string, { askId: string }])[1].askId;
		done.close(id, "expired");
		await settle();
		expect(done.dispatch.resumeInvestigation).not.toHaveBeenCalled();
		const again = wired("completed");
		await again.svc.question(THREAD, question.questions ?? []);
		again.close((again.asks.open.mock.calls[0] as unknown as [string, { askId: string }])[1].askId, "answered");
		await settle();
		expect(again.dispatch.resumeInvestigation).toHaveBeenCalledWith(THREAD, expect.any(String), "queue", "chat");
	});

	it("Given a live run that ended between the read and the send, Then the answer continues it instead", async () => {
		const h = wired("running", "conflict");
		await h.svc.question(THREAD, question.questions ?? []);
		h.close((h.asks.open.mock.calls[0] as unknown as [string, { askId: string }])[1].askId, "answered");
		await settle();
		expect(h.dispatch.resumeInvestigation).toHaveBeenCalled();
	});

	it("Given a restart, Then an pl_ask_user still open hears its answer again and other asks are left alone", async () => {
		const h = wired("running");
		await h.svc.onModuleInit();
		expect(h.asks.onClosed.mock.calls.map((c) => c[0])).toEqual(["a-user"]);
	});

	it("Given a gone run, Then neither tool opens an ask", async () => {
		const h = wired("running");
		expect(await h.svc.question("gone", question.questions ?? [])).toEqual({ error: "This run is gone." });
		expect(await h.svc.secret("gone", { name: "X_TOKEN", reason: "r" })).toEqual({ error: "This run is gone." });
		expect(await h.svc.secret(THREAD, { name: "PATH", reason: "r" })).toMatchObject({ error: expect.stringContaining("sets itself") });
		expect(h.asks.open).not.toHaveBeenCalled();
	});

	it("Given the user's secret, Then it is stored encrypted, older values for the name go, the ask closes answered and the agent is told the name only", async () => {
		const h = wired("completed");
		await h.svc.answerSecret(THREAD, ASK, "s3cret", true);
		expect(h.tx.secretRequested.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ valueEnc: "enc" }) }));
		expect(h.tx.secretRequested.deleteMany).toHaveBeenCalled();
		expect(h.asks.close).toHaveBeenCalledWith(ASK, "answered");
		const told = (h.dispatch.resumeInvestigation.mock.calls[0] as unknown as [string, string])[1];
		expect(told).toContain("X_TOKEN");
		expect(told).not.toContain("s3cret");
		h.tx.secretRequested.updateMany.mockResolvedValueOnce({ count: 0 });
		await expect(h.svc.answerSecret(THREAD, ASK, "s3cret", true)).rejects.toThrow(/no longer waiting/);
	});
});

