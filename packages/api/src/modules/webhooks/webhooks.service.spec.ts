// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Test, TestingModule } from "@nestjs/testing";
import { Prisma } from "@prismalens/database";
import { Severity } from "../../shared/enums/index.js";
import { AlertMappingService } from "../alert-mapping/alert-mapping.service.js";
import { AlertsService } from "../alerts/alerts.service.js";
import { IncidentCorrelationService } from "../alerts/incident-correlation.service.js";
import { EventsService } from "../events/events.service.js";
import {
	EARLY_RESOLUTION_TTL_MS,
	MAX_DESCRIPTION_CHARS,
	MAX_LABEL_VALUE_CHARS,
	MAX_TITLE_CHARS,
	WebhooksService,
} from "./webhooks.service.js";

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
			).toHaveBeenCalledWith("inc-123", undefined);
		});

		it("records an inferred resolution under its own source and reason (#605)", async () => {
			vi.mocked(alertsService.findAlertBySourceAlert).mockResolvedValueOnce({
				...mockAlert,
				status: "triggered",
			});
			const note = { text: "no connected Alertmanager still lists X", reason: "alertmanager-absence" };

			await service.resolvePrometheusAlert("fp-abc", "absent-1", undefined, {
				source: "alertmanager-pull",
				note,
			});

			expect(eventsService.create).toHaveBeenCalledWith(
				expect.objectContaining({
					source: "alertmanager-pull",
					payload: { status: "resolved", fingerprint: "fp-abc", reason: "alertmanager-absence" },
				}),
			);
			expect(
				incidentCorrelationService.resolveIncidentIfNoFiringAlerts,
			).toHaveBeenCalledWith("inc-123", note);
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


	describe("sender text caps (#633 edge 13)", () => {
		it("caps title, description and label values before anything is stored", async () => {
			await service.processGenericWebhook({
				title: "t".repeat(MAX_TITLE_CHARS + 10),
				description: "d".repeat(MAX_DESCRIPTION_CHARS + 5_000),
				labels: { runbook: "r".repeat(MAX_LABEL_VALUE_CHARS + 1), env: "prod" },
			});

			const stored = vi.mocked(alertsService.create).mock.calls[0][0];
			expect(stored.title).toHaveLength(MAX_TITLE_CHARS + "… [truncated 10 chars]".length);
			expect(stored.description?.endsWith("… [truncated 5000 chars]")).toBe(true);
			expect(stored.labels?.env).toBe("prod");
			expect(stored.labels?.runbook?.startsWith("r".repeat(MAX_LABEL_VALUE_CHARS))).toBe(true);
			const payload = vi.mocked(eventsService.create).mock.calls[0][0].payload as {
				description: string;
			};
			expect(payload.description.length).toBeLessThan(MAX_DESCRIPTION_CHARS + 100);
		});

		it("leaves text under the caps untouched", async () => {
			await service.processGenericWebhook({ title: "Short", description: "fine" });
			const stored = vi.mocked(alertsService.create).mock.calls[0][0];
			expect(stored.title).toBe("Short");
			expect(stored.description).toBe("fine");
		});
	});

	describe("resolution before firing (#633 edge 10)", () => {
		const STARTS = "2026-09-19T10:00:00Z";

		it("remembers an unknown fingerprint's resolution for its own episode only", async () => {
			vi.mocked(alertsService.findAlertBySourceAlert).mockResolvedValueOnce(null);
			await service.resolvePrometheusAlert("fp-late", undefined, STARTS);

			expect(service.hasEarlyResolution("fp-late", "2026-09-19T10:05:00Z")).toBe(false);
			expect(service.hasEarlyResolution("fp-late", STARTS)).toBe(true);
			// Reading does not consume it: a delivery that fails to resolve must be
			// able to try again (#664 review).
			expect(service.hasEarlyResolution("fp-late", STARTS)).toBe(true);
			service.clearEarlyResolution("fp-late", STARTS);
			expect(service.hasEarlyResolution("fp-late", STARTS)).toBe(false);
		});

		it("forgets it after the window", async () => {
			vi.useFakeTimers();
			try {
				vi.mocked(alertsService.findAlertBySourceAlert).mockResolvedValueOnce(null);
				await service.resolvePrometheusAlert("fp-old", undefined, STARTS);
				vi.advanceTimersByTime(EARLY_RESOLUTION_TTL_MS + 1);
				expect(service.hasEarlyResolution("fp-old", STARTS)).toBe(false);
			} finally {
				vi.useRealTimers();
			}
		});
	});

	describe("processPrometheusAlert (#605)", () => {
		const STARTS = "2026-09-19T10:00:00Z";
		const firing = {
			status: "firing" as const,
			labels: { alertname: "HighLatency", severity: "warning" },
			annotations: { description: "High latency detected" },
			startsAt: STARTS,
			fingerprint: "fp-1",
		};

		it("resolves a late firing whose resolution already arrived", async () => {
			vi.mocked(alertsService.findAlertBySourceAlert).mockResolvedValueOnce(null);
			await service.resolvePrometheusAlert("fp-1", undefined, firing.startsAt);
			expect(service.hasEarlyResolution("fp-1", firing.startsAt)).toBe(true);

			vi.mocked(alertsService.findAlertBySourceAlert).mockResolvedValueOnce(mockAlert);
			vi.mocked(alertsService.resolveSourceAlert).mockResolvedValueOnce({
				...mockAlert,
				status: "resolved",
			});

			const result = await service.processPrometheusAlert(firing, {
				source: "prometheus",
				autoInvestigate: true,
			});

			expect(result.alertId).toBe("alt-123");
			expect(service.hasEarlyResolution("fp-1", firing.startsAt)).toBe(false);
			expect(alertsService.resolveSourceAlert).toHaveBeenCalledWith("fp-1");
		});

		it("leaves an ordinary firing open", async () => {
			const result = await service.processPrometheusAlert(firing, {
				source: "prometheus",
				autoInvestigate: true,
			});

			expect(result.alertId).toBe("alt-123");
			expect(result.isNew).toBe(true);
			expect(alertsService.resolveSourceAlert).not.toHaveBeenCalled();
		});

		it("marks an alert as not new when deduplicated onto an existing alert", async () => {
			vi.mocked(alertsService.create).mockResolvedValueOnce({
				...mockAlert,
				occurrenceCount: 2,
			});

			const result = await service.processPrometheusAlert(firing, {
				source: "prometheus",
				autoInvestigate: true,
			});

			expect(result.alertId).toBe("alt-123");
			expect(result.isNew).toBe(false);
		});

		it("marks an alert as not new on idempotent replay", async () => {
			vi.mocked(eventsService.findByIdempotencyKey).mockResolvedValueOnce({
				...mockEvent,
				alertId: "alt-123",
			});
			vi.mocked(alertsService.findById).mockResolvedValueOnce(mockAlert);

			const result = await service.processPrometheusAlert(firing, {
				idempotencyKey: "replay-key",
				source: "prometheus",
				autoInvestigate: true,
			});

			expect(result.alertId).toBe("alt-123");
			expect(result.isNew).toBe(false);
		});

		it("records an early-resolved firing without dispatching a run", async () => {
			vi.mocked(alertsService.findAlertBySourceAlert).mockResolvedValueOnce(null);
			await service.resolvePrometheusAlert("fp-1", undefined, firing.startsAt);

			vi.mocked(alertsService.findAlertBySourceAlert).mockResolvedValueOnce(mockAlert);
			vi.mocked(alertsService.resolveSourceAlert).mockResolvedValueOnce({
				...mockAlert,
				status: "resolved",
			});

			await service.processPrometheusAlert(firing, {
				source: "prometheus",
				autoInvestigate: true,
			});

			expect(incidentCorrelationService.correlateAlert).toHaveBeenCalledWith(
				expect.objectContaining({ id: "alt-123" }),
				{ autoInvestigate: false },
			);
		});

		it("lets an ordinary firing dispatch as before", async () => {
			await service.processPrometheusAlert(firing, {
				source: "prometheus",
				autoInvestigate: true,
			});

			expect(incidentCorrelationService.correlateAlert).toHaveBeenCalledWith(
				expect.objectContaining({ id: "alt-123" }),
				{ autoInvestigate: true },
			);
		});

		it("keeps the early-resolution record when the resolution did not happen", async () => {
			vi.mocked(alertsService.findAlertBySourceAlert).mockResolvedValue(null);
			await service.resolvePrometheusAlert("fp-1", undefined, firing.startsAt);
			expect(service.hasEarlyResolution("fp-1", firing.startsAt)).toBe(true);

			await service.processPrometheusAlert(firing, {
				source: "prometheus",
				autoInvestigate: true,
			});

			expect(service.hasEarlyResolution("fp-1", firing.startsAt)).toBe(true);
		});

		it("passes a resolution's startsAt so an unknown fingerprint can be remembered", async () => {
			vi.mocked(alertsService.findAlertBySourceAlert).mockResolvedValueOnce(null);
			const resolvedAlert = { ...firing, status: "resolved" as const };
			const result = await service.processPrometheusAlert(resolvedAlert, {
				source: "prometheus",
				autoInvestigate: true,
			});

			expect(result.alertId).toBeNull();
			expect(service.hasEarlyResolution("fp-1", firing.startsAt)).toBe(true);
		});
	});
});
