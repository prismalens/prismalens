import { Logger } from "@nestjs/common";
import type { Report, StepEvent } from "@prismalens/engine";
import { InvestigationEngineService } from "./investigation-engine.service.js";

async function* streamOf(events: StepEvent[]): AsyncGenerator<StepEvent> {
	for (const e of events) yield e;
}

describe("InvestigationEngineService.consume (StepEvent → relay → persistence)", () => {
	const report: Report = {
		summary: "Pod OOMKilled after deploy",
		rootCause: "Memory limit set too low for the new build",
		hypotheses: [{ rank: 1, statement: "OOM", evidence: [] }],
		recommendations: [{ title: "Raise memory limit", detail: "Bump to 512Mi" }],
	};

	let relay: { emit: jest.Mock; complete: jest.Mock };
	let investigations: {
		writeEngineResult: jest.Mock;
		updateStatusInternal: jest.Mock;
		updateStatus: jest.Mock;
	};
	let service: InvestigationEngineService;

	beforeEach(() => {
		jest.spyOn(Logger.prototype, "error").mockImplementation(() => {});
		relay = { emit: jest.fn(), complete: jest.fn() };
		investigations = {
			writeEngineResult: jest.fn().mockResolvedValue(null),
			updateStatusInternal: jest.fn().mockResolvedValue(null),
			updateStatus: jest.fn().mockResolvedValue(null),
		};
		// prisma + llmSettings are only used by start()/buildBackend(), not consume().
		service = new InvestigationEngineService(
			{} as never,
			relay as never,
			investigations as never,
			{} as never,
		);
	});

	it("relays every StepEvent as a [kind, event] tuple and persists the final report", async () => {
		const events: StepEvent[] = [
			{
				kind: "model_turn",
				step: 1,
				text: "looking",
				toolCalls: [{ name: "shell_exec", args: {} }],
			},
			{
				kind: "tool_result",
				step: 1,
				name: "shell_exec",
				ok: true,
				preview: "OOMKilled",
			},
			{ kind: "done", step: 2, reason: "submitted" },
			{ kind: "report", report },
		];

		await service.consume("inv-1", streamOf(events));

		expect(relay.emit).toHaveBeenCalledTimes(4);
		expect(relay.emit).toHaveBeenNthCalledWith(1, "inv-1", [
			"model_turn",
			events[0],
		]);
		expect(relay.emit).toHaveBeenNthCalledWith(2, "inv-1", [
			"tool_result",
			events[1],
		]);
		expect(relay.emit).toHaveBeenNthCalledWith(4, "inv-1", [
			"report",
			events[3],
		]);
		expect(investigations.writeEngineResult).toHaveBeenCalledWith("inv-1", {
			summary: report.summary,
			rootCause: report.rootCause,
			rawOutput: report,
		});
		expect(relay.complete).toHaveBeenCalledWith("inv-1");
	});

	it("marks the investigation failed when the stream ends without a report", async () => {
		await service.consume(
			"inv-2",
			streamOf([{ kind: "done", step: 1, reason: "no_progress" }]),
		);

		expect(investigations.writeEngineResult).not.toHaveBeenCalled();
		expect(investigations.updateStatusInternal).toHaveBeenCalledWith(
			"inv-2",
			"failed",
			undefined,
			expect.any(String),
		);
		expect(relay.complete).toHaveBeenCalledWith("inv-2");
	});

	it("emits an error event and fails the investigation if the stream throws", async () => {
		async function* boom(): AsyncGenerator<StepEvent> {
			yield { kind: "model_turn", step: 1, text: "", toolCalls: [] };
			throw new Error("backend exploded");
		}

		await service.consume("inv-3", boom());

		expect(relay.emit).toHaveBeenCalledWith("inv-3", [
			"error",
			{ message: "backend exploded" },
		]);
		expect(investigations.updateStatusInternal).toHaveBeenCalledWith(
			"inv-3",
			"failed",
			undefined,
			"backend exploded",
		);
		// complete() must fire even on failure so SSE subscribers are released.
		expect(relay.complete).toHaveBeenCalledWith("inv-3");
	});
});
