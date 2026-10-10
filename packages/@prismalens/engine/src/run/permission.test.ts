// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterEach, describe, expect, it, vi } from "vitest";
import {
	askWindow,
	createAskChannel,
	denyAllPolicy,
	levelPolicy,
	type PermissionRequest,
} from "./permission.js";

describe("askWindow", () => {
	it("no wall clock: unclamped with full ask timeout", () => {
		expect(askWindow(600_000, undefined, 50_000)).toEqual({
			timeoutMs: 600_000,
			clamped: false,
		});
	});

	it("plenty left: unclamped when wall - elapsed - 60s >= askMs", () => {
		expect(askWindow(600_000, 1_200_000, 60_000)).toEqual({
			timeoutMs: 600_000,
			clamped: false,
		});
	});

	it("5 min left -> 4 min clamped", () => {
		expect(askWindow(600_000, 400_000, 100_000)).toEqual({
			timeoutMs: 240_000,
			clamped: true,
		});
	});

	it("30 s left -> 0 clamped", () => {
		expect(askWindow(600_000, 130_000, 100_000)).toEqual({
			timeoutMs: 0,
			clamped: true,
		});
	});
});

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

	it("ctx.timeoutMs 0 denies at once with outcome timed_out and the run time-limit why", async () => {
		const channel = createAskChannel({ timeoutMs: 5000 });
		const ac = new AbortController();
		const decision = await channel.policy(
			{ options: [{ optionId: "r1", kind: "reject_once" }] },
			{ askId: "ask1", signal: ac.signal, timeoutMs: 0 },
		);
		expect(decision).toEqual({
			allow: false,
			optionId: "r1",
			why: "the run's time limit was reached",
			outcome: "timed_out",
		});
		expect(channel.pending()).toHaveLength(0);
	});

	it("ctx {timeoutMs: 1000, clamped: true} under fake timers lapses at 1 s with the time-limit why", async () => {
		vi.useFakeTimers();
		const askedAt = new Date("2026-10-09T10:00:00.000Z");
		const channel = createAskChannel({ now: () => askedAt });
		const ac = new AbortController();
		const p = channel.policy(
			{ options: [{ optionId: "r1", kind: "reject_once" }] },
			{ askId: "ask1", signal: ac.signal, timeoutMs: 1000, clamped: true },
		);
		expect(channel.pending()).toEqual([
			{
				askId: "ask1",
				askedAt,
				expiresAt: new Date(askedAt.getTime() + 1000),
			},
		]);
		vi.advanceTimersByTime(1000);
		const decision = await p;
		expect(decision).toEqual({
			allow: false,
			optionId: "r1",
			why: "no answer before the run's time limit",
			outcome: "timed_out",
		});
		expect(channel.pending()).toHaveLength(0);
	});
 });

