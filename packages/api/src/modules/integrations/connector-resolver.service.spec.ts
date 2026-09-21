// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../core/prisma/prisma.service.js";
import { ConnectorResolverService } from "./connector-resolver.service.js";
import type { IntegrationsService } from "./integrations.service.js";

describe("ConnectorResolverService (#633)", () => {
	let service: ConnectorResolverService;
	let mockPrisma: any;
	let mockIntegrationsService: any;

	beforeEach(() => {
		mockPrisma = {
			connection: {
				findMany: vi.fn(),
			},
		};

		mockIntegrationsService = {
			findServiceIntegrations: vi.fn(),
			connectionBaseUrl: vi.fn(),
		};

		service = new ConnectorResolverService(
			mockPrisma as unknown as PrismaService,
			mockIntegrationsService as unknown as IntegrationsService,
		);
	});

	it("service-bound wins over global of the same template", async () => {
		// Service has prometheus (conn-svc-prom)
		mockIntegrationsService.findServiceIntegrations.mockResolvedValue([
			{
				id: "si-1",
				serviceId: "svc-1",
				connectionId: "conn-svc-prom",
				priority: 10,
				connection: {
					id: "conn-svc-prom",
					label: "Service Prometheus",
					status: "ACTIVE",
					integration: {
						templateId: "prometheus",
						label: "Prometheus Int",
					},
				},
			},
		]);

		// Global has another prometheus (conn-global-prom)
		mockPrisma.connection.findMany.mockResolvedValue([
			{
				id: "conn-global-prom",
				label: "Global Prometheus",
				status: "ACTIVE",
				integration: {
					templateId: "prometheus",
					label: "Global Prometheus Int",
				},
			},
		]);

		mockIntegrationsService.connectionBaseUrl.mockImplementation(
			async (connId: string) => {
				if (connId === "conn-svc-prom") return "http://svc-prom.internal:9090";
				if (connId === "conn-global-prom") return "http://global-prom.internal:9090";
				return null;
			},
		);

		const resolved = await service.resolve({ serviceId: "svc-1" });

		expect(resolved).toHaveLength(1);
		expect(resolved[0]).toEqual({
			templateId: "prometheus",
			connectionId: "conn-svc-prom",
			label: "Service Prometheus",
			baseUrl: "http://svc-prom.internal:9090",
			segments: ["metrics"],
		});
	});

	it("global fills a template the service lacks", async () => {
		// Service has prometheus only
		mockIntegrationsService.findServiceIntegrations.mockResolvedValue([
			{
				id: "si-1",
				serviceId: "svc-1",
				connectionId: "conn-svc-prom",
				priority: 10,
				connection: {
					id: "conn-svc-prom",
					label: "Service Prometheus",
					status: "ACTIVE",
					integration: {
						templateId: "prometheus",
					},
				},
			},
		]);

		// Global has alertmanager
		mockPrisma.connection.findMany.mockResolvedValue([
			{
				id: "conn-global-am",
				label: "Global Alertmanager",
				status: "ACTIVE",
				integration: {
					templateId: "alertmanager",
				},
			},
		]);

		mockIntegrationsService.connectionBaseUrl.mockImplementation(
			async (connId: string) => {
				if (connId === "conn-svc-prom") return "http://svc-prom.internal:9090";
				if (connId === "conn-global-am") return "http://global-am.internal:9093";
				return null;
			},
		);

		const resolved = await service.resolve({ serviceId: "svc-1" });

		expect(resolved).toHaveLength(2);
		expect(resolved).toContainEqual({
			templateId: "prometheus",
			connectionId: "conn-svc-prom",
			label: "Service Prometheus",
			baseUrl: "http://svc-prom.internal:9090",
			segments: ["metrics"],
		});
		expect(resolved).toContainEqual({
			templateId: "alertmanager",
			connectionId: "conn-global-am",
			label: "Global Alertmanager",
			baseUrl: "http://global-am.internal:9093",
			segments: [],
		});
	});

	it("non-observability templates are ignored", async () => {
		mockIntegrationsService.findServiceIntegrations.mockResolvedValue([
			{
				id: "si-vcs",
				serviceId: "svc-1",
				connectionId: "conn-github",
				priority: 10,
				connection: {
					id: "conn-github",
					label: "GitHub",
					status: "ACTIVE",
					integration: {
						templateId: "github-app",
					},
				},
			},
		]);

		mockPrisma.connection.findMany.mockResolvedValue([
			{
				id: "conn-render",
				label: "Render",
				status: "ACTIVE",
				integration: {
					templateId: "render",
				},
			},
		]);

		const resolved = await service.resolve({ serviceId: "svc-1" });
		expect(resolved).toEqual([]);
		expect(mockPrisma.connection.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: {
					status: "ACTIVE",
					integration: { templateId: { in: ["prometheus", "alertmanager"] } },
				},
			}),
		);
	});

	it("skips a connection with no baseUrl", async () => {
		mockIntegrationsService.findServiceIntegrations.mockResolvedValue([
			{
				id: "si-1",
				serviceId: "svc-1",
				connectionId: "conn-nobase",
				priority: 10,
				connection: {
					id: "conn-nobase",
					label: "Prometheus No Base",
					status: "ACTIVE",
					integration: {
						templateId: "prometheus",
					},
				},
			},
		]);

		mockPrisma.connection.findMany.mockResolvedValue([]);
		mockIntegrationsService.connectionBaseUrl.mockResolvedValue(null);

		const resolved = await service.resolve({ serviceId: "svc-1" });
		expect(resolved).toEqual([]);
	});
});
