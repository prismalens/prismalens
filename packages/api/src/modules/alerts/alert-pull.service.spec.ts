// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Test, TestingModule } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { IntegrationsService } from "../integrations/integrations.service.js";
import { WebhooksService } from "../webhooks/webhooks.service.js";
import { AlertPullService } from "./alert-pull.service.js";

describe("AlertPullService (#605)", () => {
	let service: AlertPullService;
	let prisma: { connection: { findMany: ReturnType<typeof vi.fn> } };
	let integrationsService: { connectionBaseUrl: ReturnType<typeof vi.fn> };
	let webhooksService: { processPrometheusAlert: ReturnType<typeof vi.fn> };
	let fetchSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(async () => {
		prisma = {
			connection: {
				findMany: vi.fn(),
			},
		};
		integrationsService = {
			connectionBaseUrl: vi.fn(),
		};
		webhooksService = {
			processPrometheusAlert: vi.fn(),
		};

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				AlertPullService,
				{ provide: PrismaService, useValue: prisma },
				{ provide: IntegrationsService, useValue: integrationsService },
				{ provide: WebhooksService, useValue: webhooksService },
			],
		}).compile();

		service = module.get<AlertPullService>(AlertPullService);
		fetchSpy = vi.spyOn(globalThis, "fetch");
	});

	afterEach(() => {
		fetchSpy.mockRestore();
	});

	it("ingests active alerts with autoInvestigate: false", async () => {
		prisma.connection.findMany.mockResolvedValue([
			{
				id: "conn-1",
				label: "Alertmanager Prod",
				status: "ACTIVE",
				integration: { templateId: "alertmanager" },
			},
		]);
		integrationsService.connectionBaseUrl.mockResolvedValue("http://alertmanager:9093");

		const activeAlert = {
			labels: { alertname: "DiskFull", severity: "critical" },
			annotations: { summary: "Disk full on /var" },
			startsAt: "2026-09-20T10:00:00Z",
			endsAt: "2026-09-20T11:00:00Z",
			generatorURL: "http://prometheus:9090/graph",
			fingerprint: "fp-1",
			status: { state: "active" },
		};

		fetchSpy.mockResolvedValueOnce(
			new Response(JSON.stringify([activeAlert]), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);

		webhooksService.processPrometheusAlert.mockResolvedValueOnce({
			alertId: "alt-1",
			isNew: true,
		});

		const result = await service.pull();

		expect(prisma.connection.findMany).toHaveBeenCalledWith({
			where: {
				status: "ACTIVE",
				integration: { templateId: "alertmanager" },
			},
			include: { integration: true },
		});
		expect(fetchSpy).toHaveBeenCalledWith(
			"http://alertmanager:9093/api/v2/alerts?active=true&silenced=false&inhibited=false",
			expect.objectContaining({ method: "GET" }),
		);
		expect(webhooksService.processPrometheusAlert).toHaveBeenCalledWith(
			{
				status: "firing",
				labels: activeAlert.labels,
				annotations: activeAlert.annotations,
				startsAt: activeAlert.startsAt,
				endsAt: activeAlert.endsAt,
				generatorURL: activeAlert.generatorURL,
				fingerprint: "fp-1",
			},
			{
				idempotencyKey: "alertmanager-pull:fp-1:2026-09-20T10:00:00Z",
				source: "alertmanager-pull",
				autoInvestigate: false,
			},
		);
		expect(result).toEqual({
			sources: 1,
			received: 1,
			processed: 1,
			caughtUp: 0,
			errors: [],
		});
	});

	it("skips suppressed alerts", async () => {
		prisma.connection.findMany.mockResolvedValue([
			{
				id: "conn-1",
				label: "Alertmanager Prod",
				status: "ACTIVE",
				integration: { templateId: "alertmanager" },
			},
		]);
		integrationsService.connectionBaseUrl.mockResolvedValue("http://alertmanager:9093");

		const activeAlert = {
			labels: { alertname: "DiskFull" },
			startsAt: "2026-09-20T10:00:00Z",
			fingerprint: "fp-active",
			status: { state: "active" },
		};
		const suppressedAlert = {
			labels: { alertname: "MemoryHigh" },
			startsAt: "2026-09-20T10:05:00Z",
			fingerprint: "fp-suppressed",
			status: { state: "suppressed" },
		};

		fetchSpy.mockResolvedValueOnce(
			new Response(JSON.stringify([activeAlert, suppressedAlert]), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);

		webhooksService.processPrometheusAlert.mockResolvedValueOnce({
			alertId: "alt-1",
			isNew: true,
		});

		const result = await service.pull();

		expect(webhooksService.processPrometheusAlert).toHaveBeenCalledTimes(1);
		expect(webhooksService.processPrometheusAlert).toHaveBeenCalledWith(
			expect.objectContaining({ fingerprint: "fp-active" }),
			expect.anything(),
		);
		expect(result.received).toBe(2);
		expect(result.processed).toBe(1);
	});

	it("second pull processes 0", async () => {
		prisma.connection.findMany.mockResolvedValue([
			{
				id: "conn-1",
				label: "Alertmanager Prod",
				status: "ACTIVE",
				integration: { templateId: "alertmanager" },
			},
		]);
		integrationsService.connectionBaseUrl.mockResolvedValue("http://alertmanager:9093");

		const activeAlert = {
			labels: { alertname: "DiskFull" },
			startsAt: "2026-09-20T10:00:00Z",
			fingerprint: "fp-1",
			status: { state: "active" },
		};

		// 1st pull: newly created
		fetchSpy.mockResolvedValueOnce(
			new Response(JSON.stringify([activeAlert]), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);
		webhooksService.processPrometheusAlert.mockResolvedValueOnce({
			alertId: "alt-1",
			isNew: true,
		});

		const result1 = await service.pull();
		expect(result1.processed).toBe(1);

		// 2nd pull: replayed/deduped -> isNew: false
		fetchSpy.mockResolvedValueOnce(
			new Response(JSON.stringify([activeAlert]), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);
		webhooksService.processPrometheusAlert.mockResolvedValueOnce({
			alertId: "alt-1",
			isNew: false,
		});

		const result2 = await service.pull();
		expect(result2.received).toBe(1);
		expect(result2.processed).toBe(0);
	});

	it("dedup by label set catches the webhook-then-pull case and creates nothing", async () => {
		prisma.connection.findMany.mockResolvedValue([
			{
				id: "conn-1",
				label: "Alertmanager Prod",
				status: "ACTIVE",
				integration: { templateId: "alertmanager" },
			},
		]);
		integrationsService.connectionBaseUrl.mockResolvedValue("http://alertmanager:9093");

		const activeAlert = {
			labels: { alertname: "DiskFull" },
			startsAt: "2026-09-20T10:00:00Z",
			fingerprint: "fp-1",
			status: { state: "active" },
		};

		fetchSpy.mockResolvedValueOnce(
			new Response(JSON.stringify([activeAlert]), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);
		// Webhook previously arrived and created the alert; pull dedups by label set and returns isNew: false
		webhooksService.processPrometheusAlert.mockResolvedValueOnce({
			alertId: "alt-1",
			isNew: false,
		});

		const result = await service.pull();
		expect(result.received).toBe(1);
		expect(result.processed).toBe(0);
	});

	it("one failing source recorded in errors, the other still ingested", async () => {
		prisma.connection.findMany.mockResolvedValue([
			{
				id: "conn-fail",
				label: "Alertmanager Staging",
				status: "ACTIVE",
				integration: { templateId: "alertmanager" },
			},
			{
				id: "conn-ok",
				label: "Alertmanager Prod",
				status: "ACTIVE",
				integration: { templateId: "alertmanager" },
			},
		]);

		integrationsService.connectionBaseUrl
			.mockResolvedValueOnce("http://alertmanager-fail:9093")
			.mockResolvedValueOnce("http://alertmanager-ok:9093");

		const okAlert = {
			labels: { alertname: "ServiceDown" },
			startsAt: "2026-09-20T10:00:00Z",
			fingerprint: "fp-ok",
			status: { state: "active" },
		};

		fetchSpy
			.mockRejectedValueOnce(new Error("Connection refused"))
			.mockResolvedValueOnce(
				new Response(JSON.stringify([okAlert]), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			);

		webhooksService.processPrometheusAlert.mockResolvedValueOnce({
			alertId: "alt-ok",
			isNew: true,
		});

		const result = await service.pull();

		expect(result.sources).toBe(2);
		expect(result.received).toBe(1);
		expect(result.processed).toBe(1);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain("Alertmanager Staging");
		expect(webhooksService.processPrometheusAlert).toHaveBeenCalledTimes(1);
		expect(webhooksService.processPrometheusAlert).toHaveBeenCalledWith(
			expect.objectContaining({ fingerprint: "fp-ok" }),
			expect.anything(),
		);
	});

	it("zero sources → { sources: 0 } and no fetch", async () => {
		prisma.connection.findMany.mockResolvedValue([]);

		const result = await service.pull();

		expect(fetchSpy).not.toHaveBeenCalled();
		expect(result).toEqual({
			sources: 0,
			received: 0,
			processed: 0,
			caughtUp: 0,
			errors: [],
		});
	});
});
