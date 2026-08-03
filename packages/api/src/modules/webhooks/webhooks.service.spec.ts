// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Test, TestingModule } from "@nestjs/testing";
import { Severity } from "../../shared/enums/index.js";
import { AlertMappingService } from "../alert-mapping/alert-mapping.service.js";
import { AlertsService } from "../alerts/alerts.service.js";
import { CorrelationService } from "../correlation/correlation.service.js";
import { EventsService } from "../events/events.service.js";
import { WebhooksService } from "./webhooks.service.js";

describe("WebhooksService", () => {
	let service: WebhooksService;
	let eventsService: EventsService;
	let alertsService: AlertsService;
	let correlationService: CorrelationService;
	let alertMappingService: AlertMappingService;

	const mockEvent = {
		id: "evt-123",
		source: "generic",
		eventType: "alert",
		payload: "{}",
		receivedAt: new Date(),
		eventTime: null,
		processed: true,
		alertId: "alt-123",
		tenantId: null,
		sourceEventId: null,
		idempotencyKey: null,
	};

	const mockAlert = {
		id: "alt-123",
		dedupKey: "key-123",
		fingerprint: "fp-123",
		externalId: null,
		title: "Test Alert",
		description: "Test Description",
		severity: Severity.medium,
		status: "triggered",
		source: "generic",
		sourceUrl: null,
		serviceId: null,
		tags: null,
		labels: null,
		triggeredAt: new Date(),
		acknowledgedAt: null,
		resolvedAt: null,
		occurrenceCount: 1,
		lastOccurrence: new Date(),
		rawPayload: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		tenantId: null,
		incidentId: "inc-123",
		incident: {
			id: "inc-123",
			number: 42,
			title: "Test Incident",
			status: "triggered",
		},
	};

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				WebhooksService,
				{
					provide: EventsService,
					useValue: {
						create: vi.fn().mockResolvedValue(mockEvent),
						markProcessed: vi.fn().mockResolvedValue(mockEvent),
						findByIdempotencyKey: vi.fn(),
					},
				},
				{
					provide: AlertsService,
					useValue: {
						create: vi.fn().mockResolvedValue(mockAlert),
						findById: vi.fn().mockResolvedValue(mockAlert),
					},
				},
				{
					provide: CorrelationService,
					useValue: {
						correlateAlert: vi.fn().mockResolvedValue({
							incidentId: "inc-123",
							incidentNumber: 42,
							reason: "Correlated to existing incident",
							isNewIncident: false,
						}),
					},
				},
				{
					provide: AlertMappingService,
					useValue: {
						resolveServiceForAlert: vi.fn().mockResolvedValue(null),
					},
				},
			],
		}).compile();

		service = module.get<WebhooksService>(WebhooksService);
		eventsService = module.get<EventsService>(EventsService);
		alertsService = module.get<AlertsService>(AlertsService);
		correlationService = module.get<CorrelationService>(CorrelationService);
		alertMappingService = module.get<AlertMappingService>(AlertMappingService);
	});

	it("processes generic webhook without idempotency key", async () => {
		const result = await service.processGenericWebhook({
			title: "Test Alert",
			description: "Test Description",
		});

		expect(eventsService.create).toHaveBeenCalledTimes(1);
		expect(alertsService.create).toHaveBeenCalledTimes(1);
		expect(result.alert.id).toBe("alt-123");
		expect(result.incidentId).toBe("inc-123");
	});

	it("processes Render webhook without idempotency key", async () => {
		const result = await service.processRenderWebhook({
			type: "deploy",
			deploy: { id: "dep-1", status: "deploy_failed" },
			service: { id: "srv-1", name: "my-service" },
		});

		expect(eventsService.create).toHaveBeenCalledTimes(1);
		expect(alertsService.create).toHaveBeenCalledTimes(1);
		expect(result.alert.id).toBe("alt-123");
	});

	it("returns cached response on idempotent replay without re-creating event or alert", async () => {
		vi.mocked(eventsService.findByIdempotencyKey).mockResolvedValueOnce({
			...mockEvent,
			idempotencyKey: "idem-key-999",
		});

		const result = await service.processGenericWebhook(
			{
				title: "Test Alert",
			},
			"idem-key-999",
		);

		expect(eventsService.findByIdempotencyKey).toHaveBeenCalledWith(
			"idem-key-999",
		);
		expect(eventsService.create).not.toHaveBeenCalled();
		expect(alertsService.create).not.toHaveBeenCalled();
		expect(correlationService.correlateAlert).not.toHaveBeenCalled();
		expect(result.alert.id).toBe("alt-123");
		expect(result.incidentId).toBe("inc-123");
		expect(result.incidentNumber).toBe(42);
		expect(result.correlationReason).toContain("Idempotent replay");
	});
});
