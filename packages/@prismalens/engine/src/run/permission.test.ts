// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createAskChannel,
	denyAllPolicy,
	type PermissionRequest,
} from "./permission.js";

describe("denyAllPolicy", () => {
	it("picks reject_once when offered", () => {
		const req: PermissionRequest = {
			options: [
				{ optionId: "r1", kind: "reject_once" },
				{ optionId: "r2", kind: "reject_always" },
			],
		};
		const d = denyAllPolicy(req, {
			askId: "1",
			signal: new AbortController().signal,
		});
		expect(d).toEqual({
			allow: false,
			why: "no one can answer an ask here",
			outcome: "denied",
			optionId: "r1",
		});
	});

	it("returns no optionId when harness offers no reject option", () => {
		const req: PermissionRequest = {
			options: [{ optionId: "a1", kind: "allow_once" }],
		};
		const d = denyAllPolicy(req, {
			askId: "1",
			signal: new AbortController().signal,
		});
		expect(d).toEqual({
			allow: false,
			why: "no one can answer an ask here",
			outcome: "denied",
		});
	});
});

describe("createAskChannel", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("keeps an ask pending, lists it in pending(), and passes askedAt then null to onChange", async () => {
		vi.useFakeTimers();
		const askedAt = new Date("2026-10-09T10:00:00.000Z");
		const changes: (Date | null)[] = [];
		const channel = createAskChannel({
			timeoutMs: 5000,
			onChange: (d) => changes.push(d),
			now: () => askedAt,
		});
		const ac = new AbortController();
		const p = channel.policy(
			{ options: [{ optionId: "o1", kind: "allow_once" }] },
			{ askId: "ask1", signal: ac.signal },
		);
		expect(channel.pending()).toEqual([
			{
				askId: "ask1",
				askedAt,
				expiresAt: new Date(askedAt.getTime() + 5000),
			},
		]);
		expect(changes).toEqual([askedAt]);
		channel.answer("ask1", true);
		await p;
		expect(changes).toEqual([askedAt, null]);
		expect(channel.pending()).toEqual([]);
	});

	it("answer(id, true) resolves allow with the allow_once option (outcome approved)", async () => {
		vi.useFakeTimers();
		const channel = createAskChannel({ timeoutMs: 5000 });
		const ac = new AbortController();
		const p = channel.policy(
			{
				options: [
					{ optionId: "always", kind: "allow_always" },
					{ optionId: "once", kind: "allow_once" },
					{ optionId: "reject", kind: "reject_once" },
				],
			},
			{ askId: "ask1", signal: ac.signal },
		);
		const outcome = channel.answer("ask1", true);
		expect(outcome).toBe("approved");
		const decision = await p;
		expect(decision).toEqual({
			allow: true,
			optionId: "once",
			outcome: "approved",
		});
	});

	it("answer(id, false) resolves deny with reject option (outcome denied)", async () => {
		vi.useFakeTimers();
		const channel = createAskChannel({ timeoutMs: 5000 });
		const ac = new AbortController();
		const p = channel.policy(
			{
				options: [
					{ optionId: "once", kind: "allow_once" },
					{ optionId: "reject", kind: "reject_once" },
				],
			},
			{ askId: "ask1", signal: ac.signal },
		);
		const outcome = channel.answer("ask1", false);
		expect(outcome).toBe("denied");
		const decision = await p;
		expect(decision).toEqual({
			allow: false,
			optionId: "reject",
			why: "you denied it",
			outcome: "denied",
		});
	});

	it("no answer within timeoutMs resolves timed_out", async () => {
		vi.useFakeTimers();
		const channel = createAskChannel({ timeoutMs: 60_000 });
		const ac = new AbortController();
		const p = channel.policy(
			{ options: [{ optionId: "reject", kind: "reject_once" }] },
			{ askId: "ask1", signal: ac.signal },
		);
		vi.advanceTimersByTime(60_000);
		const decision = await p;
		expect(decision).toEqual({
			allow: false,
			optionId: "reject",
			why: "no answer in 1 minutes",
			outcome: "timed_out",
		});
	});

	it("aborting ctx.signal resolves stopped", async () => {
		vi.useFakeTimers();
		const channel = createAskChannel({ timeoutMs: 5000 });
		const ac = new AbortController();
		const p = channel.policy(
			{ options: [{ optionId: "reject", kind: "reject_once" }] },
			{ askId: "ask1", signal: ac.signal },
		);
		ac.abort();
		const decision = await p;
		expect(decision).toEqual({
			allow: false,
			optionId: "reject",
			why: "the turn was stopped",
			outcome: "stopped",
		});
	});

	it("close() resolves every waiting ask stopped and later asks are refused at once", async () => {
		vi.useFakeTimers();
		const channel = createAskChannel({ timeoutMs: 5000 });
		const ac = new AbortController();
		const p = channel.policy(
			{ options: [{ optionId: "reject", kind: "reject_once" }] },
			{ askId: "ask1", signal: ac.signal },
		);
		channel.close();
		const decision = await p;
		expect(decision).toEqual({
			allow: false,
			optionId: "reject",
			why: "the run ended",
			outcome: "stopped",
		});
		const later = channel.policy(
			{ options: [{ optionId: "reject", kind: "reject_once" }] },
			{ askId: "ask2", signal: ac.signal },
		);
		expect(later).toEqual({
			allow: false,
			optionId: "reject",
			why: "the run ended",
			outcome: "stopped",
		});
	});

	it("answer() on an unknown id returns null", () => {
		const channel = createAskChannel({ timeoutMs: 5000 });
		expect(channel.answer("unknown", true)).toBeNull();
	});

	it("approve with no allow option resolves denied", async () => {
		vi.useFakeTimers();
		const channel = createAskChannel({ timeoutMs: 5000 });
		const ac = new AbortController();
		const p = channel.policy(
			{ options: [{ optionId: "reject", kind: "reject_once" }] },
			{ askId: "ask1", signal: ac.signal },
		);
		const outcome = channel.answer("ask1", true);
		expect(outcome).toBe("denied");
		const decision = await p;
		expect(decision).toEqual({
			allow: false,
			optionId: "reject",
			why: "the agent offered no allow option",
			outcome: "denied",
		});
	});
});
