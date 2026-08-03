// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Test, TestingModule } from "@nestjs/testing";
import { Prisma } from "@prismalens/database";
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

	/** Unique constraint on Event.idempotencyKey — what a lost race throws. */
	const uniqueKeyViolation = () =>
		new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
			code: "P2002",
			clientVersion: "7.9.1",
			meta: { target: ["idempotencyKey"] },
		});

	it("returns the winner's result when a concurrent delivery wins the insert race (P2002)", async () => {
		// Nothing on the read path — both deliveries think they are first.
		vi.mocked(eventsService.findByIdempotencyKey).mockResolvedValueOnce(null);
		vi.mocked(eventsService.create).mockRejectedValueOnce(uniqueKeyViolation());
		// By the time we re-read, the winner has linked its alert.
		vi.mocked(eventsService.findByIdempotencyKey).mockResolvedValueOnce({
			...mockEvent,
			idempotencyKey: "idem-race",
		});

		const result = await service.processGenericWebhook(
			{ title: "Test Alert" },
			"idem-race",
		);

		expect(eventsService.create).toHaveBeenCalledTimes(1);
		expect(alertsService.create).not.toHaveBeenCalled();
		expect(correlationService.correlateAlert).not.toHaveBeenCalled();
		expect(result.alert.id).toBe("alt-123");
		expect(result.correlationReason).toContain("Idempotent replay");
	});

	it("rejects with CONFLICT while a delivery for the same key is still in flight", async () => {
		vi.mocked(eventsService.findByIdempotencyKey).mockResolvedValueOnce({
			...mockEvent,
			idempotencyKey: "idem-inflight",
			alertId: null,
			processed: false,
			receivedAt: new Date(),
		});

		await expect(
			service.processGenericWebhook({ title: "Test Alert" }, "idem-inflight"),
		).rejects.toMatchObject({ code: "CONFLICT" });

		expect(eventsService.create).not.toHaveBeenCalled();
		expect(alertsService.create).not.toHaveBeenCalled();
	});

	it("resumes an abandoned event instead of blocking the delivery forever", async () => {
		// An event whose original attempt died between create and markProcessed,
		// long enough ago that no delivery can still be in flight.
		const abandoned = {
			...mockEvent,
			id: "evt-abandoned",
			idempotencyKey: "idem-abandoned",
			alertId: null,
			processed: false,
			receivedAt: new Date(Date.now() - 5 * 60 * 1000),
		};
		vi.mocked(eventsService.findByIdempotencyKey).mockResolvedValueOnce(
			abandoned,
		);

		const result = await service.processGenericWebhook(
			{ title: "Test Alert" },
			"idem-abandoned",
		);

		// The unique key makes a second insert impossible — it must reuse the event.
		expect(eventsService.create).not.toHaveBeenCalled();
		expect(alertsService.create).toHaveBeenCalledTimes(1);
		expect(eventsService.markProcessed).toHaveBeenCalledWith(
			"evt-abandoned",
			"alt-123",
		);
		expect(result.event.id).toBe("evt-abandoned");
		expect(result.alert.id).toBe("alt-123");
	});

	it("propagates a non-idempotency Prisma failure instead of swallowing it", async () => {
		vi.mocked(eventsService.findByIdempotencyKey).mockResolvedValueOnce(null);
		vi.mocked(eventsService.create).mockRejectedValueOnce(
			new Prisma.PrismaClientKnownRequestError("FK violation", {
				code: "P2003",
				clientVersion: "7.9.1",
			}),
		);

		await expect(
			service.processGenericWebhook({ title: "Test Alert" }, "idem-other"),
		).rejects.toMatchObject({ code: "P2003" });
	});
});
