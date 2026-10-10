// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** POST /investigations/:id/asks/:askId (#673 w21). Mocked service + dispatch. */

import { Test, type TestingModule } from "@nestjs/testing";
import { ORPCError } from "@orpc/nest";
import { telemetryStub } from "../../../test/factories/index.js";
import { HarnessService } from "../../core/harness/harness.service.js";
import { TelemetryService } from "../../core/telemetry/telemetry.service.js";
import { MutationThrottleGuard } from "../../core/throttle/mutation-throttle.guard.js";
import { DispatchService } from "../../infrastructure/dispatch/dispatch.service.js";
import { GitHubCommentService } from "../delivery/github-comment.service.js";
import { AttachmentsService } from "./attachments.service.js";
import { InvestigationsController } from "./investigations.controller.js";
import { InvestigationsService } from "./investigations.service.js";

const mockInvestigationsService = {
	findById: vi.fn(),
};

const mockDispatchService = {
	answerAsk: vi.fn(),
};

describe("InvestigationsController.answerAsk (#673 w21)", () => {
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
				{
					provide: AttachmentsService,
					useValue: { forJob: vi.fn(async () => []) },
				},
				{ provide: HarnessService, useValue: {} },
			],
		})
			.overrideGuard(MutationThrottleGuard)
			.useValue({ canActivate: () => true })
			.compile();
		controller = module.get(InvestigationsController);
	});

	type Input = { id: string; askId: string; decision: "approve" | "deny" };
	function answerAskHandler(): (
		args: { input: Input },
	) => Promise<{ outcome: "approved" | "denied" }> {
		const procs = controller.investigations() as unknown as {
			answerAsk: {
				"~orpc": {
					handler: (args: { input: Input }) => Promise<{
						outcome: "approved" | "denied";
					}>;
				};
			};
		};
		return procs.answerAsk["~orpc"].handler;
	}

	it("answers { outcome: 'approved' } when approved", async () => {
		mockDispatchService.answerAsk.mockReturnValue("approved");

		const result = await answerAskHandler()({
			input: { id: "inv-1", askId: "ask-1", decision: "approve" },
		});

		expect(mockDispatchService.answerAsk).toHaveBeenCalledWith(
			"inv-1",
			"ask-1",
			true,
		);
		expect(result).toEqual({ outcome: "approved" });
	});

	it("answers { outcome: 'denied' } when denied", async () => {
		mockDispatchService.answerAsk.mockReturnValue("denied");

		const result = await answerAskHandler()({
			input: { id: "inv-1", askId: "ask-1", decision: "deny" },
		});

		expect(mockDispatchService.answerAsk).toHaveBeenCalledWith(
			"inv-1",
			"ask-1",
			false,
		);
		expect(result).toEqual({ outcome: "denied" });
	});

	it("throws CONFLICT when dispatchService.answerAsk returns null", async () => {
		mockDispatchService.answerAsk.mockReturnValue(null);

		await expect(
			answerAskHandler()({
				input: { id: "inv-1", askId: "ask-1", decision: "approve" },
			}),
		).rejects.toMatchObject({
			code: "CONFLICT",
			message:
				"This ask is no longer waiting: it was answered, timed out, or the run ended.",
		});
		expect(mockDispatchService.answerAsk).toHaveBeenCalledWith(
			"inv-1",
			"ask-1",
			true,
		);
	});
});
