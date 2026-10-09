// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The `JobRunner` contract for the in-process runner (0005 §2): parses the
 * payload before running, maps the run's result onto `RunOutcome`, and wires
 * `cancel`/`kill` to the same `AbortController` — there is no separate
 * "ask nicely, then force" distinction once the run is in this process.
 */
import { describe, expect, it, vi } from "vitest";
import type { RunSink } from "./dispatcher.js";
import { createInProcessRunner } from "./in-process-runner.js";
import type { ClaimedJob } from "./job-store.js";
import type { RunPorts } from "./run-ports.js";

vi.mock("./investigation-run.js", () => ({
	default: vi.fn(),
}));

function job(payload: unknown): ClaimedJob {
	return {
		id: "job-1",
		kind: "investigation",
		investigationId: "inv-1",
		incidentId: "inc-1",
		payload: JSON.stringify(payload),
		priority: 3,
		attempts: 1,
	};
}

function sink(): RunSink {
	return { onEvent: vi.fn(), onStreamDone: vi.fn(), onProgress: vi.fn() };
}

const ports = {} as RunPorts;

describe("createInProcessRunner", () => {
	it("throws synchronously on an unparseable payload, before any run starts", () => {
		const runner = createInProcessRunner(ports);
		const badJob: ClaimedJob = { ...job({}), payload: "{not json" };

		expect(() => runner(badJob, sink())).toThrow(/unparseable payload/);
	});

	it("resolves a succeeded outcome and closes the stream exactly once", async () => {
		const runInvestigationJob = (await import("./investigation-run.js")).default;
		vi.mocked(runInvestigationJob).mockImplementation(async (_job, _data, io) => {
			await io.streamDone();
			return {
				success: true,
				investigationId: "inv-1",
				incidentId: "inc-1",
				findings: {},
				recommendations: [],
			};
		});

		const runner = createInProcessRunner(ports);
		const s = sink();
		const running = runner(job({ investigationId: "inv-1", incidentId: "inc-1" }), s);
		const outcome = await running.done;

		expect(outcome).toEqual({ outcome: "succeeded" });
		expect(s.onStreamDone).toHaveBeenCalledTimes(1);
	});

	it("resolves a failed outcome (with error) when the run rejects, and still closes the stream", async () => {
		const runInvestigationJob = (await import("./investigation-run.js")).default;
		vi.mocked(runInvestigationJob).mockRejectedValue(new Error("boom"));

		const runner = createInProcessRunner(ports);
		const s = sink();
		const running = runner(job({ investigationId: "inv-1", incidentId: "inc-1" }), s);
		const outcome = await running.done;

		expect(outcome).toEqual({ outcome: "failed", error: "boom" });
		expect(s.onStreamDone).toHaveBeenCalledTimes(1);
	});

	it("resolves a cancelled outcome when the run returns errorType 'cancelled'", async () => {
		const runInvestigationJob = (await import("./investigation-run.js")).default;
		vi.mocked(runInvestigationJob).mockResolvedValue({
			success: false,
			investigationId: "inv-1",
			incidentId: "inc-1",
			findings: {},
			recommendations: [],
			error: "Investigation cancelled",
			errorType: "cancelled",
		});

		const runner = createInProcessRunner(ports);
		const running = runner(job({ investigationId: "inv-1", incidentId: "inc-1" }), sink());
		const outcome = await running.done;

		expect(outcome).toEqual({
			outcome: "cancelled",
			error: "Investigation cancelled",
		});
	});

	it("cancel() and kill() both abort the run's signal", async () => {
		const runInvestigationJob = (await import("./investigation-run.js")).default;
		let sawSignal: AbortSignal | undefined;
		vi.mocked(runInvestigationJob).mockImplementation(async (_job, _data, io) => {
			sawSignal = io.signal;
			return new Promise(() => {}); // never resolves in this test
		});

		const runner = createInProcessRunner(ports);
		const running = runner(job({ investigationId: "inv-1", incidentId: "inc-1" }), sink());
		await vi.waitFor(() => expect(sawSignal).toBeDefined());

		expect(sawSignal?.aborted).toBe(false);
		running.cancel();
		expect(sawSignal?.aborted).toBe(true);
	});

	it.each([
		["a first investigation", {}, "chat", "continue"],
		["a chat", { kind: "chat", chat: { text: "why?" } }, "continue", "chat"],
		["an Ask", { resume: { text: "why?", mode: "queue", restore: { status: "completed", completedAt: null, error: null } } }, "continue", "chat"],
		[
			"a continue",
			{ resume: { text: "go on", mode: "queue", kind: "continue", restore: { status: "cancelled", completedAt: null, error: null } } },
			"chat",
			"continue",
		],
	] as const)(
		"the turn that receives a message checks its kind: %s (#804 OBJ-032)",
		async (_name, extra, wrong, right) => {
			const runInvestigationJob = (await import("./investigation-run.js")).default;
			const heard: string[] = [];
			vi.mocked(runInvestigationJob).mockImplementation(async (_job, _data, io) => {
				// Hold the turn open with its steer channel listening.
				for (;;) {
					const line = io.steer?.next();
					if (line) heard.push(line.text);
					await new Promise((r) => setTimeout(r, 5));
				}
			});
			const runner = createInProcessRunner(ports);
			const running = runner(job({ investigationId: "inv-1", incidentId: "inc-1", ...extra }), sink());

			expect(running.message?.("stale page", "queue", [], wrong)).toBe("conflict");
			expect(running.message?.("also the TTL", "queue", [], right)).toBe("queued");
			expect(running.message?.("no kind", "queue", [])).toBe("queued");
			await vi.waitFor(() => expect(heard).toEqual(["also the TTL", "no kind"]));
			running.kill();
		},
	);
});