describe("levelPolicy", () => {
	const claudeSwitchReq: PermissionRequest = {
		toolCall: {
			title: "Approve Plan",
			kind: "switch_mode",
			rawInput: { plan: "1. Read handler. 2. Write report." },
		},
		options: [
			{ optionId: "auto", name: "Yes, and use auto mode", kind: "allow_always" },
			{
				optionId: "bypass",
				name: "Yes, and bypass permissions",
				kind: "allow_always",
			},
			{
				optionId: "manual",
				name: "Yes, manually approve edits",
				kind: "allow_once",
			},
			{ optionId: "no", name: "No, keep planning", kind: "reject_once" },
		],
	};

	const codexSwitchReq: PermissionRequest = {
		toolCall: {
			title: "Implement this plan?",
			kind: "switch_mode",
			rawInput: { plan: "1. Read handler. 2. Write report." },
		},
		options: [
			{
				optionId: "yes",
				name: "Yes, implement this plan",
				kind: "allow_once",
			},
			{ optionId: "no", name: "No, keep planning", kind: "reject_once" },
		],
	};

	const ctx = {
		askId: "ask1",
		signal: new AbortController().signal,
	};

	const levels = [
		"supervised",
		"auto-edits",
		"auto",
		"full-access",
	] as const;

	describe("switch_mode rejection", () => {
		for (const level of levels) {
			it(`rejects switch_mode (first shape) at ${level} with mode_kept`, () => {
				const channel = createAskChannel({ timeoutMs: 5000 });
				const policy = levelPolicy(level, channel);
				const verdict = policy(claudeSwitchReq, ctx);
				expect(verdict).toEqual({
					allow: false,
					optionId: "no",
					outcome: "mode_kept",
					why: "the run stays in its mode",
				});
			});

			it(`rejects switch_mode (second shape) at ${level} with mode_kept`, () => {
				const channel = createAskChannel({ timeoutMs: 5000 });
				const policy = levelPolicy(level, channel);
				const verdict = policy(codexSwitchReq, ctx);
				expect(verdict).toEqual({
					allow: false,
					optionId: "no",
					outcome: "mode_kept",
					why: "the run stays in its mode",
				});
			});
		}

		it("never approves switch_mode even at full-access", () => {
			const channel = createAskChannel({ timeoutMs: 5000 });
			const policy = levelPolicy("full-access", channel);
			const claudeVerdict = policy(claudeSwitchReq, ctx);
			expect(claudeVerdict).toHaveProperty("allow", false);
			expect(claudeVerdict).not.toHaveProperty("outcome", "allowed");
			expect(claudeVerdict).not.toHaveProperty("outcome", "approved");

			const codexVerdict = policy(codexSwitchReq, ctx);
			expect(codexVerdict).toHaveProperty("allow", false);
			expect(codexVerdict).not.toHaveProperty("outcome", "allowed");
			expect(codexVerdict).not.toHaveProperty("outcome", "approved");
		});
	});

	describe("tool kinds order and verdicts", () => {
		const makeReq = (kind?: string): PermissionRequest => ({
			toolCall: {
				title: `Run ${kind ?? "unknown"}`,
				toolCallId: "tc_1",
				kind,
			},
			options: [
				{ optionId: "allow_1", kind: "allow_once" },
				{ optionId: "reject_1", kind: "reject_once" },
			],
		});

		it("read and search are allowed at supervised as plain objects", () => {
			const channel = createAskChannel({ timeoutMs: 5000 });
			const policy = levelPolicy("supervised", channel);

			const readVerdict = policy(makeReq("read"), ctx);
			expect(readVerdict).toBeInstanceOf(Object);
			expect(readVerdict).not.toBeInstanceOf(Promise);
			expect(readVerdict).toEqual({
				allow: true,
				optionId: "allow_1",
				outcome: "allowed",
			});

			const searchVerdict = policy(makeReq("search"), ctx);
			expect(searchVerdict).toBeInstanceOf(Object);
			expect(searchVerdict).not.toBeInstanceOf(Promise);
			expect(searchVerdict).toEqual({
				allow: true,
				optionId: "allow_1",
				outcome: "allowed",
			});
		});

		it("edit, delete, and move return card verdicts (Promises) at supervised", () => {
			const channel = createAskChannel({ timeoutMs: 5000 });
			const policy = levelPolicy("supervised", channel);

			for (const kind of ["edit", "delete", "move"]) {
				const verdict = policy(makeReq(kind), {
					askId: `ask_${kind}`,
					signal: new AbortController().signal,
				});
				expect(verdict).toBeInstanceOf(Promise);
			}
		});

		it("edit, delete, and move are allowed at auto-edits as plain objects", () => {
			const channel = createAskChannel({ timeoutMs: 5000 });
			const policy = levelPolicy("auto-edits", channel);

			for (const kind of ["edit", "delete", "move"]) {
				const verdict = policy(makeReq(kind), ctx);
				expect(verdict).toBeInstanceOf(Object);
				expect(verdict).not.toBeInstanceOf(Promise);
				expect(verdict).toEqual({
					allow: true,
					optionId: "allow_1",
					outcome: "allowed",
				});
			}
		});

		it("execute returns card verdict (Promise) at auto-edits", () => {
			const channel = createAskChannel({ timeoutMs: 5000 });
			const policy = levelPolicy("auto-edits", channel);

			const verdict = policy(makeReq("execute"), {
				askId: "ask_exec",
				signal: new AbortController().signal,
			});
			expect(verdict).toBeInstanceOf(Promise);
		});

		it("execute is allowed at auto and full-access as plain objects", () => {
			for (const level of ["auto", "full-access"] as const) {
				const channel = createAskChannel({ timeoutMs: 5000 });
				const policy = levelPolicy(level, channel);

				const verdict = policy(makeReq("execute"), ctx);
				expect(verdict).toBeInstanceOf(Object);
				expect(verdict).not.toBeInstanceOf(Promise);
				expect(verdict).toEqual({
					allow: true,
					optionId: "allow_1",
					outcome: "allowed",
				});
			}
		});

		it("sync verdicts are plain objects and card verdicts are Promises", () => {
			const channel = createAskChannel({ timeoutMs: 5000 });
			const supervisedPolicy = levelPolicy("supervised", channel);
			const autoEditsPolicy = levelPolicy("auto-edits", channel);

			// sync verdict (read)
			const syncVerdict = supervisedPolicy(makeReq("read"), ctx);
			expect(syncVerdict).toBeInstanceOf(Object);
			expect(syncVerdict).not.toBeInstanceOf(Promise);
			expect(syncVerdict).toHaveProperty("allow", true);

			// card verdict (edit at supervised)
			const cardVerdict = supervisedPolicy(makeReq("edit"), {
				askId: "ask_sync_card",
				signal: new AbortController().signal,
			});
			expect(cardVerdict).toBeInstanceOf(Promise);

			// card verdict (execute at auto-edits)
			const cardVerdict2 = autoEditsPolicy(makeReq("execute"), {
				askId: "ask_sync_card_2",
				signal: new AbortController().signal,
			});
			expect(cardVerdict2).toBeInstanceOf(Promise);
		});
	});
});
