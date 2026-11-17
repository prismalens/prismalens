// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import { describe, expect, it, vi } from "vitest";
import { recordLane, recordSubagent } from "./subagent-sessions.js";

const RUN = "11111111-1111-4111-8111-111111111111";

const base = (seq: number, ts = "2026-11-18T00:00:00.000Z") => ({
	runId: RUN,
	branchId: "run",
	path: [],
	seq,
	label: null,
	ts,
});

describe("subagent-sessions.ts", () => {
	it("recordSubagent: creates and updates subagentSession row with state and endedAt", async () => {
		const upsert = vi.fn(async () => ({}));
		const prisma = { subagentSession: { upsert } };

		// Running event with parent in path
		const subagentRunning: Extract<CanonicalEvent, { kind: "subagent" }> = {
			kind: "subagent",
			...base(1),
			path: ["parent-session"],
			sessionId: "sub-1",
			title: "Investigate pool",
			task: "check pool limits",
			state: "running",
			canCancel: true,
		};

		await recordSubagent(prisma as never, RUN, subagentRunning);
		expect(upsert).toHaveBeenCalledWith({
			where: { investigationId_sessionId: { investigationId: RUN, sessionId: "sub-1" } },
			create: expect.objectContaining({
				investigationId: RUN,
				sessionId: "sub-1",
				parentSessionId: "parent-session",
				title: "Investigate pool",
				task: "check pool limits",
				state: "running",
				canCancel: true,
				startedAt: new Date(subagentRunning.ts),
			}),
			update: expect.objectContaining({
				title: "Investigate pool",
				task: "check pool limits",
				state: "running",
				canCancel: true,
			}),
		});

		// Ended event
		const subagentEnded: Extract<CanonicalEvent, { kind: "subagent" }> = {
			kind: "subagent",
			...base(2, "2026-11-18T00:05:00.000Z"),
			path: [],
			sessionId: "sub-1",
			title: "Investigate pool",
			task: "",
			state: "completed",
			canCancel: false,
		};

		await recordSubagent(prisma as never, RUN, subagentEnded);
		expect(upsert).toHaveBeenLastCalledWith(
			expect.objectContaining({
				create: expect.objectContaining({
					endedAt: new Date(subagentEnded.ts),
				}),
				update: expect.objectContaining({
					state: "completed",
					canCancel: false,
					endedAt: new Date(subagentEnded.ts),
				}),
			}),
		);
	});

	it("recordLane: ignores non agent_step / tool_result events", async () => {
		const findUnique = vi.fn();
		const prisma = {
			subagentSession: { findUnique },
			investigationEvent: { findFirst: vi.fn() },
		};
		const e: CanonicalEvent = {
			kind: "operator_message",
			...base(1),
			text: "hello",
			mode: "queue",
			delivered: true,
		};
		await recordLane(prisma as never, RUN, e);
		expect(findUnique).not.toHaveBeenCalled();
	});

	it("recordLane: title and state derivation from delegate call description, name, label, or fallback", async () => {
		const runId = "22222222-2222-4222-8222-222222222222";
		const upsert = vi.fn(async () => ({}));
		const findUnique = vi.fn(async () => null);
		const findFirst = vi.fn(async () => ({
			event: JSON.stringify({
				kind: "agent_step",
				path: [],
				seq: 1,
				ts: "2026-11-18T00:00:01.000Z",
				toolCalls: [
					{
						toolCallId: "lane-call-1",
						name: "delegate",
						args: { description: "Explore logs", prompt: "grep 500" },
					},
				],
			}),
		}));

		const prisma = {
			subagentSession: { findUnique, upsert },
			investigationEvent: { findFirst },
		};

		const stepEvent: CanonicalEvent = {
			kind: "agent_step",
			...base(2),
			runId,
			path: ["lane-call-1"],
			text: "looking at logs",
			toolCalls: [],
		};

		await recordLane(prisma as never, runId, stepEvent);
		expect(upsert).toHaveBeenCalledWith({
			where: { investigationId_sessionId: { investigationId: runId, sessionId: "lane-call-1" } },
			create: expect.objectContaining({
				investigationId: runId,
				sessionId: "lane-call-1",
				title: "Explore logs",
				task: "grep 500",
				state: "running",
				startedAt: new Date("2026-11-18T00:00:01.000Z"),
			}),
			update: {},
		});

		// Fallback when call has name arg instead of description
		const runId2 = "33333333-3333-4333-8333-333333333333";
		findFirst.mockResolvedValueOnce({
			event: JSON.stringify({
				kind: "agent_step",
				path: [],
				seq: 1,
				ts: "2026-11-18T00:00:01.000Z",
				toolCalls: [
					{
						toolCallId: "lane-call-2",
						name: "delegate",
						args: { name: "Explore DB" },
					},
				],
			}),
		});

		const stepEvent2: CanonicalEvent = {
			kind: "agent_step",
			...base(2),
			runId: runId2,
			path: ["lane-call-2"],
			text: "looking at db",
			toolCalls: [],
		};

		await recordLane(prisma as never, runId2, stepEvent2);
		expect(upsert).toHaveBeenLastCalledWith(
			expect.objectContaining({
				create: expect.objectContaining({
					title: "Explore DB",
					task: "",
				}),
			}),
		);

		// Fallback to label or Sub-agent when no root call found
		const runId3 = "44444444-4444-4444-8444-444444444444";
		findFirst.mockResolvedValueOnce(null);
		const stepEvent3: CanonicalEvent = {
			kind: "agent_step",
			...base(2),
			runId: runId3,
			path: ["lane-call-3"],
			label: "Worker 1",
			text: "doing work",
			toolCalls: [],
		};
		await recordLane(prisma as never, runId3, stepEvent3);
		expect(upsert).toHaveBeenLastCalledWith(
			expect.objectContaining({
				create: expect.objectContaining({
					title: "Worker 1",
				}),
			}),
		);

		// When row.event is invalid JSON
		const runId4 = "44444444-4444-4444-8444-444444444445";
		findFirst.mockResolvedValueOnce({ event: "not-json" });
		const stepEvent4: CanonicalEvent = {
			kind: "agent_step",
			...base(2),
			runId: runId4,
			path: ["lane-call-4"],
			text: "doing work",
			toolCalls: [],
		};
		await recordLane(prisma as never, runId4, stepEvent4);
		expect(upsert).toHaveBeenLastCalledWith(
			expect.objectContaining({
				create: expect.objectContaining({
					title: "Sub-agent",
				}),
			}),
		);
	});

	it("recordLane: a repeated head makes no query", async () => {
		const runId = "55555555-5555-4555-8555-555555555555";
		const upsert = vi.fn(async () => ({}));
		const findUnique = vi.fn(async () => null);
		const findFirst = vi.fn(async () => null);

		const prisma = {
			subagentSession: { findUnique, upsert },
			investigationEvent: { findFirst },
		};

		const step1: CanonicalEvent = {
			kind: "agent_step",
			...base(1),
			runId,
			path: ["repeated-head"],
			text: "step 1",
			toolCalls: [],
		};
		const step2: CanonicalEvent = {
			kind: "agent_step",
			...base(2),
			runId,
			path: ["repeated-head"],
			text: "step 2",
			toolCalls: [],
		};

		await recordLane(prisma as never, runId, step1);
		expect(findUnique).toHaveBeenCalledTimes(1);
		expect(upsert).toHaveBeenCalledTimes(1);

		findUnique.mockClear();
		upsert.mockClear();

		// Second event with same head in memory
		await recordLane(prisma as never, runId, step2);
		expect(findUnique).not.toHaveBeenCalled();
		expect(upsert).not.toHaveBeenCalled();
	});

	it("recordLane: when row already known in DB, marks seen without upsert", async () => {
		const runId = "66666666-6666-4666-8666-666666666666";
		const upsert = vi.fn(async () => ({}));
		const findUnique = vi.fn(async () => ({ id: "existing-row" }));
		const prisma = {
			subagentSession: { findUnique, upsert },
			investigationEvent: { findFirst: vi.fn() },
		};

		const step: CanonicalEvent = {
			kind: "agent_step",
			...base(1),
			runId,
			path: ["known-head"],
			text: "step",
			toolCalls: [],
		};

		await recordLane(prisma as never, runId, step);
		expect(findUnique).toHaveBeenCalledTimes(1);
		expect(upsert).not.toHaveBeenCalled();

		// Next repeat in memory
		findUnique.mockClear();
		await recordLane(prisma as never, runId, step);
		expect(findUnique).not.toHaveBeenCalled();
	});

	it("recordLane: a failed row write leaves the head unseen so the next event retries", async () => {
		const runId = "77777777-7777-4777-8777-777777777777";
		const findUnique = vi.fn(async () => null);
		const upsert = vi.fn().mockRejectedValueOnce(new Error("db error")).mockResolvedValueOnce({});
		const findFirst = vi.fn(async () => null);

		const prisma = {
			subagentSession: { findUnique, upsert },
			investigationEvent: { findFirst },
		};

		const step: CanonicalEvent = {
			kind: "agent_step",
			...base(1),
			runId,
			path: ["retry-head"],
			text: "step",
			toolCalls: [],
		};

		await expect(recordLane(prisma as never, runId, step)).rejects.toThrow("db error");

		// Next event should query and try upsert again because it wasn't added to seenHeads
		await recordLane(prisma as never, runId, step);
		expect(findUnique).toHaveBeenCalledTimes(2);
		expect(upsert).toHaveBeenCalledTimes(2);
	});

	it("recordLane: a root tool_result settles the row", async () => {
		const runId = "88888888-8888-4888-8888-888888888888";
		const findUnique = vi.fn(async () => ({ state: "running" }));
		const updateMany = vi.fn(async () => ({ count: 1 }));
		const findFirst = vi.fn(async () => null); // no subagent event

		const prisma = {
			subagentSession: { findUnique, updateMany },
			investigationEvent: { findFirst },
		};

		const rootResult: Extract<CanonicalEvent, { kind: "tool_result" }> = {
			kind: "tool_result",
			...base(3, "2026-11-18T00:10:00.000Z"),
			runId,
			path: [],
			result: {
				name: "delegate",
				toolCallId: "call-to-settle",
				source: "delegate",
				ok: true,
				error: null,
				preview: "done",
			},
		};

		await recordLane(prisma as never, runId, rootResult);
		expect(updateMany).toHaveBeenCalledWith({
			where: {
				investigationId: runId,
				sessionId: "call-to-settle",
				state: "running",
			},
			data: {
				state: "completed",
				endedAt: new Date(rootResult.ts),
			},
		});

		// If result was failure ok=false
		const failResult: Extract<CanonicalEvent, { kind: "tool_result" }> = {
			...rootResult,
			result: { ...rootResult.result, ok: false, error: "failed" },
		};
		await recordLane(prisma as never, runId, failResult);
		expect(updateMany).toHaveBeenLastCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ state: "failed" }),
			}),
		);
	});

	it("recordLane: a call's result does not settle a row whose sub-agent sends its own session events", async () => {
		const runId = "99999999-9999-4999-8999-999999999999";
		const findUnique = vi.fn(async () => ({ state: "running" }));
		const updateMany = vi.fn();
		// subagent event found
		const findFirst = vi.fn(async () => ({ id: "event-subagent" }));

		const prisma = {
			subagentSession: { findUnique, updateMany },
			investigationEvent: { findFirst },
		};

		const rootResult: Extract<CanonicalEvent, { kind: "tool_result" }> = {
			kind: "tool_result",
			...base(5),
			runId,
			path: [],
			result: {
				name: "delegate",
				toolCallId: "own-subagent-call",
				source: "delegate",
				ok: true,
				error: null,
				preview: "done",
			},
		};

		await recordLane(prisma as never, runId, rootResult);
		expect(updateMany).not.toHaveBeenCalled();
	});

	it("recordLane: ignores root tool_result if row is not in running state", async () => {
		const runId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
		const findUnique = vi.fn(async () => ({ state: "completed" }));
		const updateMany = vi.fn();
		const prisma = {
			subagentSession: { findUnique, updateMany },
			investigationEvent: { findFirst: vi.fn() },
		};

		const rootResult: Extract<CanonicalEvent, { kind: "tool_result" }> = {
			kind: "tool_result",
			...base(6),
			runId,
			path: [],
			result: {
				name: "delegate",
				toolCallId: "already-ended-call",
				source: "delegate",
				ok: true,
				error: null,
				preview: "done",
			},
		};

		await recordLane(prisma as never, runId, rootResult);
		expect(updateMany).not.toHaveBeenCalled();
	});
});
