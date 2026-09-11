// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Test, TestingModule } from "@nestjs/testing";
import { Prisma } from "@prismalens/database";
import { Severity } from "../../shared/enums/index.js";
import { AlertMappingService } from "../alert-mapping/alert-mapping.service.js";
import { AlertsService } from "../alerts/alerts.service.js";
import { IncidentCorrelationService } from "../alerts/incident-correlation.service.js";
import { EventsService } from "../events/events.service.js";
import { WebhooksService } from "./webhooks.service.js";

describe("WebhooksService", () => {
	let service: WebhooksService;
	let eventsService: EventsService;
	let alertsService: AlertsService;
	let incidentCorrelationService: IncidentCorrelationService;
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
						findBySourceAlertId: vi.fn().mockResolvedValue(null),
						findAlertBySourceAlert: vi.fn().mockResolvedValue(null),
						resolve: vi.fn().mockResolvedValue({
							...mockAlert,
							status: "resolved",
						}),
						resolveSourceAlert: vi.fn().mockResolvedValue({
							...mockAlert,
							status: "resolved",
						}),
					},
				},
				{
					provide: IncidentCorrelationService,
					useValue: {
						correlateAlert: vi.fn().mockResolvedValue({
							incidentId: "inc-123",
							incidentNumber: 42,
							reason: "Correlated to existing incident",
							isNewIncident: false,
						}),
						resolveIncidentIfNoFiringAlerts: vi.fn().mockResolvedValue(undefined),
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
		incidentCorrelationService = module.get<IncidentCorrelationService>(
			IncidentCorrelationService,
		);
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
		expect(incidentCorrelationService.correlateAlert).not.toHaveBeenCalled();
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
		expect(incidentCorrelationService.correlateAlert).not.toHaveBeenCalled();
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

	// ==========================================================================
	// #231 R3 — the GitHub path gets the same ingestEvent wrapping as the others,
	// keyed on X-GitHub-Delivery (GitHub reuses the GUID on a redelivery).
	// ==========================================================================
	describe("GitHub delivery-GUID idempotency (#231 R3)", () => {
		const githubDto = {
			action: "opened",
			issue: { number: 7, title: "Disk full", html_url: "https://gh/i/7" },
			repository: { full_name: "acme/api" },
		};
		const DELIVERY_GUID = "a1b2c3d4-0000-1111-2222-333344445555";

		it("passes the delivery GUID through as the event's idempotency key", async () => {
			vi.mocked(eventsService.findByIdempotencyKey).mockResolvedValueOnce(null);

			await service.processGithubWebhook(githubDto, DELIVERY_GUID);

			expect(eventsService.findByIdempotencyKey).toHaveBeenCalledWith(
				DELIVERY_GUID,
			);
			expect(eventsService.create).toHaveBeenCalledWith(
				expect.objectContaining({
					source: "github",
					idempotencyKey: DELIVERY_GUID,
				}),
			);
		});

		it("replays a redelivery of the same GUID without re-creating event or alert", async () => {
			vi.mocked(eventsService.findByIdempotencyKey).mockResolvedValueOnce({
				...mockEvent,
				source: "github",
				idempotencyKey: DELIVERY_GUID,
			});

			const result = await service.processGithubWebhook(
				githubDto,
				DELIVERY_GUID,
			);

			expect(eventsService.create).not.toHaveBeenCalled();
			expect(alertsService.create).not.toHaveBeenCalled();
			expect(incidentCorrelationService.correlateAlert).not.toHaveBeenCalled();
			expect(result.alert.id).toBe("alt-123");
			expect(result.correlationReason).toContain("Idempotent replay");
		});

		it("defers to the winner when a concurrent redelivery wins the insert race", async () => {
			vi.mocked(eventsService.findByIdempotencyKey).mockResolvedValueOnce(null);
			vi.mocked(eventsService.create).mockRejectedValueOnce(
				uniqueKeyViolation(),
			);
			vi.mocked(eventsService.findByIdempotencyKey).mockResolvedValueOnce({
				...mockEvent,
				source: "github",
				idempotencyKey: DELIVERY_GUID,
			});

			const result = await service.processGithubWebhook(
				githubDto,
				DELIVERY_GUID,
			);

			expect(alertsService.create).not.toHaveBeenCalled();
			expect(result.correlationReason).toContain("Idempotent replay");
		});

		it("still processes a delivery that carries no GUID", async () => {
			const result = await service.processGithubWebhook(githubDto);

			expect(eventsService.findByIdempotencyKey).not.toHaveBeenCalled();
			expect(eventsService.create).toHaveBeenCalledTimes(1);
			expect(alertsService.create).toHaveBeenCalledTimes(1);
			expect(result.alert.id).toBe("alt-123");
		});
	});

	describe("resolvePrometheusAlert (#593)", () => {
		it("resolves the existing alert instead of creating a new one", async () => {
			vi.mocked(alertsService.findAlertBySourceAlert).mockResolvedValueOnce({
				...mockAlert,
				status: "triggered",
			});

			const result = await service.resolvePrometheusAlert("fp-abc");

			expect(alertsService.findAlertBySourceAlert).toHaveBeenCalledWith("fp-abc");
			expect(alertsService.resolveSourceAlert).toHaveBeenCalledWith("fp-abc");
			// The bug this guards: a resolved delivery must never reach create(),
			// where dedup would read it as a refire and reopen the alert.
			expect(alertsService.create).not.toHaveBeenCalled();
			expect(result?.status).toBe("resolved");
		});

		it("ignores a resolved delivery for a fingerprint never seen firing", async () => {
			vi.mocked(alertsService.findAlertBySourceAlert).mockResolvedValueOnce(null);

			const result = await service.resolvePrometheusAlert(
				"fp-unknown",
				"delivery-9:fp-unknown",
			);

			expect(result).toBeNull();
			expect(alertsService.resolve).not.toHaveBeenCalled();
			expect(alertsService.create).not.toHaveBeenCalled();
			// No Event row: one created here would never reach markProcessed, and a
			// retry inside the grace window would then throw CONFLICT.
			expect(eventsService.create).not.toHaveBeenCalled();
		});

		it("ignores a resolved delivery carrying no fingerprint", async () => {
			const result = await service.resolvePrometheusAlert(undefined);

			expect(result).toBeNull();
			expect(alertsService.findBySourceAlertId).not.toHaveBeenCalled();
			expect(alertsService.resolve).not.toHaveBeenCalled();
		});

		it("writes an Event row for the resolved delivery, like every other path", async () => {
			vi.mocked(alertsService.findAlertBySourceAlert).mockResolvedValueOnce({
				...mockAlert,
				status: "triggered",
			});

			await service.resolvePrometheusAlert("fp-abc", "delivery-1:fp-abc");

			expect(eventsService.create).toHaveBeenCalledWith(
				expect.objectContaining({
					source: "prometheus",
					sourceEventId: "fp-abc",
					idempotencyKey: "delivery-1:fp-abc",
					payload: { status: "resolved", fingerprint: "fp-abc" },
				}),
			);
			expect(eventsService.markProcessed).toHaveBeenCalled();
		});

		it("does not re-resolve an already resolved alert", async () => {
			vi.mocked(alertsService.findAlertBySourceAlert).mockResolvedValueOnce({
				...mockAlert,
				status: "resolved",
			});

			const result = await service.resolvePrometheusAlert("fp-abc");

			expect(result?.status).toBe("resolved");
			// Group membership decides this now, inside resolveSourceAlert (#595).
			expect(alertsService.resolveSourceAlert).toHaveBeenCalledWith("fp-abc");
		});

		// #608, C5 on #337: a resolved delivery resolves the alert and, when no
		// firing alert remains on its incident, the incident too.
		it("asks IncidentCorrelationService to close the incident once the alert resolves", async () => {
			vi.mocked(alertsService.findAlertBySourceAlert).mockResolvedValueOnce({
				...mockAlert,
				status: "triggered",
			});

			await service.resolvePrometheusAlert("fp-abc");

			expect(
				incidentCorrelationService.resolveIncidentIfNoFiringAlerts,
			).toHaveBeenCalledWith("inc-123");
		});

		it("does not ask to close an incident when the resolved alert carries none", async () => {
			vi.mocked(alertsService.findAlertBySourceAlert).mockResolvedValueOnce({
				...mockAlert,
				status: "triggered",
			});
			vi.mocked(alertsService.resolveSourceAlert).mockResolvedValueOnce({
				...mockAlert,
				status: "resolved",
				incidentId: null,
			});

			await service.resolvePrometheusAlert("fp-abc");

			expect(
				incidentCorrelationService.resolveIncidentIfNoFiringAlerts,
			).not.toHaveBeenCalled();
		});
	});

});
