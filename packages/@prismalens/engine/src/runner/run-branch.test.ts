import { CanonicalEventSchema } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import type { AcpStreamItem } from "./acp-client.js";
import { runBranch } from "./run-branch.js";

const FIXED = new Date("2026-06-29T00:00:00.000Z");
const ctx = {
	runId: "11111111-1111-1111-1111-111111111111",
	branchId: "root",
	now: () => FIXED,
};

async function* feed(items: AcpStreamItem[]): AsyncGenerator<AcpStreamItem> {
	for (const item of items) yield item;
}

async function collect(items: AcpStreamItem[]) {
	const out = [];
	for await (const ev of runBranch(feed(items), ctx)) out.push(ev);
	return out;
}

describe("runBranch", () => {
	it("maps a full update stream to canonical events ending in branch_done", async () => {
		const events = await collect([
			{
				kind: "update",
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "looking" },
				},
			},
			{
				kind: "update",
				update: {
					sessionUpdate: "tool_call",
					kind: "search",
					title: "ls",
					toolCallId: "c1",
					status: "pending",
				},
			},
			{
				kind: "update",
				update: {
					sessionUpdate: "tool_call_update",
					toolCallId: "c1",
					status: "completed",
					content: [
						{ type: "content", content: { type: "text", text: "files" } },
					],
				},
			},
			{ kind: "done", stopReason: "end_turn" },
		]);
		expect(events.map((e) => e.kind)).toEqual([
			"agent_step",
			"tool_result",
			"branch_done",
		]);
		expect(events[2]).toMatchObject({
			kind: "branch_done",
			reason: "submitted",
		});
		expect(events.map((e) => e.seq)).toEqual([0, 1, 2]);
		for (const ev of events)
			expect(CanonicalEventSchema.safeParse(ev).success).toBe(true);
	});

	it("flushes trailing assistant text as a final agent_step before branch_done", async () => {
		const events = await collect([
			{
				kind: "update",
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "all clear" },
				},
			},
			{ kind: "done", stopReason: "end_turn" },
		]);
		expect(events.map((e) => e.kind)).toEqual(["agent_step", "branch_done"]);
		expect(events[0]).toMatchObject({
			kind: "agent_step",
			text: "all clear",
			toolCalls: [],
		});
	});

	it("maps a budget stopReason to branch_done(budget)", async () => {
		const events = await collect([
			{ kind: "done", stopReason: "max_turn_requests" },
		]);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ kind: "branch_done", reason: "budget" });
	});

	it("turns a transport error item into a terminal error event", async () => {
		const events = await collect([
			{
				kind: "update",
				update: {
					sessionUpdate: "tool_call",
					title: "ls",
					toolCallId: "c1",
					status: "pending",
				},
			},
			{ kind: "error", message: "harness exited early (code=1)" },
		]);
		expect(events.map((e) => e.kind)).toEqual(["agent_step", "error"]);
		expect(events[1]).toMatchObject({
			kind: "error",
			message: "harness exited early (code=1)",
		});
		expect(CanonicalEventSchema.safeParse(events[1]).success).toBe(true);
	});

	it("closes a stream that ends without an explicit terminal item", async () => {
		const events = await collect([
			{
				kind: "update",
				update: {
					sessionUpdate: "tool_call",
					title: "ls",
					toolCallId: "c1",
					status: "pending",
				},
			},
		]);
		expect(events.at(-1)).toMatchObject({
			kind: "branch_done",
			reason: "submitted",
		});
	});
});
