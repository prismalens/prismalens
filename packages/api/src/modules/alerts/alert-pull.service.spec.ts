// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Test, TestingModule } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { IntegrationsService } from "../integrations/integrations.service.js";
import { WebhooksService } from "../webhooks/webhooks.service.js";
import {
	ALERT_PULL_SETTING_KEY,
	AlertPullService,
	TWENTY_FOUR_HOURS_MS,
} from "./alert-pull.service.js";
import { alertmanagerFingerprint } from "./alertmanager-fingerprint.js";

describe("AlertPullService (#605)", () => {
	let service: AlertPullService;
	let prisma: {
		connection: { findMany: ReturnType<typeof vi.fn> };
		setting: { findUnique: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> };
	};
	let integrationsService: { connectionBaseUrl: ReturnType<typeof vi.fn> };
	let webhooksService: {
		processPrometheusAlert: ReturnType<typeof vi.fn>;
		resolvePrometheusAlert: ReturnType<typeof vi.fn>;
	};
	let fetchSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(async () => {
		prisma = {
			connection: {
				findMany: vi.fn(),
			},
			setting: {
				findUnique: vi.fn().mockResolvedValue(null),
				upsert: vi.fn().mockResolvedValue({}),
			},
		};
		integrationsService = {
			connectionBaseUrl: vi.fn(),
		};
		webhooksService = {
			processPrometheusAlert: vi.fn().mockResolvedValue({ alertId: "alt-1", isNew: true }),
			resolvePrometheusAlert: vi.fn().mockResolvedValue({ id: "alt-1" }),
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

	describe("Alertmanager pull (Slice 1)", () => {
		it("ingests active alerts with autoInvestigate: false", async () => {
			prisma.connection.findMany.mockImplementation(async (args?: { where?: { integration?: { templateId?: string } } }) => {
				if (args?.where?.integration?.templateId === "alertmanager") {
					return [
						{
							id: "conn-1",
							label: "Alertmanager Prod",
							status: "ACTIVE",
							integration: { templateId: "alertmanager" },
						},
					];
				}
				return [];
			});
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

			const result = await service.pull();

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
			prisma.connection.findMany.mockImplementation(async (args?: { where?: { integration?: { templateId?: string } } }) => {
				if (args?.where?.integration?.templateId === "alertmanager") {
					return [
						{
							id: "conn-1",
							label: "Alertmanager Prod",
							status: "ACTIVE",
							integration: { templateId: "alertmanager" },
						},
					];
				}
				return [];
			});
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
			prisma.connection.findMany.mockImplementation(async (args?: { where?: { integration?: { templateId?: string } } }) => {
				if (args?.where?.integration?.templateId === "alertmanager") {
					return [
						{
							id: "conn-1",
							label: "Alertmanager Prod",
							status: "ACTIVE",
							integration: { templateId: "alertmanager" },
						},
					];
				}
				return [];
			});
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
			webhooksService.processPrometheusAlert.mockResolvedValueOnce({
				alertId: "alt-1",
				isNew: true,
			});

			const result1 = await service.pull();
			expect(result1.processed).toBe(1);

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
			prisma.connection.findMany.mockImplementation(async (args?: { where?: { integration?: { templateId?: string } } }) => {
				if (args?.where?.integration?.templateId === "alertmanager") {
					return [
						{
							id: "conn-1",
							label: "Alertmanager Prod",
							status: "ACTIVE",
							integration: { templateId: "alertmanager" },
						},
					];
				}
				return [];
			});
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
			webhooksService.processPrometheusAlert.mockResolvedValueOnce({
				alertId: "alt-1",
				isNew: false,
			});

			const result = await service.pull();
			expect(result.received).toBe(1);
			expect(result.processed).toBe(0);
		});

		it("one failing source recorded in errors, the other still ingested", async () => {
			prisma.connection.findMany.mockImplementation(async (args?: { where?: { integration?: { templateId?: string } } }) => {
				if (args?.where?.integration?.templateId === "alertmanager") {
					return [
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
					];
				}
				return [];
			});

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

			const result = await service.pull();

			expect(result.sources).toBe(2);
			expect(result.received).toBe(1);
			expect(result.processed).toBe(1);
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0]).toContain("Alertmanager Staging");
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

	describe("Prometheus catch-up (Slice 2)", () => {
		const now = new Date("2026-09-20T12:00:00.000Z");

		it("maps series to episodes, strips __name__ and alertstate, and resolves only ended series", async () => {
			prisma.connection.findMany.mockImplementation(async (args?: { where?: { integration?: { templateId?: string } } }) => {
				if (args?.where?.integration?.templateId === "prometheus") {
					return [
						{
							id: "prom-1",
							label: "Prometheus Main",
							status: "ACTIVE",
							integration: { templateId: "prometheus" },
						},
					];
				}
				return [];
			});
			integrationsService.connectionBaseUrl.mockResolvedValue("http://prometheus:9090");

			// Series 1: ended (last sample was at 11:50:00, which is older than now - 2*step = 11:58:00)
			const series1 = {
				metric: {
					__name__: "ALERTS",
					alertstate: "firing",
					alertname: "DiskSpaceLow",
					instance: "node1",
				},
				values: [
					[1774180200, "1"], // 11:50:00
					[1774180800, "1"], // 12:00:00 -> wait, let's use exact unix timestamps for 11:30 and 11:50
				],
			};
			const startSec = Math.floor(new Date("2026-09-20T11:30:00.000Z").getTime() / 1000);
			const endSecEnded = Math.floor(new Date("2026-09-20T11:50:00.000Z").getTime() / 1000);
			series1.values = [
				[startSec, "1"],
				[endSecEnded, "1"],
			];

			// Series 2: still firing (last sample was at 11:59:30, within now - 2*step)
			const endSecFiring = Math.floor(new Date("2026-09-20T11:59:30.000Z").getTime() / 1000);
			const series2 = {
				metric: {
					__name__: "ALERTS",
					alertstate: "firing",
					alertname: "CpuHigh",
				},
				values: [
					[startSec, "1"],
					[endSecFiring, "1"],
				],
			};

			fetchSpy.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						status: "success",
						data: {
							resultType: "matrix",
							result: [series1, series2],
						},
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
			);

			const result = await service.pull(now);

			expect(result.sources).toBe(1);
			expect(result.caughtUp).toBe(2);
			expect(result.processed).toBe(2);

			// Expected labels without __name__ and alertstate
			const expectedLabels1 = { alertname: "DiskSpaceLow", instance: "node1" };
			const expectedFp1 = alertmanagerFingerprint(expectedLabels1);
			const expectedStartsAt1 = new Date(startSec * 1000).toISOString();

			expect(webhooksService.processPrometheusAlert).toHaveBeenCalledWith(
				{
					status: "firing",
					labels: expectedLabels1,
					annotations: {},
					startsAt: expectedStartsAt1,
					generatorURL: "http://prometheus:9090/graph?g0.expr=ALERTS%7Balertname%3D%22DiskSpaceLow%22%7D",
					fingerprint: expectedFp1,
				},
				{
					idempotencyKey: `prometheus-catchup:${expectedFp1}:${expectedStartsAt1}`,
					source: "prometheus-catchup",
					autoInvestigate: false,
				},
			);

			// Series 1 ended: resolvePrometheusAlert called
			expect(webhooksService.resolvePrometheusAlert).toHaveBeenCalledTimes(1);
			expect(webhooksService.resolvePrometheusAlert).toHaveBeenCalledWith(
				expectedFp1,
				`prometheus-catchup:${expectedFp1}:${expectedStartsAt1}:resolved`,
				expectedStartsAt1,
			);

			// Series 2 still firing: resolvePrometheusAlert NOT called for CpuHigh
			const expectedLabels2 = { alertname: "CpuHigh" };
			const expectedFp2 = alertmanagerFingerprint(expectedLabels2);
			expect(webhooksService.resolvePrometheusAlert).not.toHaveBeenCalledWith(
				expectedFp2,
				expect.anything(),
				expect.anything(),
			);
		});

		it("advances lastPulledAt only on a clean pull with zero errors", async () => {
			prisma.connection.findMany.mockImplementation(async (args?: { where?: { integration?: { templateId?: string } } }) => {
				if (args?.where?.integration?.templateId === "prometheus") {
					return [
						{
							id: "prom-1",
							label: "Prometheus Main",
							status: "ACTIVE",
							integration: { templateId: "prometheus" },
						},
					];
				}
				return [];
			});
			integrationsService.connectionBaseUrl.mockResolvedValue("http://prometheus:9090");

			// Clean pull
			fetchSpy.mockResolvedValueOnce(
				new Response(
					JSON.stringify({ status: "success", data: { result: [] } }),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
			);

			await service.pull(now);

			expect(prisma.setting.upsert).toHaveBeenCalledWith({
				where: { key: ALERT_PULL_SETTING_KEY },
				update: {
					value: JSON.stringify({ lastPulledAt: now.toISOString() }),
					type: "json",
				},
				create: {
					key: ALERT_PULL_SETTING_KEY,
					value: JSON.stringify({ lastPulledAt: now.toISOString() }),
					type: "json",
					category: "general",
				},
			});

			prisma.setting.upsert.mockClear();

			// Pull with error
			fetchSpy.mockRejectedValueOnce(new Error("Prometheus down"));
			await service.pull(now);

			expect(prisma.setting.upsert).not.toHaveBeenCalled();
		});

		it("clamps since to [now - 24h, now]", async () => {
			// 1. Absent setting -> now - 24h
			prisma.setting.findUnique.mockResolvedValueOnce(null);
			const sinceAbsent = await service.getCatchupSince(now);
			expect(sinceAbsent.getTime()).toBe(now.getTime() - TWENTY_FOUR_HOURS_MS);

			// 2. Setting older than 24h (e.g. 48h ago) -> clamped to now - 24h
			prisma.setting.findUnique.mockResolvedValueOnce({
				key: ALERT_PULL_SETTING_KEY,
				value: JSON.stringify({
					lastPulledAt: new Date(now.getTime() - 48 * 3600 * 1000).toISOString(),
				}),
			});
			const sinceOld = await service.getCatchupSince(now);
			expect(sinceOld.getTime()).toBe(now.getTime() - TWENTY_FOUR_HOURS_MS);

			// 3. Setting in the future -> clamped to now
			prisma.setting.findUnique.mockResolvedValueOnce({
				key: ALERT_PULL_SETTING_KEY,
				value: JSON.stringify({
					lastPulledAt: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
				}),
			});
			const sinceFuture = await service.getCatchupSince(now);
			expect(sinceFuture.getTime()).toBe(now.getTime());

			// 4. Setting within 24h (e.g. 2h ago) -> exactly 2h ago
			const twoHoursAgo = new Date(now.getTime() - 2 * 3600 * 1000);
			prisma.setting.findUnique.mockResolvedValueOnce({
				key: ALERT_PULL_SETTING_KEY,
				value: JSON.stringify({
					lastPulledAt: twoHoursAgo.toISOString(),
				}),
			});
			const sinceRecent = await service.getCatchupSince(now);
			expect(sinceRecent.toISOString()).toBe(twoHoursAgo.toISOString());
		});
	});
});
