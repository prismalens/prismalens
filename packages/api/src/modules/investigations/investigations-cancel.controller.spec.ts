/**
 * CANCEL slice (ADR-0018): POST /investigations/:id/cancel publishes to the Redis
 * cancel channel (202-semantics) and rejects a run already in a terminal state. The
 * WORKER — not this endpoint — owns the terminal "cancelled" status write, so the
 * handler must NOT flip the status here. Mocked service + queue; no DB, no Redis.
 */

import { Test, type TestingModule } from "@nestjs/testing";
import { ThrottlerGuard } from "@nestjs/throttler";
import { ORPCError } from "@orpc/nest";
import { QueueService } from "../../infrastructure/queue/queue.service.js";
import { InvestigationsController } from "./investigations.controller.js";
import { InvestigationsService } from "./investigations.service.js";

const mockInvestigationsService = {
	findById: vi.fn(),
	updateStatus: vi.fn(),
};

const mockQueueService = {
	publishCancel: vi.fn(),
	getJobStatus: vi.fn(),
};

function investigation(id: string, status: string) {
	const now = new Date("2026-07-05T00:00:00.000Z");
	return {
		id,
		incidentId: "inc-1",
		status,
		startedAt: null,
		completedAt: null,
		summary: null,
		rootCause: null,
		rootCauseCategory: null,
		report: null,
		overlay: null,
		error: null,
		createdAt: now,
		updatedAt: now,
	};
}

describe("InvestigationsController.cancel (CANCEL slice, ADR-0018)", () => {
	let controller: InvestigationsController;

	beforeEach(async () => {
		vi.clearAllMocks();
		const module: TestingModule = await Test.createTestingModule({
			controllers: [InvestigationsController],
			providers: [
				{ provide: InvestigationsService, useValue: mockInvestigationsService },
				{ provide: QueueService, useValue: mockQueueService },
			],
		})
			.overrideGuard(ThrottlerGuard)
			.useValue({ canActivate: () => true })
			.compile();
		controller = module.get(InvestigationsController);
	});

	// oRPC ImplementedProcedure → the real handler lives at ['~orpc'].handler.
	// biome-ignore lint/suspicious/noExplicitAny: unwrap the oRPC procedure wrapper.
	function cancelHandler(): (args: { input: { id: string } }) => Promise<any> {
		// biome-ignore lint/suspicious/noExplicitAny: procedure map is loosely typed.
		const procs = controller.investigations() as Record<string, any>;
		return procs.cancel["~orpc"].handler;
	}

	it("running run: publishes to the cancel channel and returns the run unchanged (no status flip)", async () => {
		const run = investigation("inv-1", "running");
		mockInvestigationsService.findById.mockResolvedValue(run);
		mockQueueService.publishCancel.mockResolvedValue(true);

		const result = await cancelHandler()({ input: { id: "inv-1" } });

		expect(mockQueueService.publishCancel).toHaveBeenCalledWith("inv-1");
		// The endpoint does NOT persist a terminal status — the worker owns that write.
		expect(mockInvestigationsService.updateStatus).not.toHaveBeenCalled();
		expect(result.status).toBe("running");
	});

	it("pending run: also cancellable (publishes)", async () => {
		mockInvestigationsService.findById.mockResolvedValue(
			investigation("inv-2", "pending"),
		);
		mockQueueService.publishCancel.mockResolvedValue(true);

		await cancelHandler()({ input: { id: "inv-2" } });

		expect(mockQueueService.publishCancel).toHaveBeenCalledWith("inv-2");
	});

	it.each([
		"completed",
		"failed",
		"cancelled",
	])("rejects cancel for a terminal run (%s) and does NOT publish", async (status) => {
		mockInvestigationsService.findById.mockResolvedValue(
			investigation("inv-3", status),
		);

		await expect(
			cancelHandler()({ input: { id: "inv-3" } }),
		).rejects.toBeInstanceOf(ORPCError);
		expect(mockQueueService.publishCancel).not.toHaveBeenCalled();
	});

	it("unknown investigation: NOT_FOUND, no publish", async () => {
		mockInvestigationsService.findById.mockResolvedValue(null);

		await expect(
			cancelHandler()({ input: { id: "missing" } }),
		).rejects.toBeInstanceOf(ORPCError);
		expect(mockQueueService.publishCancel).not.toHaveBeenCalled();
	});
});
