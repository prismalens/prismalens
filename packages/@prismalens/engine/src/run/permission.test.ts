// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterEach, describe, expect, it, vi } from "vitest";
import {
	askIdentity,
	askWindow,
	createAskChannel,
	denyAllPolicy,
	isGatewayToolCall,
	levelPolicy,
	type PermissionRequest,
	SHUTDOWN_REASON,
} from "./permission.js";

const APPROVE = { kind: "permission", decision: "approve" } as const;
const DENY = { kind: "permission", decision: "deny" } as const;

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
		channel.answer("ask1", APPROVE);
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
		const outcome = channel.answer("ask1", APPROVE);
		expect(outcome?.outcome).toBe("approved");
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
		const outcome = channel.answer("ask1", DENY);
		expect(outcome?.outcome).toBe("denied");
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

	it("an abort because PrismaLens is closing resolves restarted, not stopped (#981)", async () => {
		vi.useFakeTimers();
		const channel = createAskChannel({ timeoutMs: 5000 });
		const ac = new AbortController();
		const p = channel.policy(
			{ options: [{ optionId: "reject", kind: "reject_once" }] },
			{ askId: "ask1", signal: ac.signal },
		);
		ac.abort(SHUTDOWN_REASON);
		expect(await p).toEqual({
			allow: false,
			optionId: "reject",
			why: "PrismaLens restarted",
			outcome: "restarted",
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
		expect(channel.answer("unknown", APPROVE)).toBeNull();
	});

	it("approve with no allow option resolves denied", async () => {
		vi.useFakeTimers();
		const channel = createAskChannel({ timeoutMs: 5000 });
		const ac = new AbortController();
		const p = channel.policy(
			{ options: [{ optionId: "reject", kind: "reject_once" }] },
			{ askId: "ask1", signal: ac.signal },
		);
		const outcome = channel.answer("ask1", APPROVE);
		expect(outcome?.outcome).toBe("denied");
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

		it("edit, delete, and move return card verdicts (Promises) at supervised", async () => {
			const channel = createAskChannel({ timeoutMs: 5000 });
			const policy = levelPolicy("supervised", channel);

			const editVerdict = policy(makeReq("edit"), {
				askId: "ask_edit",
				signal: new AbortController().signal,
			});
			const deleteVerdict = policy(makeReq("delete"), {
				askId: "ask_delete",
				signal: new AbortController().signal,
			});
			const moveVerdict = policy(makeReq("move"), {
				askId: "ask_move",
				signal: new AbortController().signal,
			});

			expect(channel.pending().map((p) => p.askId)).toEqual([
				"ask_edit",
				"ask_delete",
				"ask_move",
			]);

			channel.answer("ask_edit", APPROVE);
			channel.answer("ask_delete", APPROVE);
			channel.answer("ask_move", APPROVE);

			expect(await editVerdict).toEqual({
				allow: true,
				optionId: "allow_1",
				outcome: "approved",
			});
			expect(await deleteVerdict).toEqual({
				allow: true,
				optionId: "allow_1",
				outcome: "approved",
			});
			expect(await moveVerdict).toEqual({
				allow: true,
				optionId: "allow_1",
				outcome: "approved",
			});
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

		it("execute returns card verdict (Promise) at auto-edits", async () => {
			const channel = createAskChannel({ timeoutMs: 5000 });
			const policy = levelPolicy("auto-edits", channel);

			const verdict = policy(makeReq("execute"), {
				askId: "ask_exec",
				signal: new AbortController().signal,
			});
			expect(channel.pending().map((p) => p.askId)).toEqual(["ask_exec"]);
			channel.answer("ask_exec", APPROVE);
			expect(await verdict).toEqual({
				allow: true,
				optionId: "allow_1",
				outcome: "approved",
			});
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

	describe("unattended policy", () => {
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

		it("Given unattended run, When an execute ask arrives at any level, Then it denies without calling channel policy", () => {
			for (const level of ["supervised", "auto-edits", "auto", "full-access"] as const) {
				const channelPolicy = vi.fn();
				const channel = { policy: channelPolicy };
				const policy = levelPolicy(level, channel, { unattended: true });
				const verdict = policy(makeReq("execute"), ctx);
				expect(verdict).toEqual({
					allow: false,
					optionId: "reject_1",
					outcome: "unattended",
					why: "an alert started this run and nobody was there to answer",
				});
				expect(channelPolicy).not.toHaveBeenCalled();
			}
		});

		it("Given unattended run, When a read ask with an allow option arrives, Then it is allowed", () => {
			const channelPolicy = vi.fn();
			const channel = { policy: channelPolicy };
			const policy = levelPolicy("auto", channel, { unattended: true });
			const verdict = policy(makeReq("read"), ctx);
			expect(verdict).toEqual({
				allow: true,
				optionId: "allow_1",
				outcome: "allowed",
			});
			expect(channelPolicy).not.toHaveBeenCalled();
		});

		it("Given unattended run, When switch_mode ask arrives, Then it answers with mode_kept", () => {
			const channelPolicy = vi.fn();
			const channel = { policy: channelPolicy };
			const policy = levelPolicy("auto", channel, { unattended: true });
			const verdict = policy(claudeSwitchReq, ctx);
			expect(verdict).toEqual({
				allow: false,
				optionId: "no",
				outcome: "mode_kept",
				why: "the run stays in its mode",
			});
			expect(channelPolicy).not.toHaveBeenCalled();
		});
	});
});

describe("gateway-read exemption bound to our server (#848, OBJ-011)", () => {
	const options = [
		{ optionId: "allow", name: "Allow", kind: "allow_once" },
		{ optionId: "reject", name: "Reject", kind: "reject_once" },
	];
	const ctx = { askId: "a1", signal: new AbortController().signal };
	const card = vi.fn(async () => ({
		allow: false as const,
		why: "card",
		outcome: "denied" as const,
	}));
	const NAME = "prismalens-abcdefgh23";
	const gateway = (connected: boolean) => ({
		connected: () => connected,
		confirmed: () => connected,
		serverName: NAME,
		tools: ["sources_list", "prometheus_query", "incident_get"],
	});
	/** Claude Code's ask names the server in `_meta` and qualifies the title. */
	const claudeAsk = (tool: string, server = NAME): PermissionRequest => ({
		options,
		toolCall: {
			toolCallId: "t1",
			title: `mcp__${server}__${tool}`,
			kind: "other",
			_meta: { claudeCode: { mcpServer: { name: server }, toolName: `mcp__${server}__${tool}` } },
		},
	});
	/** codex-acp 1.13.1 announces the call as `mcp.<server>.<tool>`, marked `is_mcp_tool_call`. */
	const codexAsk = (tool: string, server = NAME): PermissionRequest => ({
		options,
		toolCall: {
			toolCallId: "c1",
			title: `mcp.${server}.${tool}`,
			kind: "execute",
			_meta: { is_mcp_tool_call: true },
		},
	});

	it("allows a Claude ask for a PrismaLens tool once the gateway is confirmed", async () => {
		const policy = levelPolicy("supervised", { policy: card }, { gateway: gateway(true) });
		expect(await policy(claudeAsk("sources_list"), ctx)).toMatchObject({ allow: true, optionId: "allow" });
	});

	it("shows the card while the gateway is unconfirmed", async () => {
		card.mockClear();
		const policy = levelPolicy("supervised", { policy: card }, { gateway: gateway(false) });
		expect(await policy(claudeAsk("sources_list"), ctx)).toMatchObject({ allow: false, why: "card" });
		expect(card).toHaveBeenCalledOnce();
	});

	it("checks confirmation at ask time, not later", async () => {
		let connected = false;
		const policy = levelPolicy("supervised", { policy: card }, {
			gateway: { connected: () => connected, serverName: NAME, tools: ["sources_list"] },
		});
		const verdict = await policy(claudeAsk("sources_list"), ctx);
		connected = true;
		expect(verdict).toMatchObject({ allow: false });
	});

	it("never exempts a proxied tool, even on our server", async () => {
		const supervised = levelPolicy("supervised", { policy: card }, { gateway: gateway(true) });
		expect(await supervised(claudeAsk("n8n_prod__list_workflows"), ctx)).toMatchObject({ why: "card" });
		const unattended = levelPolicy("full-access", { policy: card }, { gateway: gateway(true), unattended: true });
		expect(await unattended(claudeAsk("n8n_prod__list_workflows"), ctx)).toMatchObject({
			allow: false,
			outcome: "unattended",
		});
	});

	it("never exempts another server's tool of the same name", async () => {
		const policy = levelPolicy("supervised", { policy: card }, { gateway: gateway(true) });
		const other: PermissionRequest = {
			options,
			toolCall: { title: "mcp__evil__sources_list", kind: "other" },
		};
		const lying: PermissionRequest = {
			options,
			toolCall: {
				title: `mcp__${NAME}__sources_list`,
				kind: "other",
				_meta: { claudeCode: { mcpServer: { name: "evil" } } },
			},
		};
		expect(await policy(other, ctx)).toMatchObject({ why: "card" });
		expect(await policy(lying, ctx)).toMatchObject({ why: "card" });
	});

	it("allows a Codex dotted title, including unattended", async () => {
		const policy = levelPolicy("supervised", { policy: card }, { gateway: gateway(true), unattended: true });
		expect(await policy(codexAsk("sources_list"), ctx)).toMatchObject({ allow: true });
	});

	it("an ID-only ask is not exempt on its own", async () => {
		const policy = levelPolicy("supervised", { policy: card }, { gateway: gateway(true), unattended: true });
		const idOnly: PermissionRequest = { options, toolCall: { toolCallId: "c1", kind: "execute" } };
		expect(await policy(idOnly, ctx)).toMatchObject({ allow: false, outcome: "unattended" });
	});

	it("an ask titled mcp__prismalens__incident_get is not auto-allowed", async () => {
		const policy = levelPolicy("supervised", { policy: card }, { gateway: gateway(true) });
		const legacy: PermissionRequest = {
			options,
			toolCall: {
				title: "mcp__prismalens__incident_get",
				kind: "other",
				_meta: { claudeCode: { mcpServer: { name: "prismalens" }, toolName: "mcp__prismalens__incident_get" } },
			},
		};
		expect(await policy(legacy, ctx)).toMatchObject({ allow: false, why: "card" });
	});

	it("a gateway tool outside autoAllow gets the card, even unattended (#848)", async () => {
		const gw = { ...gateway(true), autoAllow: ["incident_get"] };
		const policy = levelPolicy("supervised", { policy: card }, { gateway: gw, unattended: true });
		expect(await policy(claudeAsk("incident_get"), ctx)).toMatchObject({ allow: true });
		expect(await policy(claudeAsk("sources_list"), ctx)).toMatchObject({
			allow: false,
			outcome: "unattended",
		});
	});

	it("with a connected gateway whose tools include pl_browser_run_script and pl_browser_snapshot but autoAllow only pl_browser_snapshot, an MCP ask for pl_browser_run_script goes to the card at supervised and auto-edits, and is allowed at auto and full-access, while snapshot ask is allowed at supervised", async () => {
		const browserGw = {
			...gateway(true),
			tools: ["pl_browser_run_script", "pl_browser_snapshot"],
			autoAllow: ["pl_browser_snapshot"],
		};
		const runScriptAsk = claudeAsk("pl_browser_run_script");
		const snapshotAsk = claudeAsk("pl_browser_snapshot");

		card.mockClear();
		const supervisedPolicy = levelPolicy("supervised", { policy: card }, { gateway: browserGw });
		expect(await supervisedPolicy(runScriptAsk, ctx)).toEqual({
			allow: false,
			why: "card",
			outcome: "denied",
		});
		expect(card).toHaveBeenCalledTimes(1);

		card.mockClear();
		const autoEditsPolicy = levelPolicy("auto-edits", { policy: card }, { gateway: browserGw });
		expect(await autoEditsPolicy(runScriptAsk, ctx)).toEqual({
			allow: false,
			why: "card",
			outcome: "denied",
		});
		expect(card).toHaveBeenCalledTimes(1);

		const autoPolicy = levelPolicy("auto", { policy: card }, { gateway: browserGw });
		expect(await autoPolicy(runScriptAsk, ctx)).toEqual({
			allow: true,
			optionId: "allow",
			outcome: "allowed",
		});

		const fullAccessPolicy = levelPolicy("full-access", { policy: card }, { gateway: browserGw });
		expect(await fullAccessPolicy(runScriptAsk, ctx)).toEqual({
			allow: true,
			optionId: "allow",
			outcome: "allowed",
		});

		expect(await supervisedPolicy(snapshotAsk, ctx)).toEqual({
			allow: true,
			optionId: "allow",
			outcome: "allowed",
		});
	});

	it("asks titled mcp__<name>__incident_get and mcp.<name>.incident_get are allowed", async () => {
		const policy = levelPolicy("supervised", { policy: card }, { gateway: gateway(true) });
		expect(await policy(claudeAsk("incident_get"), ctx)).toMatchObject({ allow: true });
		expect(await policy(codexAsk("incident_get"), ctx)).toMatchObject({ allow: true });
	});

	it("an ask titled with the gateway-qualified incident_get and rawInput: { server: 'evil' } is not a gateway call (#848)", async () => {
		const gw = gateway(true);
		const ask = claudeAsk("incident_get");
		if (ask.toolCall) ask.toolCall.rawInput = { server: "evil" };
		expect(isGatewayToolCall(ask, gw)).toBe(false);
		const policy = levelPolicy("supervised", { policy: card }, { gateway: gw });
		expect(await policy(ask, ctx)).toMatchObject({ why: "card" });
	});

	it("a call whose own arguments name our server and tool is not a gateway call (#848)", async () => {
		const gw = gateway(true);
		const spoofed: PermissionRequest = {
			options,
			toolCall: { title: "run_query", kind: "other", rawInput: { server: NAME, tool: "incident_get" } },
		};
		expect(isGatewayToolCall(spoofed, gw)).toBe(false);
		const policy = levelPolicy("supervised", { policy: card }, { gateway: gw });
		expect(await policy(spoofed, ctx)).toMatchObject({ why: "card" });
	});

	it("a qualified title with the agent's own marker and no rawInput is a gateway call", () => {
		expect(isGatewayToolCall(claudeAsk("incident_get"), gateway(true))).toBe(true);
		expect(isGatewayToolCall(codexAsk("incident_get"), gateway(true))).toBe(true);
	});

	it("a qualified title plus a matching rawInput.server is a gateway call", () => {
		const ask = claudeAsk("incident_get");
		if (ask.toolCall) ask.toolCall.rawInput = { server: NAME, id: "inc-1" };
		expect(isGatewayToolCall(ask, gateway(true))).toBe(true);
	});

	it("_meta naming our server with a bare incident_get title is not a gateway call", () => {
		// claude-agent-acp titles an MCP ask with its full mcp__<server>__<tool> name, never the bare tool.
		const bare: PermissionRequest = {
			options,
			toolCall: {
				title: "incident_get",
				kind: "other",
				_meta: { claudeCode: { mcpServer: { name: NAME } } },
				rawInput: { server: NAME, tool: "incident_get" },
			},
		};
		expect(isGatewayToolCall(bare, gateway(true))).toBe(false);
	});

	it("a qualified title with no marker is not a gateway call: agents copy titles from arguments", () => {
		// Claude's Bash and Task, Gemini's `command` and OpenCode's description become the title.
		const fromArgs: PermissionRequest = {
			options,
			toolCall: {
				title: `mcp__${NAME}__incident_get`,
				kind: "execute",
				rawInput: { command: `mcp__${NAME}__incident_get` },
			},
		};
		const dotted: PermissionRequest = {
			options,
			toolCall: { toolCallId: "c3", title: `mcp.${NAME}.incident_get`, kind: "execute" },
		};
		expect(isGatewayToolCall(fromArgs, gateway(true))).toBe(false);
		expect(isGatewayToolCall(dotted, gateway(true))).toBe(false);
	});
});

describe("asks a person allowed always on a schedule (#1020 R33, CP4 OBJ-011)", () => {
	const ctx = { askId: "ask1", signal: new AbortController().signal };
	const ask = (kind: string, rawInput: unknown, title = "Run command"): PermissionRequest => ({
		toolCall: { title, kind, rawInput },
		options: [
			{ optionId: "yes", name: "Allow", kind: "allow_once" },
			{ optionId: "no", name: "Deny", kind: "reject_once" },
		],
	});
	const npmTest = ask("execute", { command: "npm test", cwd: "/w" });
	const remembered = [{ kind: "execute", identity: askIdentity(npmTest.toolCall) as string }];

	it("names an operation by what it does, never by its title", () => {
		expect(askIdentity(npmTest.toolCall)).toMatch(/^[0-9a-f]{64}$/);
		expect(askIdentity(ask("execute", { command: "npm test", cwd: "/w" }, "Other title").toolCall)).toBe(askIdentity(npmTest.toolCall));
		expect(askIdentity(ask("execute", { command: "npm test", cwd: "/elsewhere" }).toolCall)).not.toBe(askIdentity(npmTest.toolCall));
		expect(askIdentity(ask("edit", { file_path: "/w/a.ts" }).toolCall)).not.toBe(askIdentity(ask("edit", { file_path: "/w/b.ts" }).toolCall));
		expect(askIdentity(ask("other", { b: 1, a: 2 }).toolCall)).toBe(askIdentity(ask("other", { a: 2, b: 1 }).toolCall));
		// Nothing stable to name: no identity, so nothing can be remembered.
		expect(askIdentity({ title: "Run command", kind: "execute" })).toBeNull();
		expect(askIdentity({ title: "Edit", kind: "edit", rawInput: {} })).toBeNull();
	});

	it("never lets two different operations share an identity (CP4 r2 OBJ-011)", () => {
		// One argument with a space is not two arguments.
		expect(askIdentity(ask("execute", { command: ["a b"], cwd: "/w" }).toolCall)).not.toBe(
			askIdentity(ask("execute", { command: ["a", "b"], cwd: "/w" }).toolCall),
		);
		// An edit of /repo/a does not approve an edit of /repo/a and /repo/b.
		const one = { title: "Edit", kind: "edit", rawInput: { file_path: "/repo/a" }, locations: [{ path: "/repo/a" }] };
		const two = { title: "Edit", kind: "edit", rawInput: { file_path: "/repo/a" }, locations: [{ path: "/repo/a" }, { path: "/repo/b" }] };
		expect(askIdentity(one)).not.toBe(askIdentity(two));
		// The same operation still matches, whatever the title or key order.
		expect(askIdentity({ ...two, title: "Other" })).toBe(askIdentity(two));
		expect(askIdentity(ask("execute", { cwd: "/w", command: ["a", "b"] }).toolCall)).toBe(
			askIdentity(ask("execute", { command: ["a", "b"], cwd: "/w" }).toolCall),
		);
		// Input that cannot be serialized offers no identity, so no Always allow.
		const loop: Record<string, unknown> = { x: 1 };
		loop.self = loop;
		expect(askIdentity({ title: "t", kind: "other", rawInput: loop })).toBeNull();
		expect(askIdentity({ title: "t", kind: "other", rawInput: { n: 10n } })).toBeNull();
	});

	it("allows the exact remembered operation, even where nobody can answer", () => {
		const channel = createAskChannel({ timeoutMs: 5000 });
		const policy = levelPolicy("supervised", channel, { unattended: true, remembered });
		expect(policy(npmTest, ctx)).toEqual({ allow: true, optionId: "yes", outcome: "allowed" });
	});

	it("never allows another command that shares the title, an edit to another path, or a mode switch", () => {
		const channel = createAskChannel({ timeoutMs: 5000 });
		const edits = [{ kind: "edit", identity: askIdentity(ask("edit", { file_path: "/w/a.ts" }).toolCall) as string }];
		const policy = levelPolicy("supervised", channel, { unattended: true, remembered: [...remembered, ...edits] });
		expect(policy(ask("execute", { command: "git push origin main --force", cwd: "/w" }), ctx)).toMatchObject({ allow: false, outcome: "unattended" });
		expect(policy(ask("edit", { file_path: "/w/b.ts" }), ctx)).toMatchObject({ allow: false, outcome: "unattended" });
		expect(policy(ask("switch_mode", { command: "npm test", cwd: "/w" }), ctx)).toMatchObject({ allow: false, outcome: "mode_kept" });
	});

	it("Wait for me: an ask that is not the remembered operation still waits for a person", async () => {
		const channel = createAskChannel({ timeoutMs: 5000 });
		const policy = levelPolicy("full-access", channel, { waitForAsks: true, remembered });
		const verdict = policy(ask("execute", { command: "git push origin main --force", cwd: "/w" }), ctx);
		expect(verdict).toBeInstanceOf(Promise);
		expect(channel.pending()).toHaveLength(1);
		channel.answer(channel.pending()[0]?.askId as string, DENY);
		await expect(verdict).resolves.toMatchObject({ allow: false, outcome: "denied" });
		expect(policy(npmTest, ctx)).toEqual({ allow: true, optionId: "yes", outcome: "allowed" });
	});

	it("Wait for me sends every ask past reads to a person, whatever the level", async () => {
		const channel = createAskChannel({ timeoutMs: 5000 });
		const policy = levelPolicy("full-access", channel, { waitForAsks: true });
		const verdict = policy(ask("execute", { command: "rm -rf build" }), ctx);
		expect(verdict).toBeInstanceOf(Promise);
		expect(channel.pending()).toHaveLength(1);
		const id = channel.pending()[0]?.askId as string;
		expect(channel.answer(id, DENY)?.outcome).toBe("denied");
		await expect(verdict).resolves.toMatchObject({ allow: false, outcome: "denied" });
	});
});

describe("AskChannel answers (#1024)", () => {
	const options = [
		{ optionId: "always", kind: "allow_always" },
		{ optionId: "once", kind: "allow_once" },
		{ optionId: "reject", kind: "reject_once" },
	] as PermissionRequest["options"];

	it("Always allow picks the agent's allow_always option", async () => {
		const channel = createAskChannel({ timeoutMs: 5000 });
		const p = channel.policy(
			{ options },
			{ askId: "a", signal: new AbortController().signal },
		);
		channel.answer("a", { ...APPROVE, scope: "always" });
		expect(await p).toMatchObject({ allow: true, optionId: "always" });
		channel.close();
	});

	it("a deny with a reason returns the reason for the host to queue", async () => {
		const channel = createAskChannel({ timeoutMs: 5000 });
		const p = channel.policy(
			{ options },
			{ askId: "a", signal: new AbortController().signal },
		);
		expect(channel.answer("a", { ...DENY, reason: "use staging" })).toEqual({
			outcome: "denied",
			reason: "use staging",
		});
		expect(await p).toMatchObject({ allow: false, optionId: "reject" });
	});

	it("a held question settles on an answer it accepts, and refuses one it does not", async () => {
		const channel = createAskChannel();
		const held = channel.hold(
			"q",
			{ kind: "question", accepts: (a) => a.kind === "question" },
			{ timeoutMs: 0 },
		);
		expect(channel.pending().map((p) => p.askId)).toEqual(["q"]);
		expect(channel.answer("q", APPROVE)).toBe("invalid");
		expect(channel.pending().map((p) => p.askId)).toEqual(["q"]);
		const answer = { kind: "question", answers: { x: { options: ["a"] } } } as const;
		expect(channel.answer("q", answer)).toEqual({ outcome: "answered" });
		expect(await held).toEqual({ outcome: "answered", answer });
		expect(channel.answer("q", answer)).toBeNull();
	});

	it("a held ask expires after its window, and stops when the run ends", async () => {
		vi.useFakeTimers();
		const channel = createAskChannel();
		const expiring = channel.hold("e", { kind: "input", accepts: () => true }, { timeoutMs: 1000 });
		const stopping = channel.hold("s", { kind: "input", accepts: () => true }, { timeoutMs: 0 });
		vi.advanceTimersByTime(1000);
		expect(await expiring).toEqual({ outcome: "expired" });
		channel.close();
		expect(await stopping).toEqual({ outcome: "stopped" });
		vi.useRealTimers();
	});

	it("a held ask that never lapses still has a valid expiry date", () => {
		const channel = createAskChannel();
		void channel.hold("n", { kind: "input", accepts: () => true }, { timeoutMs: 0 });
		const pending = channel.pending();
		expect(pending.map((p) => p.askId)).toEqual(["n"]);
		expect(pending[0].expiresAt).toEqual(new Date(8.64e15));
		expect(pending[0].expiresAt.getTime()).toBe(8.64e15);
		channel.close();
	});
});

