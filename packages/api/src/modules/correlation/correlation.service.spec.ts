// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Logger } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Test } from "@nestjs/testing";
import type { Alert } from "@prismalens/database";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { ALERT_CORRELATED_EVENT } from "../../shared/events/investigation-events.js";
import { IncidentsService } from "../incidents/incidents.service.js";
import {
	type CorrelationResult,
	CorrelationService,
} from "./correlation.service.js";

describe("CorrelationService", () => {
	let service: CorrelationService;

	const mockPrisma = {
		correlationRule: {
			findMany: vi.fn(),
		},
		incident: {
			findFirst: vi.fn(),
			update: vi.fn(),
		},
		alert: {
			findFirst: vi.fn(),
		},
	};

	const mockIncidentsService = {
		create: vi.fn(),
		addAlert: vi.fn(),
	};

	const mockEventEmitter = {
		emit: vi.fn(),
	};

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.spyOn(Logger.prototype, "log").mockImplementation(() => {});
		vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
		vi.spyOn(Logger.prototype, "debug").mockImplementation(() => {});
		vi.spyOn(Logger.prototype, "error").mockImplementation(() => {});

		const moduleRef = await Test.createTestingModule({
			providers: [
				CorrelationService,
				{ provide: PrismaService, useValue: mockPrisma },
				{ provide: IncidentsService, useValue: mockIncidentsService },
				{ provide: EventEmitter2, useValue: mockEventEmitter },
			],
		}).compile();

		service = moduleRef.get(CorrelationService);
	});

	describe("correlateAlert", () => {
		it("should emit ALERT_CORRELATED_EVENT when alert matches and links to incident", async () => {
			// Simulate a matched result from the private runCorrelation method by mocking its dependencies
			// The easiest way is to spy on the private method
			const spyTarget = service as unknown as {
				runCorrelation: (alert: Alert) => Promise<CorrelationResult>;
			};
			vi.spyOn(spyTarget, "runCorrelation").mockResolvedValue({
				matched: true,
				incidentId: "inc-1",
				isNewIncident: false,
			} as CorrelationResult);

			const alert = { id: "alert-1" } as Alert;

			await service.correlateAlert(alert);

			expect(mockEventEmitter.emit).toHaveBeenCalledTimes(1);
			expect(mockEventEmitter.emit).toHaveBeenCalledWith(
				ALERT_CORRELATED_EVENT,
				{
					alertId: "alert-1",
					incidentId: "inc-1",
					isNewIncident: false,
				},
			);
		});

		it("should not emit when correlation returns suppressed/unmatched result", async () => {
			const spyTarget = service as unknown as {
				runCorrelation: (alert: Alert) => Promise<CorrelationResult>;
			};
			vi.spyOn(spyTarget, "runCorrelation").mockResolvedValue({
				matched: false,
				isNewIncident: false,
			} as CorrelationResult);

			const alert = { id: "alert-1" } as Alert;

			await service.correlateAlert(alert);

			expect(mockEventEmitter.emit).not.toHaveBeenCalled();
		});
	});
});
