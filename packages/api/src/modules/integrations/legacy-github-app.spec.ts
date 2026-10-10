// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { devNull } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../core/prisma/prisma.service.js";
import type { TelemetryService } from "../../core/telemetry/telemetry.service.js";
import { CredentialsService } from "./crypto/credentials.service.js";
import { GitCredentialService } from "./git-credential.service.js";
import { IntegrationsController } from "./integrations.controller.js";
import { IntegrationsService } from "./integrations.service.js";
import { TokenRefreshProcessor } from "./token-refresh.processor.js";

describe("Legacy GitHub App upgrade path (§1.5.3, D9, S15)", () => {
	let integrationsService: IntegrationsService;
	let gitCredentialService: GitCredentialService;
	let credentialsService: CredentialsService;
	let mockPrisma: any;
	let mockTelemetry: any;

	beforeEach(() => {
		// preview() probes the machine's git helper; keep it off this host's config (macOS osxkeychain blocks on CI).
		vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
		vi.stubEnv("GIT_CONFIG_GLOBAL", devNull);
		const mockConfigService = {
			get: vi.fn().mockReturnValue("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"),
		};
		credentialsService = new CredentialsService(mockConfigService as any);

		mockPrisma = {
			connection: {
				findFirst: vi.fn(),
				findUnique: vi.fn(),
				findMany: vi.fn(),
				update: vi.fn(),
				delete: vi.fn(),
				count: vi.fn(),
			},
			integration: {
				findUnique: vi.fn(),
				delete: vi.fn(),
			},
			repository: {
				findMany: vi.fn().mockResolvedValue([]),
				update: vi.fn(),
				updateMany: vi.fn(),
			},
			serviceRepository: {
				findMany: vi.fn().mockResolvedValue([]),
			},
			$transaction: vi.fn(async (cb: (tx: any) => Promise<unknown>) => cb(mockPrisma)),
		};

		mockTelemetry = {
			capture: vi.fn(),
		};

		integrationsService = new IntegrationsService(
			mockPrisma as unknown as PrismaService,
			credentialsService,
			mockTelemetry as unknown as TelemetryService,
		);

		gitCredentialService = new GitCredentialService(
			mockPrisma as unknown as PrismaService,
			credentialsService,
			integrationsService,
		);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});

	it("mandatory upgrade path: sweep ignores row, Settings lists legacy: true, preview shows legacy-link, Delete detaches repos and removes Integration", async () => {
		// 1. Seed a 0.5.0-shaped Integration: templateId "github-app", clientSecretEnc set (app private key)
		const integrationId = "int-legacy-gh-app";
		const connectionId = "conn-legacy-gh-app";
		const repoId = "repo-linked-1";
		const serviceId = "svc-checkout-1";

		const privateKeyEnc = credentialsService.encrypt({ privateKey: "-----BEGIN RSA PRIVATE KEY-----\nMIIE..." });
		const tokenEnc = credentialsService.encrypt({ token: "ghs_installation_token" });

		const legacyIntegration = {
			id: integrationId,
			templateId: "github-app",
			label: "Acme GitHub App",
			clientSecretEnc: privateKeyEnc,
			scopes: "[]",
			callbackUrl: null,
			enabled: true,
			createdAt: new Date("2026-01-01T00:00:00Z"),
			updatedAt: new Date("2026-01-01T00:00:00Z"),
		};

		// ACTIVE Connection with tokenExpiresAt one hour in the past
		const oneHourAgo = new Date(Date.now() - 3600_000);
		const legacyConnection = {
			id: connectionId,
			integrationId,
			label: "Acme Org Installation",
			status: "ACTIVE",
			tokenExpiresAt: oneHourAgo,
			credentialsEnc: tokenEnc,
			connectionConfigEnc: null,
			consecutiveErrors: 0,
			lastErrorMessage: null,
			createdAt: new Date("2026-01-01T00:00:00Z"),
			updatedAt: new Date("2026-01-01T00:00:00Z"),
			integration: legacyIntegration,
		};

		// Repository discovered through connectionId linked to a Service
		const repoRow = {
			id: repoId,
			fullName: "acme/checkout",
			url: "https://github.com/acme/checkout.git",
			sourceKind: "url",
			connectionId,
			metadata: null,
		};

		// 2. Token sweep selects nothing and logs no warning
		const processor = new TokenRefreshProcessor(
			mockPrisma as unknown as PrismaService,
			integrationsService,
		);

		// findMany during sweep filters where status: ACTIVE, lt cutoff, templateId in OAUTH2_TEMPLATE_IDS
		mockPrisma.connection.findMany.mockImplementation(async (args: any) => {
			const templateIn = args?.where?.integration?.templateId?.in;
			if (templateIn) {
				// Assert github-app is not in the sweep template filter
				expect(templateIn).not.toContain("github-app");
				// Does not select this legacy connection
				return [];
			}
			return [legacyConnection];
		});

		const resolveSpy = vi.spyOn(integrationsService, "resolveAccessToken");
		await processor.process();
		expect(resolveSpy).not.toHaveBeenCalled();

		// 3. Settings list returns the row with legacy: true
		mockPrisma.connection.findMany.mockResolvedValue([legacyConnection]);
		const controller = new IntegrationsController(
			integrationsService,
			gitCredentialService,
			{ get: vi.fn() } as any,
		);

		const serialized = (controller as any).serializeConnectionWithIntegration(legacyConnection);
		expect(serialized.legacy).toBe(true);
		expect(serialized.templateName).toBe("GitHub App (removed in 0.5.1)");

		// 4. The service row preview returns problem.code === "legacy-link"
		mockPrisma.connection.findUnique.mockImplementation(async ({ where }: any) => {
			if (where.id === connectionId) {
				return { integration: { templateId: "github-app" } };
			}
			return null;
		});

		const preview = await gitCredentialService.preview({
			sourceKind: "url",
			url: "https://github.com/acme/checkout.git",
			connectionId,
			pick: null,
		});

		expect(preview.problem?.code).toBe("legacy-link");
		expect(preview.problem?.message).toBe(
			"This repository was linked to a removed GitHub App connection. Add a Git host token, or sign your machine's git in.",
		);

		// 5. Delete detaches repositories (connectionId = null), preserves ServiceRepository, removes Connection and parent Integration
		mockPrisma.connection.findFirst.mockResolvedValue(legacyConnection);
		mockPrisma.connection.count.mockResolvedValue(0); // No other connections under this integration
		mockPrisma.repository.findMany.mockResolvedValue([repoRow]);

		const deleted = await integrationsService.deleteConnection(connectionId);
		expect(deleted).toBe(true);

		// Assert repositories detached: connectionId set to null
		expect(mockPrisma.repository.updateMany).toHaveBeenCalledWith({
			where: { connectionId: { in: [connectionId] } },
			data: { connectionId: null },
		});
		// Connection row deleted
		expect(mockPrisma.connection.delete).toHaveBeenCalledWith({
			where: { id: connectionId },
		});
		// Integration row (storing private key in clientSecretEnc) deleted
		expect(mockPrisma.integration.delete).toHaveBeenCalledWith({
			where: { id: integrationId },
		});
		// ServiceRepository row was untouched (never deleted)
	});
});
