// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { executeTool, resultValue } from "@prismalens/integrations/harness";
import { describe, expect, it, vi } from "vitest";
import { proposeTools } from "./propose.js";
import { ThreadStartInput, type ThreadTreeData, threadTreeTools } from "./thread-tree.js";

const ctx = { runId: "run-1", signal: new AbortController().signal };

function tools() {
	const data = {
		start: vi.fn(async () => ({ value: { status: "pending_approval" } })),
		send: vi.fn(async () => ({ value: { status: "queued" } })),
		cancel: vi.fn(async () => ({ value: { status: "stopping" } })),
	} satisfies ThreadTreeData;
	const byName = Object.fromEntries(threadTreeTools(data).map((t) => [t.name, t]));
	return { data, byName };
}

describe("the thread tools (#1101 cat 10, 2cc93e1ad)", () => {
	it("pass each call to the tree with the run's id and the defaults filled in", async () => {
		const { data, byName } = tools();
		const call = async (name: string, args: unknown) =>
			resultValue((await executeTool(byName[name] as never, args, ctx)).output);
		expect(
			await call("pl_thread_start", {
				title: "Check the db",
				brief: "Find why the pool is exhausted and return the cause.",
				requestId: "r1",
			}),
		).toEqual({ status: "pending_approval" });
		expect(data.start).toHaveBeenCalledWith("run-1", expect.objectContaining({ workspace: { kind: "new_from_parent" } }));
		await call("pl_thread_send", { to: "starter", text: "x", requestId: "m1" });
		expect(data.send).toHaveBeenCalledWith("run-1", { to: "starter", text: "x", mode: "queue", requestId: "m1" });
		await call("pl_thread_cancel", { id: "/threads/t-2", reason: "replaced", requestId: "c1" });
		expect(data.cancel).toHaveBeenCalledWith("run-1", "/threads/t-2", "replaced", "c1");
		expect(Object.keys(byName).sort()).toEqual(["pl_thread_cancel", "pl_thread_send", "pl_thread_start"]);
	});

	it("needs a ref for new_from_ref, and takes no role", () => {
		const base = { title: "Check", brief: "Find why the pool is exhausted.", requestId: "r" };
		expect(ThreadStartInput.safeParse({ ...base, workspace: { kind: "new_from_ref" } }).success).toBe(false);
		expect(ThreadStartInput.safeParse({ ...base, workspace: { kind: "new_from_ref", ref: "main" } }).success).toBe(true);
		expect(ThreadStartInput.safeParse({ ...base, role: "db" }).data).not.toHaveProperty("role");
	});

	it("marks pl_thread_send a record tool", () => {
		const { byName } = tools();
		expect(byName.pl_thread_send?.effect).toBe("record");
	});
});

describe("pl_propose_action (#1024 spec F)", () => {
	const change = { kind: "setting", key: "children", value: 3 };

	it("records a card and answers its id without changing anything", async () => {
		const propose = vi.fn(async () => ({
			id: "p1",
			threadId: "run-1",
			kind: "setting" as const,
			change: change as never,
			why: "w",
			state: "open" as const,
			createdAt: "2026-01-01T00:00:00.000Z",
		}));
		const [tool] = proposeTools({ propose });
		const out = resultValue((await executeTool(tool as never, { change, why: "fewer at once" }, ctx)).output);
		expect(out).toMatchObject({ proposalId: "p1", state: "open" });
		expect(propose).toHaveBeenCalledWith("run-1", change, "fewer at once");
	});

	it("answers limit_reached when the thread already holds too many open cards", async () => {
		const [tool] = proposeTools({ propose: async () => ({ error: "This thread already has 10 open proposals." }) });
		const call = await executeTool(tool as never, { change, why: "w" }, ctx);
		expect(call.isError).toBe(true);
		expect(resultValue(call.output).error).toBe("limit_reached");
	});
});
