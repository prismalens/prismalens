// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../core/prisma/prisma.service.js";
import type { TelemetryService } from "../../core/telemetry/telemetry.service.js";
import type { CredentialsService } from "./crypto/credentials.service.js";
import { IntegrationsService } from "./integrations.service.js";

describe("IntegrationsService.testConnection (#633)", () => {
	let service: IntegrationsService;
	let mockPrisma: any;
	let mockCredentialsService: any;
	let mockTelemetry: any;
	let mockAuthManager: any;
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		mockPrisma = {
			connection: {
				findFirst: vi.fn(),
				findUnique: vi.fn(),
				update: vi.fn(),
			},
		};

		mockCredentialsService = {
			decrypt: vi.fn((buf: Buffer) => JSON.parse(buf.toString("utf-8"))),
			getVault: vi.fn(() => ({
				encrypt: vi.fn(),
				decrypt: vi.fn(),
			})),
		};

		mockTelemetry = {
			capture: vi.fn(),
		};

		mockAuthManager = {
			verifyConnection: vi.fn(),
		};

		service = new IntegrationsService(
			mockPrisma as unknown as PrismaService,
			mockCredentialsService as unknown as CredentialsService,
			mockTelemetry as unknown as TelemetryService,
		);

		(service as any).authManager = mockAuthManager;
		(service as any).authManagerInitialized = true;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	it("tests URL-only template: ok -> ACTIVE", async () => {
		const conn = {
			id: "conn-prom-1",
			integrationId: "int-prom-1",
			consecutiveErrors: 0,
			integration: {
				templateId: "prometheus",
				label: "My Prometheus",
			},
			connectionConfigEnc: Buffer.from(
				JSON.stringify({ baseUrl: "http://prometheus.internal:9090" }),
			),
		};

		mockPrisma.connection.findFirst.mockResolvedValue(conn);
		mockPrisma.connection.findUnique.mockResolvedValue({
			connectionConfigEnc: conn.connectionConfigEnc,
		});
		mockPrisma.connection.update.mockResolvedValue(conn);

		globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
			expect(url.toString()).toBe("http://prometheus.internal:9090/-/ready");
			return new Response("ok", { status: 200 });
		}) as any;

		const result = await service.testConnection("conn-prom-1");

		expect(result).toEqual({ success: true });
		expect(mockAuthManager.verifyConnection).not.toHaveBeenCalled();
		expect(mockPrisma.connection.update).toHaveBeenCalledWith({
			where: { id: "conn-prom-1" },
			data: expect.objectContaining({
				status: "ACTIVE",
				lastErrorMessage: null,
				consecutiveErrors: 0,
			}),
		});
	});

	it("tests URL-only template: 503 -> ERROR with message", async () => {
		const conn = {
			id: "conn-prom-2",
			integrationId: "int-prom-2",
			consecutiveErrors: 1,
			integration: {
				templateId: "prometheus",
				label: "My Prometheus",
			},
			connectionConfigEnc: Buffer.from(
				JSON.stringify({ baseUrl: "http://prometheus.internal:9090" }),
			),
		};

		mockPrisma.connection.findFirst.mockResolvedValue(conn);
		mockPrisma.connection.findUnique.mockResolvedValue({
			connectionConfigEnc: conn.connectionConfigEnc,
		});
		mockPrisma.connection.update.mockResolvedValue(conn);

		globalThis.fetch = vi.fn(async () => {
			return new Response("Service Unavailable", { status: 503 });
		}) as any;

		const result = await service.testConnection("conn-prom-2");

		expect(result).toEqual({
			success: false,
			error: "Prometheus answered 503",
		});
		expect(mockAuthManager.verifyConnection).not.toHaveBeenCalled();
		expect(mockPrisma.connection.update).toHaveBeenCalledWith({
			where: { id: "conn-prom-2" },
			data: expect.objectContaining({
				status: "ERROR",
				lastErrorMessage: "Prometheus answered 503",
				consecutiveErrors: 2,
			}),
		});
	});

	it("credentialed template still goes through verifyConnection", async () => {
		const conn = {
			id: "conn-render-1",
			integrationId: "int-render-1",
			consecutiveErrors: 0,
			integration: {
				templateId: "render",
				label: "My Render",
			},
			connectionConfigEnc: null,
		};

		mockPrisma.connection.findFirst.mockResolvedValue(conn);
		mockPrisma.connection.update.mockResolvedValue(conn);
		mockAuthManager.verifyConnection.mockResolvedValue({ success: true });

		const fetchSpy = vi.fn();
		globalThis.fetch = fetchSpy as any;

		const result = await service.testConnection("conn-render-1");

		expect(result).toEqual({ success: true });
		expect(mockAuthManager.verifyConnection).toHaveBeenCalledWith("conn-render-1");
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(mockPrisma.connection.update).toHaveBeenCalledWith({
			where: { id: "conn-render-1" },
			data: expect.objectContaining({
				status: "ACTIVE",
			}),
		});
	});
});
