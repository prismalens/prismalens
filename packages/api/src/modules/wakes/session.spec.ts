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
	registryFacts,
	usedOf,
} from "./session.js";

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
		).toBe("Why?");
	});

	it("nothing when nobody wrote anything", () => {
		expect(interruptedTurn([])).toBeNull();
		expect(limitResumeText(null, undefined)).toBe(LIMIT_RESET_NOTE);
	});

	it("a delivered queued message is not sent again", () => {
		const id = "6a1b7f0e-2a42-4c8e-9d36-0f7c1b2e3d4a";
		expect(
			interruptedTurn([
				{ kind: "message_queued", ...base, seq: 1, messageId: id, text: "Queued." } as CanonicalEvent,
				msg(2, "Queued.", { messageId: id }),
			]),
		).toBe("Queued.");
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
