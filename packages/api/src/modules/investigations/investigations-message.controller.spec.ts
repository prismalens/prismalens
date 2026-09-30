// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** POST /investigations/:id/messages (#743). Mocked service + dispatch. */

import { Test, type TestingModule } from "@nestjs/testing";
import { ThrottlerGuard } from "@nestjs/throttler";
import { ORPCError } from "@orpc/nest";
import { DispatchService } from "../../infrastructure/dispatch/dispatch.service.js";
import { InvestigationsController } from "./investigations.controller.js";
import { InvestigationsService } from "./investigations.service.js";
import { GitHubCommentService } from "../delivery/github-comment.service.js";
import { TelemetryService } from "../../core/telemetry/telemetry.service.js";
import { telemetryStub } from "../../../test/factories/index.js";

const mockInvestigationsService = {
	findById: vi.fn(),
};

const mockDispatchService = {
	sendMessage: vi.fn(),
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

describe("InvestigationsController.message (#743)", () => {
	let controller: InvestigationsController;

	beforeEach(async () => {
		vi.clearAllMocks();
		const module: TestingModule = await Test.createTestingModule({
			controllers: [InvestigationsController],
			providers: [
				{ provide: InvestigationsService, useValue: mockInvestigationsService },
				{ provide: DispatchService, useValue: mockDispatchService },
				{ provide: TelemetryService, useValue: telemetryStub() },
				{ provide: GitHubCommentService, useValue: { post: vi.fn() } },
			],
		})
			.overrideGuard(ThrottlerGuard)
			.useValue({ canActivate: () => true })
			.compile();
		controller = module.get(InvestigationsController);
	});

	type Input = { id: string; text: string; mode: "queue" | "now" };
	// biome-ignore lint/suspicious/noExplicitAny: unwrap the oRPC procedure wrapper.
	function messageHandler(): (args: { input: Input }) => Promise<any> {
		// biome-ignore lint/suspicious/noExplicitAny: procedure map is loosely typed.
		const procs = controller.investigations() as Record<string, any>;
		return procs.message["~orpc"].handler;
	}

	it("queues a message on a running run", async () => {
		mockInvestigationsService.findById.mockResolvedValue(investigation("inv-1", "running"));
		mockDispatchService.sendMessage.mockReturnValue("queued");

		const result = await messageHandler()({ input: { id: "inv-1", text: "check the TTL", mode: "queue" } });

		expect(mockDispatchService.sendMessage).toHaveBeenCalledWith("inv-1", "check the TTL", "queue");
		expect(result).toEqual({ state: "queued" });
	});

	it("refuses a finished run without touching the bus", async () => {
		mockInvestigationsService.findById.mockResolvedValue(investigation("inv-1", "completed"));

		await expect(
			messageHandler()({ input: { id: "inv-1", text: "hi", mode: "now" } }),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(mockDispatchService.sendMessage).not.toHaveBeenCalled();
	});

	it("retries while nothing holds the run yet, then refuses", async () => {
		mockInvestigationsService.findById.mockResolvedValue(investigation("inv-1", "pending"));
		mockDispatchService.sendMessage.mockReturnValue(null);

		await expect(
			messageHandler()({ input: { id: "inv-1", text: "hi", mode: "queue" } }),
		).rejects.toBeInstanceOf(ORPCError);
		expect(mockDispatchService.sendMessage).toHaveBeenCalledTimes(3);
	});

	it("answers sent once a retry finds the run holder", async () => {
		mockInvestigationsService.findById.mockResolvedValue(investigation("inv-1", "running"));
		mockDispatchService.sendMessage.mockReturnValueOnce(null).mockReturnValueOnce("sent");

		const result = await messageHandler()({ input: { id: "inv-1", text: "stop and look", mode: "now" } });

		expect(result).toEqual({ state: "sent" });
	});
});
