// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** The controller on a run whose subject is a service, with no incident yet (#979). */

import { Test, type TestingModule } from "@nestjs/testing";
import { MutationThrottleGuard } from "../../core/throttle/mutation-throttle.guard.js";
import { DispatchService } from "../../infrastructure/dispatch/dispatch.service.js";
import { HarnessService } from "../../core/harness/harness.service.js";
import { TelemetryService } from "../../core/telemetry/telemetry.service.js";
import { telemetryStub } from "../../../test/factories/index.js";
import { AttachmentsService } from "./attachments.service.js";
import { InvestigationsController } from "./investigations.controller.js";
import { InvestigationsService } from "./investigations.service.js";

const service = { findById: vi.fn(), findAll: vi.fn() };
const attachments = { forJob: vi.fn(async () => []) };

function check(over: Record<string, unknown> = {}) {
	const now = new Date("2026-10-28T09:00:00.000Z");
	return {
		id: "inv-check",
		incidentId: null,
		serviceId: "svc-1",
		scheduleId: "sch-1",
		status: "completed",
		kind: "investigation",
		startedAt: now,
		completedAt: now,
		summary: "All quiet.",
		rootCause: null,
		rootCauseCategory: null,
		report: JSON.stringify({
			summary: "All quiet.",
			rootCause: null,
			hypotheses: [],
			ruledOut: [],
			coverage: { queried: [], notQueried: [] },
			nextSteps: [],
		}),
		overlay: null,
		error: null,
		triggerType: "scheduled",
		workspace: null,
		incident: null,
		recommendations: [],
		createdAt: now,
		updatedAt: now,
		...over,
	};
}

describe("InvestigationsController on a service check with no incident (#979)", () => {
	let controller: InvestigationsController;

	beforeEach(async () => {
		vi.clearAllMocks();
		const module: TestingModule = await Test.createTestingModule({
			controllers: [InvestigationsController],
			providers: [
				{ provide: InvestigationsService, useValue: service },
				{ provide: DispatchService, useValue: {} },
				{ provide: TelemetryService, useValue: telemetryStub() },
				{ provide: AttachmentsService, useValue: attachments },
				{ provide: HarnessService, useValue: { launchProbe: () => ({}), modeName: () => null } },
			],
		})
			.overrideGuard(MutationThrottleGuard)
			.useValue({ canActivate: () => true })
			.compile();
		controller = module.get(InvestigationsController);
	});

	// biome-ignore lint/suspicious/noExplicitAny: unwrap the oRPC procedure wrapper.
	const handler = (name: string): ((args: { input: any }) => Promise<any>) =>
		// biome-ignore lint/suspicious/noExplicitAny: procedure map is loosely typed.
		(controller.investigations() as Record<string, any>)[name]["~orpc"].handler;

	it("get serialises it with a null incident, its service and its schedule", async () => {
		service.findById.mockResolvedValue(check());

		const out = await handler("get")({ input: { id: "inv-check" } });

		expect(out).toMatchObject({ id: "inv-check", incidentId: null, incidentNumber: null, serviceId: "svc-1", scheduleId: "sch-1" });
	});

	it("list serialises it beside incident-owned runs", async () => {
		service.findAll.mockResolvedValue({
			data: [check(), check({ id: "inv-2", incidentId: "inc-1", incident: { id: "inc-1", number: 9, title: "t", severity: "high", status: "open" } })],
			total: 2,
		});

		const out = await handler("list")({ input: { limit: 10, offset: 0 } });

		expect(out.data.map((r: { incidentNumber: number | null }) => r.incidentNumber)).toEqual([null, 9]);
	});

	it("an incident-owned run still serialises without a service or schedule", async () => {
		service.findById.mockResolvedValue(
			check({ incidentId: "inc-1", serviceId: null, scheduleId: null, incident: { id: "inc-1", number: 9, title: "t", severity: "high", status: "open" } }),
		);

		const out = await handler("get")({ input: { id: "inv-check" } });

		expect(out).toMatchObject({ incidentId: "inc-1", incidentNumber: 9, serviceId: null, scheduleId: null });
	});

	it("exportMarkdown answers NOT_FOUND with where the report is", async () => {
		service.findById.mockResolvedValue(check());

		await expect(handler("exportMarkdown")({ input: { id: "inv-check" } })).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "This run has no incident yet; its report is on the schedule's page.",
		});
	});

	it("a follow-up carrying attachments answers BAD_REQUEST: attachments belong to an incident", async () => {
		service.findById.mockResolvedValue(check());

		await expect(
			handler("message")({ input: { id: "inv-check", text: "look", mode: "queue", attachments: ["a1"] } }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(attachments.forJob).not.toHaveBeenCalled();
	});
});
