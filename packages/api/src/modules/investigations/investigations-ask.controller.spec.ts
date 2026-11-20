// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** POST /investigations/:id/asks/:askId (#673 w21). Mocked service + dispatch. */

import { Test, type TestingModule } from "@nestjs/testing";
import { ORPCError } from "@orpc/nest";
import { ASK_REFUSAL } from "@prismalens/contracts";
import { composerStubs, telemetryStub } from "../../../test/factories/index.js";
import { HarnessService } from "../../core/harness/harness.service.js";
import { SessionLifecycleService } from "../wakes/session-lifecycle.service.js";
import { TelemetryService } from "../../core/telemetry/telemetry.service.js";
import { MutationThrottleGuard } from "../../core/throttle/mutation-throttle.guard.js";
import { DispatchService } from "../../infrastructure/dispatch/dispatch.service.js";
import { AttachmentsService } from "./attachments.service.js";
import { InvestigationsController } from "./investigations.controller.js";
import { InvestigationsService } from "./investigations.service.js";

const mockInvestigationsService = {
	findById: vi.fn(),
	rememberAsk: vi.fn(async () => "remembered"),
};

const mockDispatchService = {
	answerAsk: vi.fn(),
};

describe("InvestigationsController.answerAsk (#673 w21)", () => {
	let controller: InvestigationsController;

	beforeEach(async () => {
		vi.clearAllMocks();
		mockInvestigationsService.findById.mockResolvedValue(null);
		const module: TestingModule = await Test.createTestingModule({
			controllers: [InvestigationsController],
			providers: [
				...composerStubs(mockDispatchService),
				{ provide: InvestigationsService, useValue: mockInvestigationsService },
				{ provide: DispatchService, useValue: mockDispatchService },
				{ provide: TelemetryService, useValue: telemetryStub() },
				{
					provide: AttachmentsService,
					useValue: { forJob: vi.fn(async () => []) },
				},
				{ provide: HarnessService, useValue: { launchProbe: () => ({}) } },
				{ provide: SessionLifecycleService, useValue: { sessionOf: async () => undefined } },
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
		mockDispatchService.answerAsk.mockReturnValue({ outcome: "approved" });

		const result = await answerAskHandler()({
			input: { id: "inv-1", askId: "ask-1", decision: "approve" },
		});

		expect(mockDispatchService.answerAsk).toHaveBeenCalledWith(
			"inv-1",
			"ask-1",
			{ kind: "permission", decision: "approve" },
		);
		expect(result).toEqual({ outcome: "approved" });
	});

	it("answers { outcome: 'denied' } when denied", async () => {
		mockDispatchService.answerAsk.mockReturnValue({ outcome: "denied" });

		const result = await answerAskHandler()({
			input: { id: "inv-1", askId: "ask-1", decision: "deny" },
		});

		expect(mockDispatchService.answerAsk).toHaveBeenCalledWith(
			"inv-1",
			"ask-1",
			{ kind: "permission", decision: "deny" },
		);
		expect(result).toEqual({ outcome: "denied" });
	});

	describe("a run PrismaLens started (#1020 R33)", () => {
		type Full = { input: Input & { always?: boolean }; context: { request: unknown } };
		const call = (input: Input & { always?: boolean }, host: boolean) =>
			(answerAskHandler() as unknown as (a: Full) => Promise<unknown>)({
				input,
				context: { request: { operator: { device: { id: "d", scopes: host ? ["admin:access"] : [] } } } },
			});
		const ask = { id: "inv-1", askId: "ask-1", decision: "approve" as const };

		it("only the host answers a schedule's or an alert's run, refused with the ask's own sentence; a paired device may answer its own thread's", async () => {
			mockDispatchService.answerAsk.mockReturnValue({ outcome: "approved" });
			mockInvestigationsService.findById.mockResolvedValue({ id: "inv-1", scheduleId: "sch-1", triggerType: "scheduled" });
			await expect(call(ask, false)).rejects.toMatchObject({ code: "FORBIDDEN", message: ASK_REFUSAL.startedByPrismaLens });
			mockInvestigationsService.findById.mockResolvedValue({ id: "inv-1", scheduleId: null, triggerType: "auto_critical" });
			await expect(call(ask, false)).rejects.toMatchObject({ code: "FORBIDDEN", message: ASK_REFUSAL.startedByPrismaLens });
			expect(mockDispatchService.answerAsk).not.toHaveBeenCalled();
			await expect(call(ask, true)).resolves.toEqual({ outcome: "approved" });
			mockInvestigationsService.findById.mockResolvedValue({ id: "inv-1", scheduleId: null, triggerType: "manual" });
			await expect(call(ask, false)).resolves.toEqual({ outcome: "approved" });
		});

		it("Always allow is remembered only for an approved ask on a schedule's run", async () => {
			mockDispatchService.answerAsk.mockReturnValue({ outcome: "approved" });
			mockInvestigationsService.findById.mockResolvedValue({ id: "inv-1", scheduleId: null, triggerType: "manual" });
			await expect(call({ ...ask, always: true }, true)).rejects.toMatchObject({ code: "BAD_REQUEST" });
			mockInvestigationsService.findById.mockResolvedValue({ id: "inv-1", scheduleId: "sch-1", triggerType: "scheduled" });
			await expect(call({ ...ask, decision: "deny", always: true }, true)).rejects.toMatchObject({ code: "BAD_REQUEST" });
			expect(mockInvestigationsService.rememberAsk).not.toHaveBeenCalled();
			await expect(call({ ...ask, always: true }, true)).resolves.toEqual({ outcome: "approved" });
			expect(mockInvestigationsService.rememberAsk).toHaveBeenCalledWith("inv-1", "ask-1");
		});
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
			{ kind: "permission", decision: "approve" },
		);
	});
});
