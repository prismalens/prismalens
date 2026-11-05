// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { pendingAsks, projectAsks } from "./ask-projection.js";
import {
	AnswerAskSchema,
	AskAnswerSchema,
	answerRequiresHost,
	PendingAskSchema,
	toAskAnswer,
} from "./asks.js";
import { type CanonicalEvent, CanonicalEventSchema } from "./investigation.js";

const THREAD = "6a3b1c2d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ASK = "0b3c2f1e-1111-4222-8333-444455556666";
const LEGACY = "8c8b1c0e-0d55-4f27-9f0a-3e7d1d1b6b11";
const base = {
	runId: THREAD,
	branchId: "run",
	path: [],
	label: null,
	ts: "2026-11-07T10:00:00.000Z",
};

const question = {
	askId: ASK,
	threadId: THREAD,
	kind: "question" as const,
	requiresHost: false,
	source: { kind: "agent" as const },
	title: "Which environment?",
	openedAt: base.ts,
	questions: [
		{
			id: "env",
			prompt: "Which environment?",
			multiSelect: false,
			allowOther: true,
			options: [
				{ id: "staging", label: "Staging" },
				{ id: "prod", label: "Production", preview: "kubectl -n prod" },
			],
		},
	],
};

describe("PendingAsk and AskAnswer (#1024)", () => {
	it("a question ask round-trips; options are 2 to 4", () => {
		expect(PendingAskSchema.parse(question)).toEqual(question);
		const one = {
			...question,
			questions: [{ ...question.questions[0], options: [{ id: "a", label: "A" }] }],
		};
		expect(PendingAskSchema.safeParse(one).success).toBe(false);
	});

	it("each answer kind parses; a secret has no answer variant", () => {
		for (const a of [
			{ kind: "permission", decision: "deny", reason: "use staging" },
			{ kind: "permission", decision: "approve", scope: "tree" },
			{ kind: "question", answers: { env: { options: ["prod"], other: "and canary" } } },
			{ kind: "input", values: { name: "x", n: 2, ok: true } },
			{ kind: "decline" },
		])
			expect(AskAnswerSchema.parse(a)).toEqual(a);
		expect(AskAnswerSchema.safeParse({ kind: "secret", value: "x" }).success).toBe(
			false,
		);
	});

	it("the legacy { decision, always } body still parses, as a permission answer", () => {
		const legacy = AnswerAskSchema.parse({
			askId: ASK,
			decision: "approve",
			always: true,
		});
		expect(toAskAnswer(legacy)).toEqual({
			kind: "permission",
			decision: "approve",
			scope: "always",
		});
		expect(toAskAnswer(AnswerAskSchema.parse({ askId: ASK }))).toBeNull();
		const answered = AnswerAskSchema.parse({
			askId: ASK,
			answer: { kind: "decline" },
		});
		expect(toAskAnswer(answered)).toEqual({ kind: "decline" });
	});

	it("a tool's ask, or any tree answer, needs the host", () => {
		const tool = { requiresHost: true };
		const agent = { requiresHost: false };
		expect(answerRequiresHost(tool, { kind: "decline" })).toBe(true);
		expect(
			answerRequiresHost(agent, {
				kind: "permission",
				decision: "approve",
				scope: "tree",
			}),
		).toBe(true);
		expect(
			answerRequiresHost(agent, { kind: "permission", decision: "approve" }),
		).toBe(false);
	});
});

describe("projectAsks: legacy and new events in one shape (#1024)", () => {
	const events: CanonicalEvent[] = [
		{
			...base,
			kind: "permission_ask",
			seq: 1,
			askId: LEGACY,
			title: "Run kubectl",
			detail: "kubectl get pods",
			toolKind: "execute",
			expiresAt: base.ts,
		},
		{ ...base, kind: "ask_opened", seq: 2, ask: question },
		{ ...base, kind: "permission_answer", seq: 3, askId: LEGACY, outcome: "denied" },
	].map((e) => CanonicalEventSchema.parse(e));

	it("maps a permission_ask to a permission PendingAsk and closes it with its answer", () => {
		const all = projectAsks(THREAD, events);
		expect(all.map((a) => [a.ask.askId, a.closed?.outcome ?? null])).toEqual([
			[LEGACY, "denied"],
			[ASK, null],
		]);
		expect(all[0]?.ask).toMatchObject({
			kind: "permission",
			source: { kind: "agent" },
			requiresHost: false,
			permission: { toolKind: "execute", command: "kubectl get pods", options: [] },
		});
	});

	it("pendingAsks keeps only what still waits, and ask_closed closes a new ask", () => {
		expect(pendingAsks(THREAD, events).map((a) => a.askId)).toEqual([ASK]);
		const closed = [
			...events,
			CanonicalEventSchema.parse({
				...base,
				kind: "ask_closed",
				seq: 4,
				askId: ASK,
				outcome: "answered",
				answer: { kind: "question", answers: { env: { options: ["prod"] } } },
			}),
		];
		expect(pendingAsks(THREAD, closed)).toEqual([]);
		expect(projectAsks(THREAD, closed)[1]?.closed?.answer).toEqual({
			kind: "question",
			answers: { env: { options: ["prod"] } },
		});
	});
});
