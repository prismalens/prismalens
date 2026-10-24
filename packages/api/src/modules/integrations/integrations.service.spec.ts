// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../core/prisma/prisma.service.js";
import type { TelemetryService } from "../../core/telemetry/telemetry.service.js";
import { CredentialsService } from "./crypto/credentials.service.js";
import {
	IntegrationsService,
	parseTokenExpiration,
} from "./integrations.service.js";
import { TokenRefreshProcessor } from "./token-refresh.processor.js";

// Mock git-spawn so spawnGit can be controlled cleanly
vi.mock("../../core/harness/git-spawn.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../core/harness/git-spawn.js")>();
	return {
		...actual,
		spawnGit: vi.fn(),
		effectiveGitUrl: vi.fn(async (url: string) => url),
	};
});

describe("IntegrationsService git credentials and legacy rows (#810)", () => {
	let service: IntegrationsService;
	let mockPrisma: any;
	let credentialsService: CredentialsService;
	let mockTelemetry: any;
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		mockPrisma = {
			connection: {
				findFirst: vi.fn(),
				findUnique: vi.fn(),
				findMany: vi.fn(),
				update: vi.fn(),
			},
			repository: {
				findMany: vi.fn().mockResolvedValue([]),
			},
		};

		const mockConfigService = {
			get: vi.fn().mockReturnValue("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"),
		};
		credentialsService = new CredentialsService(mockConfigService as any);

		mockTelemetry = {
			capture: vi.fn(),
		};

		service = new IntegrationsService(
			mockPrisma as unknown as PrismaService,
			credentialsService,
			mockTelemetry as unknown as TelemetryService,
		);
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	describe("T13: testConnection runs ls-remote per matching repo three at a time and returns details", () => {
		it("runs ls-remote in batches of 3 and reports ok for each repo", async () => {
			const connEnc = credentialsService.encrypt({ token: "ghp_secret" });
			const configEnc = credentialsService.encrypt({ host: "github.com" });
			const conn = {
				id: "conn-git-1",
				label: "Personal GitHub",
				status: "ACTIVE",
				consecutiveErrors: 0,
				integration: {
					templateId: "git-host-token",
					label: "Git host token",
				},
				credentialsEnc: connEnc,
				connectionConfigEnc: configEnc,
			};

			mockPrisma.connection.findFirst.mockResolvedValue(conn);
			mockPrisma.connection.findUnique.mockResolvedValue(conn);
			mockPrisma.connection.update.mockResolvedValue(conn);

			// 4 repos matching github.com
			mockPrisma.repository.findMany.mockResolvedValue([
				{ url: "https://github.com/org/repo1.git" },
				{ url: "https://github.com/org/repo2.git" },
				{ url: "https://github.com/org/repo3.git" },
				{ url: "https://github.com/org/repo4.git" },
			]);

			const gitSpawnMod = await import("../../core/harness/git-spawn.js");
			const spawnGitMock = vi.mocked(gitSpawnMod.spawnGit);

			let activeCalls = 0;
			let maxActiveCalls = 0;

			spawnGitMock.mockImplementation(async (args: any) => {
				activeCalls++;
				if (activeCalls > maxActiveCalls) {
					maxActiveCalls = activeCalls;
				}
				await new Promise((r) => setTimeout(r, 10));
				activeCalls--;
				return { stdout: "hash\trefs/heads/main\n", stderr: "" };
			});

			globalThis.fetch = vi.fn(async () => {
				return new Response(JSON.stringify({ login: "octocat" }), {
					status: 200,
					headers: { "github-authentication-token-expiration": "2026-10-17 09:30:00 UTC" },
				});
			}) as any;

			const result = await service.testConnection("conn-git-1");

			expect(result.success).toBe(true);
			expect(result.details).toEqual([
				"ok org/repo1",
				"ok org/repo2",
				"ok org/repo3",
				"ok org/repo4",
			]);
			expect(maxActiveCalls).toBeLessThanOrEqual(3);
			expect(mockPrisma.connection.update).toHaveBeenCalledWith({
				where: { id: "conn-git-1" },
				data: { tokenExpiresAt: new Date("2026-10-17T09:30:00.000Z") },
			});
			expect(mockPrisma.connection.update).toHaveBeenCalledWith({
				where: { id: "conn-git-1" },
				data: expect.objectContaining({
					status: "ACTIVE",
					lastErrorMessage: null,
					consecutiveErrors: 0,
				}),
			});
		});
	});

	describe("T13b: no matching repo -> untested, status unchanged", () => {
		it("returns untested result with informational message and leaves status intact", async () => {
			const connEnc = credentialsService.encrypt({ token: "ghp_secret" });
			const configEnc = credentialsService.encrypt({ host: "gitlab.com" });
			const conn = {
				id: "conn-git-untested",
				label: "GitLab Token",
				status: "ERROR",
				consecutiveErrors: 2,
				integration: {
					templateId: "git-host-token",
					label: "Git host token",
				},
				credentialsEnc: connEnc,
				connectionConfigEnc: configEnc,
			};

			mockPrisma.connection.findFirst.mockResolvedValue(conn);
			mockPrisma.connection.findUnique.mockResolvedValue(conn);
			mockPrisma.repository.findMany.mockResolvedValue([]);

			const result = await service.testConnection("conn-git-untested");

			expect(result).toEqual({
				success: false,
				untested: true,
				details: ["No repository on gitlab.com yet. Add one to a service, then test again."],
			});
			// Must not update connection status or error count
			expect(mockPrisma.connection.update).not.toHaveBeenCalled();
		});
	});

	describe("T13c: /user 401 -> failed Test, token-rejected", () => {
		it("fails test with token-rejected when api.github.com/user answers 401", async () => {
			const connEnc = credentialsService.encrypt({ token: "ghp_revoked" });
			const configEnc = credentialsService.encrypt({ host: "github.com" });
			const conn = {
				id: "conn-git-revoked",
				label: "Revoked PAT",
				status: "ACTIVE",
				consecutiveErrors: 0,
				integration: {
					templateId: "git-host-token",
					label: "Git host token",
				},
				credentialsEnc: connEnc,
				connectionConfigEnc: configEnc,
			};

			mockPrisma.connection.findFirst.mockResolvedValue(conn);
			mockPrisma.connection.findUnique.mockResolvedValue(conn);
			mockPrisma.connection.update.mockResolvedValue(conn);

			globalThis.fetch = vi.fn(async () => {
				return new Response("Unauthorized", { status: 401 });
			}) as any;

			// git's own refusal of the same token reads word for word the same (#831 w6-9).
			type Token = { label: string; fingerprint: string };
			vi.spyOn(
				service as unknown as {
					lsRemoteMatching: (
						t: Token,
					) => Promise<{ details: string[]; rejected: string | null }>;
				},
				"lsRemoteMatching",
			).mockImplementation(async (t) => {
				const message = `github.com rejected token "${t.label}" (fp ${t.fingerprint}). It was revoked or mistyped; replace it.`;
				return { details: [message, "ok org/other"], rejected: message };
			});

			const result = await service.testConnection("conn-git-revoked");

			expect(result.success).toBe(false);
			expect(result.error).toMatch(/github\.com rejected token "Revoked PAT"/);
			expect(result.error).toMatch(/It was revoked or mistyped; replace it\./);
			expect(result.details).toEqual([result.error, "ok org/other"]);
			expect(mockPrisma.connection.update).toHaveBeenCalledWith({
				where: { id: "conn-git-revoked" },
				data: expect.objectContaining({
					status: "CREDENTIALS_INVALID",
					lastErrorMessage: expect.stringContaining("github.com rejected token"),
				}),
			});
		});
	});

	describe("T13d: a non-GitHub host refusing the token in ls-remote -> CREDENTIALS_INVALID", () => {
		it("reads the refusal as rejected, not a plain error", async () => {
			const conn = {
				id: "conn-gitlab",
				label: "GitLab Token",
				status: "ACTIVE",
				consecutiveErrors: 0,
				integration: { templateId: "git-host-token", label: "Git host token" },
				credentialsEnc: credentialsService.encrypt({ token: "glpat_revoked" }),
				connectionConfigEnc: credentialsService.encrypt({ host: "gitlab.com" }),
			};
			mockPrisma.connection.findFirst.mockResolvedValue(conn);
			mockPrisma.connection.findUnique.mockResolvedValue(conn);
			mockPrisma.connection.update.mockResolvedValue(conn);
			mockPrisma.repository.findMany.mockResolvedValue([
				{ url: "https://gitlab.com/org/repo.git" },
			]);
			const gitSpawnMod = await import("../../core/harness/git-spawn.js");
			vi.mocked(gitSpawnMod.spawnGit).mockRejectedValue(
				new gitSpawnMod.GitSpawnError(
					"git ls-remote failed",
					128,
					"remote: HTTP Basic: Access denied\nfatal: Authentication failed for 'https://gitlab.com/org/repo.git/'",
					false,
				),
			);
			globalThis.fetch = vi.fn(async () => {
				throw new Error("no GitHub call for gitlab.com");
			}) as typeof fetch;

			const result = await service.testConnection("conn-gitlab");

			expect(result).toMatchObject({ success: false, rejected: true });
			expect(result.error).toMatch(/^gitlab\.com rejected token "GitLab Token"/);
			expect(globalThis.fetch).not.toHaveBeenCalled();
			expect(mockPrisma.connection.update).toHaveBeenCalledWith({
				where: { id: "conn-gitlab" },
				data: expect.objectContaining({ status: "CREDENTIALS_INVALID" }),
			});
		});
	});

	describe("T14: parseTokenExpiration header fixture -> tokenExpiresAt, malformed -> null", () => {
		it("parses valid GitHub expiration timestamp format into Date UTC", () => {
			const parsed = parseTokenExpiration("2026-10-17 09:30:00 UTC");
			expect(parsed).toBeInstanceOf(Date);
			expect(parsed?.toISOString()).toBe("2026-10-17T09:30:00.000Z");
		});

		it("returns null for malformed or absent header values", () => {
			expect(parseTokenExpiration(null)).toBeNull();
			expect(parseTokenExpiration("")).toBeNull();
			expect(parseTokenExpiration("invalid-date")).toBeNull();
			expect(parseTokenExpiration("2026-10-17T09:30:00Z")).toBeNull();
			expect(parseTokenExpiration("Sun, 17 Oct 2026 09:30:00 GMT")).toBeNull();
		});
	});

	describe("T15: sweep leaves an expired api_key row ACTIVE and never calls resolveAccessToken for it", () => {
		it("does not select non-oauth2 templates during proactive refresh sweep", async () => {
			const processor = new TokenRefreshProcessor(
				mockPrisma as unknown as PrismaService,
				service,
			);

			const resolveSpy = vi.spyOn(service, "resolveAccessToken");

			// Expiring connections query should filter to OAUTH2_TEMPLATE_IDS only
			mockPrisma.connection.findMany.mockImplementation(async (args: any) => {
				const templateIn = args?.where?.integration?.templateId?.in ?? [];
				expect(templateIn).not.toContain("git-host-token");
				expect(templateIn).not.toContain("github-token");
				expect(templateIn).not.toContain("github-app");
				return [];
			});

			await processor.process();

			expect(resolveSpy).not.toHaveBeenCalled();
		});
	});

	describe("T15b: a legacy github-app row is not selected during sweep", () => {
		it("excludes github-app from the sweep's OAUTH2_TEMPLATE_IDS query", async () => {
			const processor = new TokenRefreshProcessor(
				mockPrisma as unknown as PrismaService,
				service,
			);

			mockPrisma.connection.findMany.mockResolvedValue([]);

			await processor.process();

			expect(mockPrisma.connection.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					where: expect.objectContaining({
						status: "ACTIVE",
						integration: {
							templateId: {
								in: expect.not.arrayContaining(["github-app"]),
							},
						},
					}),
				}),
			);
		});
	});

	describe("T15c: Settings list marks tokenExpiresAt < now as TOKEN_EXPIRED", () => {
		it("returns TOKEN_EXPIRED status when tokenExpiresAt is in the past for an ACTIVE connection", async () => {
			const past = new Date(Date.now() - 3600_000);
			const conn = {
				id: "conn-expired",
				integrationId: "int-1",
				label: "Expired PAT",
				status: "ACTIVE",
				tokenExpiresAt: past,
				credentialsEnc: credentialsService.encrypt({ token: "tok" }),
				connectionConfigEnc: credentialsService.encrypt({ host: "github.com" }),
				integration: {
					id: "int-1",
					templateId: "git-host-token",
					label: "Git host token",
					scopes: "[]",
					callbackUrl: null,
					enabled: true,
					createdAt: new Date(),
					updatedAt: new Date(),
				},
				consecutiveErrors: 0,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			mockPrisma.connection.findMany.mockResolvedValue([conn]);

			const { IntegrationsController } = await import("./integrations.controller.js");
			const controller = new IntegrationsController(
				service,
				{ invalidate: vi.fn() } as any,
				{ get: vi.fn() } as any,
			);

			const serialized = (controller as any).serializeConnectionWithIntegration(conn);
			expect(serialized.status).toBe("TOKEN_EXPIRED");
		});
	});

	describe("T15d: recordGitFailure writes the failed status once per distinct message", () => {
		it("writes CREDENTIALS_INVALID (\"rejected\") and lastErrorMessage once for a rejected token, ignoring duplicates (#831 w6-9)", async () => {
			mockPrisma.connection.findUnique.mockResolvedValueOnce({
				status: "ACTIVE",
				lastErrorMessage: null,
			});
			mockPrisma.connection.update.mockResolvedValue({});

			await service.recordGitFailure("conn-fail-1", {
				code: "token-rejected",
				message: "Authentication failed for https://github.com/org/repo.git",
			});

			expect(mockPrisma.connection.update).toHaveBeenCalledTimes(1);
			expect(mockPrisma.connection.update).toHaveBeenCalledWith({
				where: { id: "conn-fail-1" },
				data: expect.objectContaining({
					status: "CREDENTIALS_INVALID",
					lastErrorMessage: "Authentication failed for https://github.com/org/repo.git",
					consecutiveErrors: { increment: 1 },
				}),
			});

			// Second call with same message should not update again
			mockPrisma.connection.findUnique.mockResolvedValueOnce({
				status: "CREDENTIALS_INVALID",
				lastErrorMessage: "Authentication failed for https://github.com/org/repo.git",
			});

			await service.recordGitFailure("conn-fail-1", {
				code: "token-rejected",
				message: "Authentication failed for https://github.com/org/repo.git",
			});

			expect(mockPrisma.connection.update).toHaveBeenCalledTimes(1);
		});

		it("writes TOKEN_EXPIRED when code is token-expired", async () => {
			mockPrisma.connection.findUnique.mockResolvedValueOnce({
				status: "ACTIVE",
				lastErrorMessage: null,
			});
			mockPrisma.connection.update.mockResolvedValue({});

			await service.recordGitFailure("conn-expired-1", {
				code: "token-expired",
				message: "Token expired on 2026-10-10",
			});

			expect(mockPrisma.connection.update).toHaveBeenCalledWith({
				where: { id: "conn-expired-1" },
				data: expect.objectContaining({
					status: "TOKEN_EXPIRED",
					lastErrorMessage: "Token expired on 2026-10-10",
				}),
			});
		});
	});

	describe("a service's Telemetry rows (#831 walk 7)", () => {
		it("names two connections of one type by their own labels, the integration's when unlabelled", async () => {
			const integration = {
				templateId: "prometheus",
				label: "Prometheus",
			};
			mockPrisma.connection.findMany.mockResolvedValue([
				{ id: "c1", label: "prod", status: "ACTIVE", integration },
				{ id: "c2", label: "", status: "ACTIVE", integration },
			]);
			mockPrisma.serviceIntegration = {
				findMany: vi.fn().mockResolvedValue([]),
			};

			const rows = await service.getServiceIntegrationsWithStatus("svc-1");

			expect(rows.map((r) => r.connectionName)).toEqual(["prod", "Prometheus"]);
		});
	});

	describe("deletion impact (#831 w6-7)", () => {
		it("names a service whose Turn off here override sits on the connection", async () => {
			mockPrisma.connection.findFirst.mockResolvedValue({
				id: "c1",
				repositories: [],
				serviceMappings: [{ service: { id: "s1", name: "booklogr-api" } }],
			});

			const impact = await service.getConnectionDeletionImpact("c1");

			expect(impact?.affectedServices).toEqual([
				{ id: "s1", name: "booklogr-api", impact: "integration_override_lost" },
			]);
		});
	});

	describe("C12 git host token test: unpinned no-access & untested tokens (#848)", () => {
		it("test stays ACTIVE on an unpinned no-access", async () => {
			const connEnc = credentialsService.encrypt({ token: "ghp_tok" });
			const configEnc = credentialsService.encrypt({ host: "github.com" });
			const conn = {
				id: "conn-git-unpinned-test",
				label: "Git Token",
				status: "ACTIVE",
				consecutiveErrors: 0,
				testedAt: null,
				integration: {
					templateId: "git-host-token",
					label: "Git host token",
				},
				credentialsEnc: connEnc,
				connectionConfigEnc: configEnc,
			};

			mockPrisma.connection.findFirst.mockResolvedValue(conn);
			mockPrisma.connection.findUnique.mockResolvedValue(conn);
			mockPrisma.connection.update.mockResolvedValue(conn);

			// Two repos: repo1 unpinned fails with no-access, repo2 unpinned succeeds
			mockPrisma.repository.findMany.mockResolvedValue([
				{ url: "https://github.com/org/repo1.git", metadata: null },
				{ url: "https://github.com/org/repo2.git", metadata: null },
			]);

			const gitSpawnMod = await import("../../core/harness/git-spawn.js");
			const spawnGitMock = vi.mocked(gitSpawnMod.spawnGit);

			spawnGitMock.mockImplementation(async (args: any) => {
				const url = args[args.length - 1];
				if (url.includes("repo1")) {
					return {
						stdout: "",
						stderr: "remote: Repository not found.\nfatal: Authentication failed for 'https://github.com/org/repo1.git'",
					};
				}
				return { stdout: "ok https://github.com/org/repo2.git", stderr: "" };
			});

			const originalFetch = globalThis.fetch;
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				headers: new Headers(),
				json: async () => ({ login: "octocat" }),
			} as any);

			try {
				const result = await service.testConnection("conn-git-unpinned-test");
				expect(result.success).toBe(true);
				expect(mockPrisma.connection.update).toHaveBeenCalledWith({
					where: { id: "conn-git-unpinned-test" },
					data: expect.objectContaining({
						status: "ACTIVE",
						testedAt: expect.any(Date),
					}),
				});
			} finally {
				globalThis.fetch = originalFetch;
			}
		});

		it("a token saved untested keeps testedAt null until a test passes", async () => {
			const connEnc = credentialsService.encrypt({ token: "ghp_tok" });
			const configEnc = credentialsService.encrypt({ host: "github.com" });
			const conn = {
				id: "conn-untested",
				label: "Untested Token",
				status: "ACTIVE",
				consecutiveErrors: 0,
				testedAt: null,
				integration: {
					templateId: "git-host-token",
					label: "Git host token",
				},
				credentialsEnc: connEnc,
				connectionConfigEnc: configEnc,
			};

			mockPrisma.connection.findFirst.mockResolvedValue(conn);
			mockPrisma.connection.findUnique.mockResolvedValue(conn);
			mockPrisma.connection.update.mockResolvedValue(conn);

			// No repos on host
			mockPrisma.repository.findMany.mockResolvedValue([]);

			const originalFetch = globalThis.fetch;
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				headers: new Headers(),
				json: async () => ({ login: "octocat" }),
			} as any);

			try {
				const result = await service.testConnection("conn-untested");
				expect(result.success).toBe(false);
				expect((result as any).untested).toBe(true);

				expect(mockPrisma.connection.update).toHaveBeenCalledWith({
					where: { id: "conn-untested" },
					data: expect.not.objectContaining({
						testedAt: expect.anything(),
					}),
				});
			} finally {
				globalThis.fetch = originalFetch;
			}
		});
	});

	describe("sourceCredential state (#848 C5)", () => {
		it("sourceCredential returns state set, absent, or invalid", async () => {
			const setConn = {
				id: "conn-set",
				integration: { templateId: "prometheus" },
				credentialsEnc: credentialsService.encrypt({ kind: "bearer", token: "tok-123" }),
			};
			const noneConn = {
				id: "conn-none",
				integration: { templateId: "prometheus" },
				credentialsEnc: credentialsService.encrypt({ kind: "none" }),
			};
			const absentConn = {
				id: "conn-absent",
				integration: { templateId: "prometheus" },
				credentialsEnc: credentialsService.encrypt({}),
			};
			mockPrisma.connection.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
				if (where.id === "conn-set") return setConn;
				if (where.id === "conn-none") return noneConn;
				if (where.id === "conn-absent") return absentConn;
				return null;
			});

			const resSet = await service.sourceCredential("conn-set");
			expect(resSet).toMatchObject({ ok: true, state: "set", credential: { kind: "bearer", token: "tok-123" } });

			const resNone = await service.sourceCredential("conn-none");
			expect(resNone).toMatchObject({ ok: true, state: "set", credential: { kind: "none" } });

			const resAbsent = await service.sourceCredential("conn-absent");
			expect(resAbsent).toMatchObject({ ok: true, state: "absent", credential: { kind: "none" } });

			const resMissing = await service.sourceCredential("conn-missing");
			expect(resMissing).toMatchObject({ ok: false, state: "invalid", reason: "invalid" });
		});
	});

	describe("testedAt tracking on testConnection and updateConnection (#848)", () => {
		it("testedAt is set by a passing Test and cleared by an address edit", async () => {
			const connEnc = credentialsService.encrypt({ kind: "none" });
			const configEnc = credentialsService.encrypt({ baseUrl: "http://prom:9090" });
			const conn = {
				id: "conn-tested-1",
				label: "Prometheus",
				status: "ACTIVE",
				consecutiveErrors: 0,
				testedAt: null,
				integration: {
					templateId: "prometheus",
					label: "Prometheus",
				},
				credentialsEnc: connEnc,
				connectionConfigEnc: configEnc,
			};

			mockPrisma.connection.findFirst.mockResolvedValue(conn);
			mockPrisma.connection.findUnique.mockResolvedValue(conn);
			mockPrisma.connection.update.mockResolvedValue(conn);

			globalThis.fetch = vi.fn(async () => new Response("ready", { status: 200 })) as any;

			await service.testConnection("conn-tested-1");
			expect(mockPrisma.connection.update).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { id: "conn-tested-1" },
					data: expect.objectContaining({
						testedAt: expect.any(Date),
					}),
				}),
			);

			mockPrisma.connection.update.mockClear();
			await service.updateConnection("conn-tested-1", {
				connectionConfig: { baseUrl: "http://new-prom:9090" },
			});
			expect(mockPrisma.connection.update).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { id: "conn-tested-1" },
					data: expect.objectContaining({
						testedAt: null,
					}),
				}),
			);
		});
	});

	describe("service integration priority and ordering (#848)", () => {
		it("getServiceIntegrationsWithStatus returns priority on mapped rows, undefined on unmapped ones", async () => {
			const conn1 = {
				id: "conn-1",
				label: "Prometheus 1",
				status: "ACTIVE",
				integration: { templateId: "prometheus", label: "Prometheus" },
				connectionConfigEnc: null,
			};
			const conn2 = {
				id: "conn-2",
				label: "Prometheus 2",
				status: "ACTIVE",
				integration: { templateId: "prometheus", label: "Prometheus" },
				connectionConfigEnc: null,
			};
			mockPrisma.connection.findMany = vi.fn().mockResolvedValue([conn1, conn2]);
			mockPrisma.serviceIntegration = {
				...mockPrisma.serviceIntegration,
				findMany: vi.fn().mockResolvedValue([
					{
						id: "override-1",
						connectionId: "conn-1",
						serviceId: "svc-1",
						priority: 5,
						config: null,
						connection: conn1,
					},
				]),
			};

			const rows = await service.getServiceIntegrationsWithStatus("svc-1");
			const mapped = rows.find((r) => r.connectionId === "conn-1");
			const unmapped = rows.find((r) => r.connectionId === "conn-2");

			expect(mapped?.priority).toBe(5);
			expect(unmapped?.priority).toBeUndefined();
		});

		it("setServiceIntegrationOrder(svc, [a, b, c]) sets priorities 3, 2, 1 in one $transaction", async () => {
			mockPrisma.serviceIntegration = {
				...mockPrisma.serviceIntegration,
				count: vi.fn().mockResolvedValue(3),
				update: vi.fn(({ where, data }: { where: { id: string }; data: { priority: number } }) => ({
					id: where.id,
					priority: data.priority,
				})),
			};
			mockPrisma.$transaction = vi.fn(async (ops: unknown[]) => ops);

			const res = await service.setServiceIntegrationOrder("svc-1", ["a", "b", "c"]);

			expect(mockPrisma.serviceIntegration.count).toHaveBeenCalledWith({
				where: { id: { in: ["a", "b", "c"] }, serviceId: "svc-1" },
			});
			expect(mockPrisma.$transaction).toHaveBeenCalledWith([
				expect.anything(),
				expect.anything(),
				expect.anything(),
			]);
			expect(mockPrisma.serviceIntegration.update).toHaveBeenNthCalledWith(1, {
				where: { id: "a" },
				data: { priority: 3 },
			});
			expect(mockPrisma.serviceIntegration.update).toHaveBeenNthCalledWith(2, {
				where: { id: "b" },
				data: { priority: 2 },
			});
			expect(mockPrisma.serviceIntegration.update).toHaveBeenNthCalledWith(3, {
				where: { id: "c" },
				data: { priority: 1 },
			});
			expect(res).toEqual([
				{ id: "a", priority: 3 },
				{ id: "b", priority: 2 },
				{ id: "c", priority: 1 },
			]);
		});

		it("returns null with no update when an id belongs to another service or doesn't exist", async () => {
			mockPrisma.serviceIntegration = {
				...mockPrisma.serviceIntegration,
				count: vi.fn().mockResolvedValue(2),
				update: vi.fn(),
			};
			mockPrisma.$transaction = vi.fn();

			const res = await service.setServiceIntegrationOrder("svc-1", ["a", "b", "foreign-or-missing"]);

			expect(res).toBeNull();
			expect(mockPrisma.$transaction).not.toHaveBeenCalled();
			expect(mockPrisma.serviceIntegration.update).not.toHaveBeenCalled();
		});
	});
});
