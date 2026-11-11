// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import {
	cacheState,
	compactCommandOf,
	interruptedTurn,
	LIMIT_RESET_NOTE,
	limitResumeText,
	limitWakeAt,
	needsResumePrompt,
	PROVIDER_BACK_NOTE,
	registryFacts,
	resumeNoteFor,
	type SessionRow,
	threadSession,
	UNBLOCKED_NOTE,
	usedOf,
} from "./session.js";
import type { Wake } from "./wakes.service.js";

const base = { runId: "r", branchId: "run", path: [], ts: "2026-11-07T00:00:00.000Z" };
const msg = (seq: number, text: string, extra: Record<string, unknown> = {}) =>
	({ kind: "operator_message", ...base, seq, text, mode: "queue", delivered: true, ...extra }) as CanonicalEvent;

describe("the resume prompt (#1024)", () => {
	const now = new Date("2026-11-07T15:00:00Z");
	const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3_600_000).toISOString();

	it("asks for a cold session with a large context", () => {
		expect(needsResumePrompt({ cache: "cold", contextTokens: 142_000, lastActivityAt: at(0.5) }, now)).toBe(true);
	});

	it("asks for an unknown one only after an hour idle", () => {
		expect(needsResumePrompt({ cache: "unknown", contextTokens: 142_000, lastActivityAt: at(3) }, now)).toBe(true);
		expect(needsResumePrompt({ cache: "unknown", contextTokens: 142_000, lastActivityAt: at(0.5) }, now)).toBe(false);
	});

	it("never asks below the threshold, for a warm cache, or without a context reading", () => {
		expect(needsResumePrompt({ cache: "cold", contextTokens: 40_000, lastActivityAt: at(3) }, now)).toBe(false);
		expect(needsResumePrompt({ cache: "cold", contextTokens: 40_000, lastActivityAt: at(3) }, now, 30_000)).toBe(true);
		expect(needsResumePrompt({ cache: "warm", contextTokens: 142_000, lastActivityAt: at(3) }, now)).toBe(false);
		expect(needsResumePrompt({ cache: "cold", lastActivityAt: at(3) }, now)).toBe(false);
	});

	it("is unknown without a registry row", () => {
		expect(cacheState(null, new Date(0), now)).toBe("unknown");
		expect(registryFacts("not-an-agent")).toBeNull();
	});
});

describe("what a limit resume sends (#1024)", () => {
	it("the last delivered message, never PrismaLens's restart note", () => {
		expect(
			interruptedTurn([
				msg(1, "Why?"),
				msg(2, "PrismaLens restarted.", { via: { harness: "codex", model: null, accessLevel: null, restart: { stoppedAt: "a", resumedAt: "b", by: "auto" } } }),
			]),
		).toEqual({ text: "Why?", delivers: [] });
	});

	it("nothing when nobody wrote anything", () => {
		expect(interruptedTurn([])).toBeNull();
		expect(limitResumeText(null, undefined)).toBe(LIMIT_RESET_NOTE);
	});

	it("a queued message a resume already carried is not sent again, though the resume named it only in delivers", () => {
		const id = "6a1b7f0e-2a42-4c8e-9d36-0f7c1b2e3d4a";
		expect(
			interruptedTurn([
				{ kind: "message_queued", ...base, seq: 1, messageId: id, text: "Then this." } as CanonicalEvent,
				msg(2, "Resumed with: Then this.", { delivers: [id] }),
			]),
		).toEqual({ text: "Resumed with: Then this.", delivers: [] });
	});

	it("a resume line queued again after another failed compaction never repeats the text it carries", () => {
		const q = "6a1b7f0e-2a42-4c8e-9d36-0f7c1b2e3d4a";
		const w1 = "7b2c8a1f-3b53-4d9f-8e47-1a8d2c3f4e5b";
		const w2 = "8c3d9b2a-4c64-4e0a-9f58-2b9e3d4a5f6c";
		const first = `${LIMIT_RESET_NOTE}\n\nThen this.`;
		const events = [
			{ kind: "message_queued", ...base, seq: 1, messageId: q, text: "Then this." },
			{ kind: "message_queued", ...base, seq: 2, messageId: w1, text: first, delivers: [q] },
			{ kind: "message_queued", ...base, seq: 3, messageId: w2, text: first, delivers: [w1, q] },
		] as CanonicalEvent[];
		const turn = interruptedTurn(events);
		expect(limitResumeText(turn, undefined)).toBe(first);
		expect(new Set(turn?.delivers)).toEqual(new Set([w2, w1, q]));
	});

	it("a resume line already starting with the reset note gets no second note", () => {
		expect(limitResumeText({ text: `${LIMIT_RESET_NOTE}

Why?`, delivers: [] }, undefined)).toBe(`${LIMIT_RESET_NOTE}

Why?`);
	});

	// The resume's own note differs from the one the queued line opens with, so a check on one note alone fails.
	it.each([
		[LIMIT_RESET_NOTE, PROVIDER_BACK_NOTE],
		[PROVIDER_BACK_NOTE, UNBLOCKED_NOTE],
		[UNBLOCKED_NOTE, LIMIT_RESET_NOTE],
	])("limitResumeText adds no second note when the line already opens with %s", (opening, resumeNote) => {
		expect(
			limitResumeText({ text: `${opening}\n\nWhy?`, delivers: [] }, undefined, resumeNote),
		).toBe(`${opening}\n\nWhy?`);
	});

	it("a delivered queued message is not sent again", () => {
		const id = "6a1b7f0e-2a42-4c8e-9d36-0f7c1b2e3d4a";
		expect(
			interruptedTurn([
				{ kind: "message_queued", ...base, seq: 1, messageId: id, text: "Queued." } as CanonicalEvent,
				msg(2, "Queued.", { messageId: id }),
			]),
		).toEqual({ text: "Queued.", delivers: [] });
	});

	it("waits two minutes past a known reset, and stops after six blind retries", () => {
		const now = new Date(0);
		expect(limitWakeAt(new Date(1_000), 1, now)).toEqual(new Date(121_000));
		expect(limitWakeAt(null, 6, now)).toEqual(new Date(30 * 60_000));
		expect(limitWakeAt(null, 7, now)).toBeNull();
	});
});

