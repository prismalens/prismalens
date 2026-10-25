// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { BadRequestException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SourcesOverviewSchema } from "@prismalens/contracts/schemas";
import type { PrismaService } from "../../core/prisma/prisma.service.js";
import type { GitCredentialService } from "./git-credential.service.js";
import type { IntegrationsService } from "./integrations.service.js";
import { IntegrationsController } from "./integrations.controller.js";
import { sourceProblem, SourcesService } from "./sources.service.js";

vi.mock("./source-request.js", () => ({
	sourceRequestFn: vi.fn(),
}));

describe("SourcesService (#848 C17)", () => {
	let service: SourcesService;
	let mockPrisma: any;
	let mockIntegrations: any;
	let mockGitCredentials: any;

	beforeEach(() => {
		mockPrisma = {
			connection: {
				findMany: vi.fn().mockResolvedValue([]),
				findFirst: vi.fn().mockResolvedValue(null),
				create: vi.fn(),
				update: vi.fn().mockResolvedValue({}),
			},
			integration: {
				findFirst: vi.fn().mockResolvedValue(null),
				create: vi.fn(),
			},
		};

		mockIntegrations = {
			baseUrlOf: vi.fn((c) => c.connectionConfig?.baseUrl ?? "http://prom.example:9090"),
			sourceCredential: vi.fn().mockResolvedValue({ state: "absent" }),
			probeHostToken: vi.fn().mockResolvedValue({ success: true, details: ["ok repo1"] }),
			createConnection: vi.fn().mockResolvedValue({ id: "new-conn-123" }),
			createIntegration: vi.fn().mockResolvedValue({ id: "new-int-123" }),
		};

		mockGitCredentials = {
			hosts: vi.fn().mockResolvedValue([]),
			fingerprint: vi.fn().mockReturnValue("12345678"),
			invalidate: vi.fn(),
		};

		service = new SourcesService(
			mockPrisma as unknown as PrismaService,
			mockIntegrations as unknown as IntegrationsService,
			mockGitCredentials as unknown as GitCredentialService,
		);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("sourceProblem mapping", () => {
		it("maps status and errors to problems per §4 C17 truth table", () => {
			expect(sourceProblem("ACTIVE", null, "stored")).toBeNull();
			expect(sourceProblem("ACTIVE", "some message", "none")).toBeNull();
			expect(sourceProblem("CREDENTIALS_INVALID", null, "stored")).toBe("credential-refused");
			expect(sourceProblem("REFRESH_FAILED", null, "stored")).toBe("credential-refused");
			expect(sourceProblem("TOKEN_EXPIRED", "expired", "stored")).toBeNull();

			// Reach failures
			expect(sourceProblem("ERROR", "fetch failed", "none")).toBe("cant-reach");
			expect(sourceProblem("ERROR", "connect ECONNREFUSED 127.0.0.1:9090", "stored")).toBe("cant-reach");
			expect(sourceProblem("ERROR", "getaddrinfo ENOTFOUND prom.internal", "env")).toBe("cant-reach");
			expect(sourceProblem("ERROR", "request timed out after 5000ms", "none")).toBe("cant-reach");

			// 401 / 403
			expect(sourceProblem("ERROR", "prometheus answered 401 Unauthorized", "none")).toBe("needs-credential");
			expect(sourceProblem("ERROR", "prometheus answered 403 Forbidden", "none")).toBe("needs-credential");
			expect(sourceProblem("ERROR", "prometheus answered 401 Unauthorized", "stored")).toBe("credential-refused");
			expect(sourceProblem("ERROR", "prometheus answered 403 Forbidden", "stored")).toBe("credential-refused");

			// Other ERROR
			expect(sourceProblem("ERROR", "database corrupt", "stored")).toBeNull();
			expect(sourceProblem("ERROR", null, "stored")).toBeNull();
		});
	});

	describe("GET /sources (overview)", () => {
		it("gives credential: env for absent credential with same-origin token, and none for other-port", async () => {
			mockPrisma.connection.findMany.mockResolvedValue([
				{
					id: "conn-same-origin",
					label: "Prom Same Origin",
					status: "ACTIVE",
					tokenExpiresAt: null,
					testedAt: new Date("2026-10-24T10:00:00Z"),
					lastErrorMessage: null,
					integration: { templateId: "prometheus", label: "Prometheus" },
					connectionConfig: { baseUrl: "http://prom.example:9090" },
					serviceMappings: [
						{ isEnabled: true, config: { enabled: true }, service: { id: "s1", name: "svc1" } },
						{ isEnabled: false, config: { enabled: true }, service: { id: "s2", name: "svc2" } },
					],
				},
				{
					id: "conn-other-port",
					label: "Prom Other Port",
					status: "ERROR",
					tokenExpiresAt: null,
					testedAt: null,
					lastErrorMessage: "fetch failed",
					integration: { templateId: "prometheus", label: "Prometheus" },
					connectionConfig: { baseUrl: "http://prom.example:9091" },
					serviceMappings: [],
				},
				{
					id: "conn-stored-override",
					label: "Prom Stored",
					status: "ACTIVE",
					tokenExpiresAt: null,
					testedAt: null,
					lastErrorMessage: null,
					integration: { templateId: "prometheus", label: "Prometheus" },
					connectionConfig: { baseUrl: "http://prom.example:9090" },
					serviceMappings: [],
				},
			]);

			mockIntegrations.baseUrlOf.mockImplementation((c: any) => c.connectionConfig.baseUrl);
			mockIntegrations.sourceCredential.mockImplementation(async (id: string) => {
				if (id === "conn-stored-override") {
					return { state: "set", ok: true, credential: { kind: "bearer", token: "stored-token" } };
				}
				return { state: "absent" };
			});

			const env = {
				PROMETHEUS_URL: "http://prom.example:9090/subpath",
				PROMETHEUS_TOKEN: "env-secret-token",
			};

			const overview = await service.overview(env);

			expect(overview.sources).toHaveLength(3);
			const [sameOrigin, otherPort, stored] = overview.sources;

			expect(sameOrigin.credential).toBe("env");
			expect(sameOrigin.usedBy).toEqual([{ serviceId: "s1", name: "svc1" }]);
			expect(sameOrigin.alsoInAlertIntake).toBe(true);

			expect(otherPort.credential).toBe("none");
			expect(otherPort.problem).toBe("cant-reach");

			expect(stored.credential).toBe("stored");
			expect(stored.credentialKind).toBe("bearer");
			expect(stored.overridesEnv).toBe("PROMETHEUS_TOKEN");

			expect(SourcesOverviewSchema.safeParse(overview).success).toBe(true);
		});
	});

	describe("a URL with user:pass@ never leaves in a response (#848)", () => {
		it("overview redacts a stored address and its last error", async () => {
			mockPrisma.connection.findMany.mockResolvedValue([
				{
					id: "conn-userinfo",
					label: "Prom",
					status: "ERROR",
					tokenExpiresAt: null,
					testedAt: null,
					lastErrorMessage: "fetch failed: https://user:sentinel@prom.example/-/ready",
					connectionConfig: { baseUrl: "https://user:sentinel@prom.example:9090" },
					integration: { templateId: "prometheus", label: "Prometheus" },
					serviceMappings: [],
				},
			]);
			mockIntegrations.baseUrlOf.mockImplementation((c: any) => c.connectionConfig.baseUrl);

			const overview = await service.overview({});

			expect(overview.sources[0]?.address).toBe("https://prom.example:9090");
			expect(overview.sources[0]?.problem).toBe("cant-reach");
			expect(JSON.stringify(overview)).not.toContain("sentinel");
		});

		it("a probe failure does not echo the draft URL's credentials", async () => {
			const { sourceRequestFn } = await import("./source-request.js");
			vi.mocked(sourceRequestFn).mockReturnValue(async () => {
				throw new TypeError(
					"Request cannot be constructed from a URL that includes credentials: https://user:sentinel@prom.example/-/ready",
				);
			});

			const report = await service.test({
				type: "prometheus",
				url: "https://user:sentinel@prom.example",
				credential: { kind: "none" },
			} as any);

			expect(report.ok).toBe(false);
			expect(JSON.stringify(report)).not.toContain("sentinel");
		});
	});

	describe("POST /sources/test (draft probe)", () => {
		it("a draft probe saves nothing and reports ok on 200", async () => {
			const { sourceRequestFn } = await import("./source-request.js");
			vi.mocked(sourceRequestFn).mockReturnValue(async () => ({ ok: true, status: 200 } as any));

			const draft = {
				type: "prometheus",
				url: "http://prom.example:9090",
				credential: { kind: "none" as const },
			};

			const report = await service.test(draft as any);
			expect(report.ok).toBe(true);
			expect(report.probes[0]?.detail).toContain("answered 200");

			expect(mockPrisma.connection.create).not.toHaveBeenCalled();
			expect(mockPrisma.connection.update).not.toHaveBeenCalled();
		});

		it("tests git-host-token draft and returns untested when host has no repos", async () => {
			mockIntegrations.probeHostToken.mockResolvedValueOnce({
				success: false,
				untested: true,
				details: ["No repository on github.com yet."],
			});

			const draft = {
				type: "git-host-token",
				url: "github.com",
				credential: { kind: "bearer" as const, token: "ghp_draft" },
			};

			const report = await service.test(draft as any);
			expect(report.type).toBe("git-host-token");
			expect(report.untested).toBe(true);
			expect(report.ok).toBe(false);

			expect(mockPrisma.connection.create).not.toHaveBeenCalled();
		});

		it("rejects unsupported source type or credential kind with BadRequestException", async () => {
			await expect(
				service.test({
					type: "unsupported-type",
					url: "http://example.com",
					credential: { kind: "none" },
				} as any),
			).rejects.toThrowError(BadRequestException);

			await expect(
				service.test({
					type: "git-host-token",
					url: "github.com",
					credential: { kind: "none" },
				} as any),
			).rejects.toThrowError(BadRequestException);
		});
	});

	describe("POST /sources/connect", () => {
		it("connect without a passing probe leaves testedAt null (saveUntested)", async () => {
			const draft = {
				type: "prometheus",
				url: "http://prom.example:9090",
				credential: { kind: "none" as const },
				saveUntested: true,
			};

			const res = await service.connect(draft as any);
			expect(res.connectionId).toBe("new-conn-123");
			expect(res.report.untested).toBe(true);
			expect(mockIntegrations.createConnection).toHaveBeenCalled();
			expect(mockPrisma.connection.update).not.toHaveBeenCalled();
		});

		it("failing required probe returns connectionId: null and saves nothing", async () => {
			const { sourceRequestFn } = await import("./source-request.js");
			vi.mocked(sourceRequestFn).mockReturnValue(async () => ({ ok: false, status: 404 } as any));

			const draft = {
				type: "prometheus",
				url: "http://prom.example:9090",
				credential: { kind: "none" as const },
			};

			const res = await service.connect(draft as any);
			expect(res.connectionId).toBeNull();
			expect(res.report.ok).toBe(false);
			expect(mockIntegrations.createConnection).not.toHaveBeenCalled();
			expect(mockPrisma.connection.update).not.toHaveBeenCalled();
		});

		it("passing probe saves connection and sets testedAt", async () => {
			const { sourceRequestFn } = await import("./source-request.js");
			vi.mocked(sourceRequestFn).mockReturnValue(async () => ({ ok: true, status: 200 } as any));

			const draft = {
				type: "prometheus",
				url: "http://prom.example:9090",
				credential: { kind: "none" as const },
			};

			const res = await service.connect(draft as any);
			expect(res.connectionId).toBe("new-conn-123");
			expect(res.report.ok).toBe(true);
			expect(mockPrisma.connection.update).toHaveBeenCalledWith({
				where: { id: "new-conn-123" },
				data: { testedAt: expect.any(Date) },
			});
		});

		it("reuses existing Integration row on second save", async () => {
			mockPrisma.integration.findFirst.mockResolvedValueOnce({ id: "existing-int-1" });
			const { sourceRequestFn } = await import("./source-request.js");
			vi.mocked(sourceRequestFn).mockReturnValue(async () => ({ ok: true, status: 200 } as any));

			const draft = {
				type: "prometheus",
				url: "http://prom.example:9090",
				credential: { kind: "none" as const },
			};

			await service.connect(draft as any);
			expect(mockIntegrations.createIntegration).not.toHaveBeenCalled();
			expect(mockIntegrations.createConnection).toHaveBeenCalledWith(
				expect.objectContaining({ integrationId: "existing-int-1" }),
			);
		});
	});

	describe("IntegrationsController sources routes", () => {
		it("sourcesOverview, sourcesTest and sourcesConnect delegate to SourcesService", async () => {
			const controller = new IntegrationsController(
				mockIntegrations,
				mockGitCredentials,
				{} as any,
				undefined,
				service,
			);

			const overviewSpy = vi.spyOn(service, "overview").mockResolvedValueOnce({ sources: [], gitHosts: [] });
			const testSpy = vi.spyOn(service, "test").mockResolvedValueOnce({ ok: true, type: "t", host: "h", probes: [], discovered: {} });
			const connectSpy = vi.spyOn(service, "connect").mockResolvedValueOnce({ connectionId: "c1", report: { ok: true, type: "t", host: "h", probes: [], discovered: {} } });

			const overviewH = (controller.sourcesOverview() as any)["~orpc"]?.handler ?? controller.sourcesOverview();
			await overviewH({ context: {} });
			expect(overviewSpy).toHaveBeenCalled();

			const testH = (controller.sourcesTest() as any)["~orpc"]?.handler ?? controller.sourcesTest();
			await testH({ input: { type: "prometheus", url: "http://prom:9090" }, context: {} });
			expect(testSpy).toHaveBeenCalledWith({ type: "prometheus", url: "http://prom:9090" });

			const connectH = (controller.sourcesConnect() as any)["~orpc"]?.handler ?? controller.sourcesConnect();
			await connectH({ input: { type: "prometheus", url: "http://prom:9090" }, context: {} });
			expect(connectSpy).toHaveBeenCalledWith({ type: "prometheus", url: "http://prom:9090" });
		});
	});
});
