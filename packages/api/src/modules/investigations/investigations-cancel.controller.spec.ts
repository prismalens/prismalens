// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * CANCEL slice (ADR-0018): POST /investigations/:id/cancel publishes on the run's
 * EventBus cancel topic and rejects a run already in a terminal state. A dispatcher
 * that RECEIVED the publish owns the terminal "cancelled" write; when nobody received
 * it (after the grace retries), the API owns the fallback terminal write — the bus has
 * no retention, so zero receivers means nobody else ever will. Mocked service +
 * dispatch; no DB, no broker.
 */

import { Test, type TestingModule } from "@nestjs/testing";
import { ThrottlerGuard } from "@nestjs/throttler";
import { ORPCError } from "@orpc/nest";
import { DispatchService } from "../../infrastructure/dispatch/dispatch.service.js";
import { InvestigationsController } from "./investigations.controller.js";
import { InvestigationsService } from "./investigations.service.js";

const mockInvestigationsService = {
	findById: vi.fn(),
	updateStatus: vi.fn(),
	cancelPending: vi.fn(),
};

const mockDispatchService = {
	requestCancel: vi.fn(),
	getJobStatus: vi.fn(),
	cancelPendingJob: vi.fn(),
	cancelOrphanedRun: vi.fn(),
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
				{ provide: DispatchService, useValue: mockDispatchService },
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
		mockDispatchService.requestCancel.mockResolvedValue(1);

		const result = await cancelHandler()({ input: { id: "inv-1" } });

		expect(mockDispatchService.requestCancel).toHaveBeenCalledWith("inv-1");
		// A dispatcher received the cancel — it owns the terminal write, not this endpoint.
		expect(mockInvestigationsService.cancelPending).not.toHaveBeenCalled();
		// A running run is never cancelled at the row level (it is already claimed).
		expect(mockDispatchService.cancelPendingJob).not.toHaveBeenCalled();
		expect(result.status).toBe("running");
	});

	it("running run nobody hears: retries the publish, then writes the terminal record itself", async () => {
		const run = investigation("inv-5", "running");
		mockInvestigationsService.findById.mockResolvedValue(run);
		// Zero receivers on every attempt: child crashed, or the record is stuck.
		mockDispatchService.requestCancel.mockResolvedValue(0);
		mockInvestigationsService.cancelPending.mockResolvedValue(
			investigation("inv-5", "cancelled"),
		);

		const result = await cancelHandler()({ input: { id: "inv-5" } });

		expect(mockDispatchService.requestCancel).toHaveBeenCalledTimes(3);
		// Nobody will ever act on the dropped publish — the API owns the write.
		expect(mockInvestigationsService.cancelPending).toHaveBeenCalledWith(
			"inv-5",
			"inc-1",
			expect.stringContaining("no run held it"),
		);
		expect(result.status).toBe("cancelled");
	});

	it("running run nobody hears: also cancels the orphaned job row, so the sweeper cannot rerun it", async () => {
		const run = investigation("inv-7", "running");
		mockInvestigationsService.findById.mockResolvedValue(run);
		mockDispatchService.requestCancel.mockResolvedValue(0);
		mockInvestigationsService.cancelPending.mockResolvedValue(
			investigation("inv-7", "cancelled"),
		);

		await cancelHandler()({ input: { id: "inv-7" } });

		// The row would otherwise stay `running`, go stale, and be returned to `pending`
		// by reclaimStale — rerunning an investigation the user explicitly cancelled.
		expect(mockDispatchService.cancelOrphanedRun).toHaveBeenCalledWith("inv-7");
	});

	it("running run heard on a retry: no fallback write", async () => {
		const run = investigation("inv-6", "running");
		mockInvestigationsService.findById.mockResolvedValue(run);
		// First publish lands in the claim→subscribe window; the retry is heard.
		mockDispatchService.requestCancel
			.mockResolvedValueOnce(0)
			.mockResolvedValueOnce(1);

		const result = await cancelHandler()({ input: { id: "inv-6" } });

		expect(mockDispatchService.requestCancel).toHaveBeenCalledTimes(2);
		expect(mockInvestigationsService.cancelPending).not.toHaveBeenCalled();
		expect(result.status).toBe("running");
	});

	it("pending run: cancels the unclaimed job and writes the terminal 'cancelled' record (no publish)", async () => {
		mockInvestigationsService.findById.mockResolvedValue(
			investigation("inv-2", "pending"),
		);
		mockDispatchService.cancelPendingJob.mockResolvedValue(true);
		mockInvestigationsService.cancelPending.mockResolvedValue(
			investigation("inv-2", "cancelled"),
		);

		const result = await cancelHandler()({ input: { id: "inv-2" } });

		// A pending run has nothing subscribed — cancelling the row is the reliable stop.
		expect(mockDispatchService.cancelPendingJob).toHaveBeenCalledWith("inv-2");
		// The API owns the terminal write for a pending cancel (nobody holds the run).
		expect(mockInvestigationsService.cancelPending).toHaveBeenCalledWith(
			"inv-2",
			"inc-1",
		);
		// No fire-and-forget publish — it would be dropped with no subscriber.
		expect(mockDispatchService.requestCancel).not.toHaveBeenCalled();
		expect(result.status).toBe("cancelled");
	});

	it("pending run but a dispatcher won the race: row cancel fails → falls through to publish", async () => {
		mockInvestigationsService.findById.mockResolvedValue(
			investigation("inv-4", "pending"),
		);
		// cancelPendingJob returns false when a dispatcher claimed the job mid-race.
		mockDispatchService.cancelPendingJob.mockResolvedValue(false);
		mockDispatchService.requestCancel.mockResolvedValue(1);

		await cancelHandler()({ input: { id: "inv-4" } });

		expect(mockDispatchService.cancelPendingJob).toHaveBeenCalledWith("inv-4");
		// The run is live → the publish path (the run owns the terminal write).
		expect(mockDispatchService.requestCancel).toHaveBeenCalledWith("inv-4");
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
		expect(mockDispatchService.requestCancel).not.toHaveBeenCalled();
	});

	it("unknown investigation: NOT_FOUND, no publish", async () => {
		mockInvestigationsService.findById.mockResolvedValue(null);

		await expect(
			cancelHandler()({ input: { id: "missing" } }),
		).rejects.toBeInstanceOf(ORPCError);
		expect(mockDispatchService.requestCancel).not.toHaveBeenCalled();
	});
});