describe("the compact command", () => {
	it("is the registry's, or `compact` when the agent advertised it", () => {
		expect(compactCommandOf(registryFacts("codex"))).toBe("compact");
		expect(compactCommandOf(registryFacts("gemini"))).toBeNull();
		expect(compactCommandOf(registryFacts("gemini"), ["compact"])).toBe("compact");
	});

	it("reads context from stored usage, and nothing from a bad one", () => {
		expect(usedOf('{"used":5,"size":9}')).toBe(5);
		expect(usedOf("{")).toBeUndefined();
		expect(usedOf(null)).toBeUndefined();
	});
});

describe("resumeNoteFor", () => {
	it.each([
		["rate_limited", PROVIDER_BACK_NOTE],
		["overloaded", PROVIDER_BACK_NOTE],
		["out_of_credit", UNBLOCKED_NOTE],
		["key_rejected", UNBLOCKED_NOTE],
		["spend_cap", UNBLOCKED_NOTE],
		["usage_limit", LIMIT_RESET_NOTE],
		[null, LIMIT_RESET_NOTE],
		[undefined, LIMIT_RESET_NOTE],
	])("maps mode %s to note %s", (mode, expectedNote) => {
		expect(resumeNoteFor(mode)).toBe(expectedNote);
	});
});

describe("threadSession", () => {
	const now = new Date("2026-11-12T12:00:00Z");
	const baseRow: SessionRow = {
		harness: "codex",
		usage: null,
		lastActivityAt: now,
		updatedAt: now,
		limitResetsAt: new Date("2026-11-12T13:00:00Z"),
		autoResume: true,
		completedAt: null,
		status: "failed",
	};

	it("hides the stop while status is running", () => {
		const row: SessionRow = { ...baseRow, status: "running" };
		const wake = {
			id: "wake-1",
			investigationId: "inv-1",
			kind: "limit",
			at: new Date("2026-11-12T13:02:00Z"),
			reason: "limit",
			payload: { mode: "usage_limit" },
			attempts: 1,
			state: "pending",
			createdAt: now,
			updatedAt: now,
			doneAt: null,
		} as Wake;

		const session = threadSession(row, {
			now,
			facts: null,
			resumeAfterLimit: true,
			limitWake: wake,
		});
		expect(session.limit).toBeUndefined();
	});

	it("shows mode, window, agent, and maxAttempts from the wake payload", () => {
		const row: SessionRow = { ...baseRow, status: "failed" };
		const wake = {
			id: "wake-2",
			investigationId: "inv-2",
			kind: "limit",
			at: new Date("2026-11-12T13:02:00Z"),
			reason: "limit",
			payload: {
				mode: "usage_limit",
				window: "weekly",
				maxAttempts: 5,
			},
			attempts: 2,
			state: "pending",
			createdAt: now,
			updatedAt: now,
			doneAt: null,
		} as Wake;
		const facts = {
			label: "Codex",
			cacheTtlMinutes: null,
			compactsWhenIdle: false,
			compactCommand: null,
		};

		const session = threadSession(row, {
			now,
			facts,
			resumeAfterLimit: true,
			limitWake: wake,
		});
		expect(session.limit).toMatchObject({
			mode: "usage_limit",
			window: "weekly",
			agent: "Codex",
			maxAttempts: 5,
			attempts: 2,
		});
	});
});
