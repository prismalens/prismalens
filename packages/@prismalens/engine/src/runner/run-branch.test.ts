import { CanonicalEventSchema } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import type { HarnessStreamEvent } from "../adapter/deepagents-adapter.js";
import { runBranch } from "./run-branch.js";

const ctx = {
	runId: "11111111-1111-1111-1111-111111111111",
	branchId: "root",
	now: () => new Date("2026-06-28T00:00:00.000Z"),
};

async function* fakeStream(
	evs: HarnessStreamEvent[],
): AsyncGenerator<HarnessStreamEvent> {
	for (const e of evs) yield e;
}

async function collect<T>(gen: AsyncIterable<T>): Promise<T[]> {
	const out: T[] = [];
	for await (const e of gen) out.push(e);
	return out;
}

describe("runBranch", () => {
	it("normalizes the stream then emits a terminal branch_done(submitted)", async () => {
		const evs: HarnessStreamEvent[] = [
			{
				event: "on_chat_model_end",
				name: "model",
				run_id: "r",
				data: {
					output: {
						content: "checking pods",
						tool_calls: [{ id: "c1", name: "get_pods", args: {} }],
					},
				},
			},
			{
				event: "on_tool_end",
				name: "get_pods",
				run_id: "r",
				data: {
					input: {},
					output: { status: "success", content: "pod-1 Running", tool_call_id: "c1" },
				},
			},
		];
		const out = await collect(runBranch(fakeStream(evs), ctx));
		expect(out.map((e) => e.kind)).toEqual([
			"agent_step",
			"tool_result",
			"branch_done",
		]);
		for (const e of out) {
			expect(CanonicalEventSchema.safeParse(e).success).toBe(true);
		}
	});

	it("maps a thrown GraphRecursionError to branch_done(budget)", async () => {
		async function* boom(): AsyncGenerator<HarnessStreamEvent> {
			const err = new Error("Recursion limit reached");
			err.name = "GraphRecursionError";
			throw err;
		}
		const out = await collect(runBranch(boom(), ctx));
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({ kind: "branch_done", reason: "budget" });
	});

	it("maps any other throw to a terminal error event", async () => {
		async function* boom(): AsyncGenerator<HarnessStreamEvent> {
			throw new Error("kaboom");
		}
		const out = await collect(runBranch(boom(), ctx));
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({ kind: "error", message: "kaboom" });
		expect(CanonicalEventSchema.safeParse(out[0]).success).toBe(true);
	});
});
