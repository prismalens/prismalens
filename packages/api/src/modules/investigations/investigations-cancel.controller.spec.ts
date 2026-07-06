/**
 * CANCEL slice (ADR-0018): POST /investigations/:id/cancel publishes to the Redis
 * cancel channel and rejects a run already in a terminal state. A worker that
 * RECEIVED the publish owns the terminal "cancelled" write; when nobody received it
 * (after the grace retries), the API owns the fallback terminal write — pub/sub has
 * no retention, so zero receivers means nobody else ever will. Mocked service +
 * queue; no DB, no Redis.
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
	cancelPending: vi.fn(),
};

const mockQueueService = {
	publishCancel: vi.fn(),
	getJobStatus: vi.fn(),
	removeJob: vi.fn(),
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
		mockQueueService.publishCancel.mockResolvedValue(1);

		const result = await cancelHandler()({ input: { id: "inv-1" } });

		expect(mockQueueService.publishCancel).toHaveBeenCalledWith("inv-1");
		// A worker received the cancel — it owns the terminal write, not this endpoint.
		expect(mockInvestigationsService.cancelPending).not.toHaveBeenCalled();
		// A running run is never removed from the queue (it is already active).
		expect(mockQueueService.removeJob).not.toHaveBeenCalled();
		expect(result.status).toBe("running");
	});

	it("running run nobody hears: retries the publish, then writes the terminal record itself", async () => {
		const run = investigation("inv-5", "running");
		mockInvestigationsService.findById.mockResolvedValue(run);
		// Zero receivers on every attempt: worker crashed / stuck record / Redis down.
		mockQueueService.publishCancel.mockResolvedValue(0);
		mockInvestigationsService.cancelPending.mockResolvedValue(
			investigation("inv-5", "cancelled"),
		);

		const result = await cancelHandler()({ input: { id: "inv-5" } });

		expect(mockQueueService.publishCancel).toHaveBeenCalledTimes(3);
		// Nobody will ever act on the dropped publish — the API owns the write.
		expect(mockInvestigationsService.cancelPending).toHaveBeenCalledWith(
			"inv-5",
			"inc-1",
			expect.stringContaining("no worker held the run"),
		);
		expect(result.status).toBe("cancelled");
	});

	it("running run heard on a retry: no fallback write", async () => {
		const run = investigation("inv-6", "running");
		mockInvestigationsService.findById.mockResolvedValue(run);
		// First publish lands in the worker's lock→subscribe window; the retry is heard.
		mockQueueService.publishCancel
			.mockResolvedValueOnce(0)
			.mockResolvedValueOnce(1);

		const result = await cancelHandler()({ input: { id: "inv-6" } });

		expect(mockQueueService.publishCancel).toHaveBeenCalledTimes(2);
		expect(mockInvestigationsService.cancelPending).not.toHaveBeenCalled();
		expect(result.status).toBe("running");
	});

	it("pending run: removes the queued job and writes the terminal 'cancelled' record (no publish)", async () => {
		mockInvestigationsService.findById.mockResolvedValue(
			investigation("inv-2", "pending"),
		);
		mockQueueService.removeJob.mockResolvedValue(true);
		mockInvestigationsService.cancelPending.mockResolvedValue(
			investigation("inv-2", "cancelled"),
		);

		const result = await cancelHandler()({ input: { id: "inv-2" } });

		// A pending run has no subscribed worker — removing the job is the reliable stop.
		expect(mockQueueService.removeJob).toHaveBeenCalledWith(
			"investigation-inv-2",
		);
		// The API owns the terminal write for a pending cancel (no worker has the run).
		expect(mockInvestigationsService.cancelPending).toHaveBeenCalledWith(
			"inv-2",
			"inc-1",
		);
		// No fire-and-forget publish — pub/sub would be dropped with no subscriber.
		expect(mockQueueService.publishCancel).not.toHaveBeenCalled();
		expect(result.status).toBe("cancelled");
	});

	it("pending run but the worker won the race: removal fails → falls through to publish", async () => {
		mockInvestigationsService.findById.mockResolvedValue(
			investigation("inv-4", "pending"),
		);
		// removeJob returns false when a worker grabbed (locked) the job mid-race.
		mockQueueService.removeJob.mockResolvedValue(false);
		mockQueueService.publishCancel.mockResolvedValue(1);

		await cancelHandler()({ input: { id: "inv-4" } });

		expect(mockQueueService.removeJob).toHaveBeenCalledWith(
			"investigation-inv-4",
		);
		// The worker now owns the run → the publish path (worker owns the terminal write).
		expect(mockQueueService.publishCancel).toHaveBeenCalledWith("inv-4");
		expect(mockInvestigationsService.cancelPending).not.toHaveBeenCalled();
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
