// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import util from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitCredential } from "../../core/harness/git-credential.js";
import { GitFailure } from "../../core/harness/git-failure.js";
import type { PrismaService } from "../../core/prisma/prisma.service.js";
import { CredentialsService } from "./crypto/credentials.service.js";
import {
	GitCredentialAmbiguousError,
	GitCredentialService,
	type GitRepoRef,
} from "./git-credential.service.js";
import { type HostToken, isGitHostTemplate, pickOf, readHostToken } from "./host-token.js";
import type { IntegrationsService } from "./integrations.service.js";

// Mock git-spawn so gitConfigRead and spawnGit can be controlled
vi.mock("../../core/harness/git-spawn.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../core/harness/git-spawn.js")>();
	return {
		...actual,
		gitConfigRead: vi.fn(),
		spawnGit: vi.fn(),
		effectiveGitUrl: vi.fn(async (url: string) => url),
	};
});

describe("GitCredentialService & host-token (#810)", () => {
	let service: GitCredentialService;
	let mockPrisma: any;
	let credentialsService: CredentialsService;
	let mockIntegrations: any;

	beforeEach(() => {
		mockPrisma = {
			connection: {
				findMany: vi.fn().mockResolvedValue([]),
				findUnique: vi.fn().mockResolvedValue(null),
				update: vi.fn().mockResolvedValue({}),
			},
			repository: {
				findMany: vi.fn().mockResolvedValue([]),
				update: vi.fn().mockResolvedValue({}),
			},
		};

		const mockConfigService = {
			get: vi.fn().mockReturnValue("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"),
		};
		credentialsService = new CredentialsService(mockConfigService as any);

		mockIntegrations = {
			recordGitFailure: vi.fn().mockResolvedValue(undefined),
		};

		service = new GitCredentialService(
			mockPrisma as unknown as PrismaService,
			credentialsService,
			mockIntegrations as unknown as IntegrationsService,
		);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("T1: folder -> none, label folder", async () => {
		const ref: GitRepoRef = {
			sourceKind: "folder",
			url: "/home/user/project",
			connectionId: null,
			pick: null,
		};

		const preview = await service.preview(ref);
		expect(preview).toEqual({
			source: "none",
			label: "folder",
			via: "none",
		});

		const cred = await service.resolveForUse(ref);
		expect(cred.display).toEqual({
			source: "none",
			label: "folder",
			via: "none",
		});
	});

	it("T2: scp URL -> machine/ssh, label machine git (ssh keys)", async () => {
		const ref: GitRepoRef = {
			sourceKind: "url",
			url: "git@github.com:org/repo.git",
			connectionId: null,
			pick: null,
		};

		const preview = await service.preview(ref);
		expect(preview).toEqual({
			source: "machine",
			label: "machine git (ssh keys)",
			via: "ssh keys",
		});

		const cred = await service.resolveForUse(ref);
		expect(cred.display).toEqual({
			source: "machine",
			label: "machine git (ssh keys)",
			via: "ssh keys",
		});
	});

	it("T2b: https URL with insteadOf rewriting to ssh -> machine/ssh via effectiveUrl", async () => {
		const gitSpawnMod = await import("../../core/harness/git-spawn.js");
		vi.mocked(gitSpawnMod.effectiveGitUrl).mockResolvedValueOnce("git@github.com:org/repo.git");

		const ref: GitRepoRef = {
			sourceKind: "url",
			url: "https://github.com/org/repo.git",
			connectionId: null,
			pick: null,
		};

		const preview = await service.preview(ref);
		expect(preview).toEqual({
			source: "machine",
			label: "machine git (ssh keys)",
			via: "ssh keys",
		});
	});

	it("T3: pick wins over a helper that answers", async () => {
		const connEnc = credentialsService.encrypt({ token: "ghp_picked" });
		const configEnc = credentialsService.encrypt({ host: "github.com" });
		const pickedConn = {
			id: "conn-picked",
			label: "Picked Token",
			status: "ACTIVE",
			tokenExpiresAt: null,
			lastErrorMessage: null,
			credentialsEnc: connEnc,
			connectionConfigEnc: configEnc,
			integration: {
				templateId: "git-host-token",
				label: "Git host token",
			},
		};

		mockPrisma.connection.findMany.mockResolvedValue([pickedConn]);

		const gitSpawnMod = await import("../../core/harness/git-spawn.js");
		// Mock helper answering
		vi.mocked(gitSpawnMod.gitConfigRead).mockResolvedValue({
			stdout: "!gh auth git-credential",
			stderr: "",
		});

		const ref: GitRepoRef = {
			sourceKind: "url",
			url: "https://github.com/org/repo.git",
			connectionId: null,
			pick: "conn-picked",
		};

		const preview = await service.preview(ref);
		expect(preview.source).toBe("connection");
		expect(preview.label).toBe("token Picked Token");
		expect(preview.connectionId).toBe("conn-picked");

		const cred = await service.resolveForUse(ref);
		expect(cred.display.source).toBe("connection");
		expect(cred.display.label).toBe("token Picked Token");
		expect(mockPrisma.connection.update).toHaveBeenCalledWith({
			where: { id: "conn-picked" },
			data: { lastUsedAt: expect.any(Date) },
		});
	});

	it("T3b: pick on a connection in ERROR -> preview pinned-unusable and resolveForUse throws token-rejected", async () => {
		const connEnc = credentialsService.encrypt({ token: "ghp_err" });
		const configEnc = credentialsService.encrypt({ host: "github.com" });
		const errorConn = {
			id: "conn-err",
			label: "Error Token",
			status: "ERROR",
			tokenExpiresAt: null,
			lastErrorMessage: "Bad credentials",
			credentialsEnc: connEnc,
			connectionConfigEnc: configEnc,
			integration: {
				templateId: "git-host-token",
				label: "Git host token",
			},
		};

		mockPrisma.connection.findMany.mockResolvedValue([errorConn]);

		const ref: GitRepoRef = {
			sourceKind: "url",
			url: "https://github.com/org/repo.git",
			connectionId: null,
			pick: "conn-err",
		};

		const preview = await service.preview(ref);
		expect(preview.problem?.code).toBe("pinned-unusable");
		expect(preview.problem?.message).toContain("Pinned token Error Token is in error: Bad credentials; replace it or set Auto.");

		await expect(service.resolveForUse(ref)).rejects.toThrowError(GitFailure);
		await expect(service.resolveForUse(ref)).rejects.toMatchObject({
			code: "token-rejected",
			action: "replace-token",
		});
	});

	it("T3c: pick on an expired connection -> preview and resolveForUse report expired", async () => {
		const past = new Date(Date.now() - 3600_000);
		const connEnc = credentialsService.encrypt({ token: "ghp_exp" });
		const configEnc = credentialsService.encrypt({ host: "github.com" });
		const expiredConn = {
			id: "conn-exp",
			label: "Expired Picked Token",
			status: "ACTIVE",
			tokenExpiresAt: past,
			lastErrorMessage: null,
			credentialsEnc: connEnc,
			connectionConfigEnc: configEnc,
			integration: {
				templateId: "git-host-token",
				label: "Git host token",
			},
		};

		mockPrisma.connection.findMany.mockResolvedValue([expiredConn]);

		const ref: GitRepoRef = {
			sourceKind: "url",
			url: "https://github.com/org/repo.git",
			connectionId: null,
			pick: "conn-exp",
		};

		const preview = await service.preview(ref);
		expect(preview.problem?.code).toBe("pinned-unusable");
		expect(preview.problem?.message).toContain("expired on");

		await expect(service.resolveForUse(ref)).rejects.toMatchObject({
			code: "token-expired",
		});
	});

	it("T3d: pick on a connection for wrong host or deleted connection clears pick in use mode", async () => {
		mockPrisma.connection.findMany.mockResolvedValue([]);
		mockPrisma.connection.findUnique.mockResolvedValue({ id: "conn-other-host" });
		mockPrisma.repository.findMany.mockResolvedValue([
			{
				id: "repo-1",
				url: "https://github.com/org/repo.git",
				metadata: JSON.stringify({ credentialConnectionId: "conn-other-host" }),
			},
		]);

		const gitSpawnMod = await import("../../core/harness/git-spawn.js");
		vi.mocked(gitSpawnMod.gitConfigRead).mockResolvedValue({ stdout: "", stderr: "" });

		const ref: GitRepoRef = {
			sourceKind: "url",
			url: "https://github.com/org/repo.git",
			connectionId: null,
			pick: "conn-other-host",
		};

		const cred = await service.resolveForUse(ref);
		expect(cred.display.source).toBe("none");
		expect(mockPrisma.repository.update).toHaveBeenCalledWith({
			where: { id: "repo-1" },
			data: { metadata: "{}" },
		});
	});

	it("T4: helper answers -> label machine git (helper.sh, u) and no password=p in captured output", async () => {
		const gitSpawnMod = await import("../../core/harness/git-spawn.js");
		vi.mocked(gitSpawnMod.gitConfigRead).mockImplementation(async (args: string[]) => {
			if (args.includes("credential.helper")) return { stdout: "/usr/local/bin/helper.sh", stderr: "" };
			if (args.includes("credential.useHttpPath")) return { stdout: "true", stderr: "" };
			return { stdout: "", stderr: "" };
		});

		vi.mocked(gitSpawnMod.spawnGit).mockImplementation(async (_args: string[], opts: any) => {
			if (opts?.onStdoutLine) {
				opts.onStdoutLine("username=u");
				opts.onStdoutLine("password=p");
			}
			return { stdout: "", stderr: "" };
		});

		let capturedLogs = "";
		const unhookStdout = vi.spyOn(process.stdout, "write").mockImplementation((str: any) => {
			capturedLogs += String(str);
			return true;
		});
		const unhookStderr = vi.spyOn(process.stderr, "write").mockImplementation((str: any) => {
			capturedLogs += String(str);
			return true;
		});

		try {
			const ref: GitRepoRef = {
				sourceKind: "url",
				url: "https://github.com/org/repo.git",
				connectionId: null,
				pick: null,
			};

			const preview = await service.preview(ref);
			expect(preview).toEqual({
				source: "machine",
				label: "machine git (helper.sh, u)",
				via: "/usr/local/bin/helper.sh",
			});
			expect(capturedLogs).not.toContain("password=p");
		} finally {
			unhookStdout.mockRestore();
			unhookStderr.mockRestore();
		}
	});

	it("T5: helper answers nothing -> host match", async () => {
		const connEnc = credentialsService.encrypt({ token: "ghp_tok" });
		const configEnc = credentialsService.encrypt({ host: "github.com" });
		const conn = {
			id: "conn-gh-1",
			label: "GitHub Account",
			status: "ACTIVE",
			tokenExpiresAt: null,
			lastErrorMessage: null,
			credentialsEnc: connEnc,
			connectionConfigEnc: configEnc,
			integration: {
				templateId: "git-host-token",
				label: "Git host token",
			},
		};
		mockPrisma.connection.findMany.mockResolvedValue([conn]);

		const gitSpawnMod = await import("../../core/harness/git-spawn.js");
		vi.mocked(gitSpawnMod.gitConfigRead).mockResolvedValue({ stdout: "", stderr: "" });

		const ref: GitRepoRef = {
			sourceKind: "url",
			url: "https://github.com/org/repo.git",
			connectionId: null,
			pick: null,
		};

		const preview = await service.preview(ref);
		expect(preview.source).toBe("connection");
		expect(preview.label).toBe("token GitHub Account");
		expect(preview.connectionId).toBe("conn-gh-1");
	});

	it("T5b: helper probe timeout -> preview problem probe-timeout", async () => {
		const gitSpawnMod = await import("../../core/harness/git-spawn.js");
		vi.mocked(gitSpawnMod.gitConfigRead).mockImplementation(async (args: string[]) => {
			if (args.includes("credential.helper")) return { stdout: "gh", stderr: "" };
			return { stdout: "", stderr: "" };
		});

		vi.mocked(gitSpawnMod.spawnGit).mockRejectedValueOnce(
			new gitSpawnMod.GitSpawnError("git credential timed out after 5 s", null, "", true),
		);

		const ref: GitRepoRef = {
			sourceKind: "url",
			url: "https://github.com/org/repo.git",
			connectionId: null,
			pick: null,
		};

		const preview = await service.preview(ref);
		expect(preview.problem?.code).toBe("probe-timeout");
		expect(preview.problem?.message).toBe("Your machine's git helper did not answer in 5 s.");
	});

	it("T6: two host matches -> ambiguous / GitCredentialAmbiguousError", async () => {
		const conn1Enc = credentialsService.encrypt({ token: "tok1" });
		const conn2Enc = credentialsService.encrypt({ token: "tok2" });
		const configEnc = credentialsService.encrypt({ host: "github.com" });
		mockPrisma.connection.findMany.mockResolvedValue([
			{
				id: "conn-1",
				label: "Token 1",
				status: "ACTIVE",
				tokenExpiresAt: null,
				lastErrorMessage: null,
				credentialsEnc: conn1Enc,
				connectionConfigEnc: configEnc,
				integration: { templateId: "git-host-token", label: "Git host token" },
			},
			{
				id: "conn-2",
				label: "Token 2",
				status: "ACTIVE",
				tokenExpiresAt: null,
				lastErrorMessage: null,
				credentialsEnc: conn2Enc,
				connectionConfigEnc: configEnc,
				integration: { templateId: "git-host-token", label: "Git host token" },
			},
		]);

		const gitSpawnMod = await import("../../core/harness/git-spawn.js");
		vi.mocked(gitSpawnMod.gitConfigRead).mockResolvedValue({ stdout: "", stderr: "" });

		const ref: GitRepoRef = {
			sourceKind: "url",
			url: "https://github.com/org/repo.git",
			connectionId: null,
			pick: null,
		};

		const preview = await service.preview(ref);
		expect(preview.source).toBe("none");
		expect(preview.label).toBe("no token chosen");
		expect(preview.problem?.code).toBe("ambiguous");
		expect(preview.problem?.candidates).toHaveLength(2);

		await expect(service.resolveForUse(ref)).rejects.toThrowError(GitCredentialAmbiguousError);
	});

	it("T7: nothing matches -> none, label public", async () => {
		mockPrisma.connection.findMany.mockResolvedValue([]);

		const gitSpawnMod = await import("../../core/harness/git-spawn.js");
		vi.mocked(gitSpawnMod.gitConfigRead).mockResolvedValue({ stdout: "", stderr: "" });

		const ref: GitRepoRef = {
			sourceKind: "url",
			url: "https://github.com/org/public-repo.git",
			connectionId: null,
			pick: null,
		};

		const preview = await service.preview(ref);
		expect(preview).toEqual({
			source: "none",
			label: "public",
			via: "none",
		});

		const cred = await service.resolveForUse(ref);
		expect(cred.display).toEqual({
			source: "none",
			label: "public",
			via: "none",
		});
	});

	it("T8: lastUsedAt written by resolveForUse and not by preview", async () => {
		const connEnc = credentialsService.encrypt({ token: "ghp_tok" });
		const configEnc = credentialsService.encrypt({ host: "github.com" });
		const conn = {
			id: "conn-track-use",
			label: "Token Tracking",
			status: "ACTIVE",
			tokenExpiresAt: null,
			lastErrorMessage: null,
			credentialsEnc: connEnc,
			connectionConfigEnc: configEnc,
			integration: {
				templateId: "git-host-token",
				label: "Git host token",
			},
		};
		mockPrisma.connection.findMany.mockResolvedValue([conn]);

		const gitSpawnMod = await import("../../core/harness/git-spawn.js");
		vi.mocked(gitSpawnMod.gitConfigRead).mockResolvedValue({ stdout: "", stderr: "" });

		const ref: GitRepoRef = {
			sourceKind: "url",
			url: "https://github.com/org/repo.git",
			connectionId: null,
			pick: null,
		};

		await service.preview(ref);
		expect(mockPrisma.connection.update).not.toHaveBeenCalled();

		await service.resolveForUse(ref);
		expect(mockPrisma.connection.update).toHaveBeenCalledWith({
			where: { id: "conn-track-use" },
			data: { lastUsedAt: expect.any(Date) },
		});
	});

	it("T8b: apiKey + baseUrl: https://ghe.corp/api/v3 on a github-token row matches ghe.corp and not github.com", async () => {
		const connEnc = credentialsService.encrypt({
			apiKey: "ghe_token",
			baseUrl: "https://ghe.corp/api/v3",
		});
		const conn = {
			id: "conn-ghes",
			label: "GHES Token",
			status: "ACTIVE",
			tokenExpiresAt: null,
			lastErrorMessage: null,
			credentialsEnc: connEnc,
			connectionConfigEnc: null,
			integration: {
				templateId: "github-token",
				label: "GitHub Personal Access Token",
			},
		};
		mockPrisma.connection.findMany.mockResolvedValue([conn]);

		const gitSpawnMod = await import("../../core/harness/git-spawn.js");
		vi.mocked(gitSpawnMod.gitConfigRead).mockResolvedValue({ stdout: "", stderr: "" });

		// Should NOT match github.com
		const refPublic: GitRepoRef = {
			sourceKind: "url",
			url: "https://github.com/org/repo.git",
			connectionId: null,
			pick: null,
		};
		const previewPublic = await service.preview(refPublic);
		expect(previewPublic.source).toBe("none");
		expect(previewPublic.label).toBe("public");

		// SHOULD match ghe.corp
		const refGhes: GitRepoRef = {
			sourceKind: "url",
			url: "https://ghe.corp/org/repo.git",
			connectionId: null,
			pick: null,
		};
		const previewGhes = await service.preview(refGhes);
		expect(previewGhes.source).toBe("connection");
		expect(previewGhes.label).toBe("token GHES Token");
		expect(previewGhes.connectionId).toBe("conn-ghes");
	});

	it("T8c: fingerprint is HMAC with vault key and serialization never reveals token", async () => {
		const token = "super_secret_pat_value_12345";
		const host = "github.com";

		const vault1 = credentialsService.getVault();
		const fp1 = vault1.hmacHex(`${host}:${token}`).slice(0, 8);

		const otherConfig = {
			get: vi.fn().mockReturnValue("fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210"),
		};
		const otherCredsService = new CredentialsService(otherConfig as any);
		const fp2 = otherCredsService.getVault().hmacHex(`${host}:${token}`).slice(0, 8);

		// Two vault keys produce two distinct fingerprints
		expect(fp1).not.toBe(fp2);
		expect(fp1).toHaveLength(8);

		const display = {
			source: "connection" as const,
			label: "token MyPAT",
			via: "git-host-token, fp " + fp1,
			connectionId: "conn-123",
			fingerprint: fp1,
		};
		const cred = new GitCredential(display, token, { host, effectiveUrl: `https://${host}/org/repo` });

		// Check serialization safety
		const str = JSON.stringify(cred);
		expect(str).not.toContain(token);
		expect(str).toContain(fp1);

		const inspected = util.inspect(cred);
		expect(inspected).not.toContain(token);
		expect(inspected).toContain(fp1);

		const spread = { ...cred };
		expect(JSON.stringify(spread)).not.toContain(token);

		const clonedDisplay = structuredClone(cred.display);
		expect(JSON.stringify(clonedDisplay)).not.toContain(token);

		// Auth header contains the basic auth with token
		const header = cred.authHeader(`https://${host}/org/repo`);
		expect(header).toMatch(/^Authorization: Basic /);
	});

	describe("fallback and withCredential", () => {
		it("retries with single matching token when machine git is refused", async () => {
			const connEnc = credentialsService.encrypt({ token: "ghp_retry" });
			const configEnc = credentialsService.encrypt({ host: "github.com" });
			const conn = {
				id: "conn-single",
				label: "Single Token",
				status: "ACTIVE",
				tokenExpiresAt: null,
				lastErrorMessage: null,
				credentialsEnc: connEnc,
				connectionConfigEnc: configEnc,
				integration: { templateId: "git-host-token", label: "Git host token" },
			};
			mockPrisma.connection.findMany.mockResolvedValue([conn]);

			const gitSpawnMod = await import("../../core/harness/git-spawn.js");
			vi.mocked(gitSpawnMod.gitConfigRead).mockImplementation(async (args: string[]) => {
				if (args.includes("credential.helper")) return { stdout: "gh", stderr: "" };
				return { stdout: "", stderr: "" };
			});
			vi.mocked(gitSpawnMod.spawnGit).mockImplementation(async (_args: string[], opts: any) => {
				if (opts?.onStdoutLine) {
					opts.onStdoutLine("username=octocat");
					opts.onStdoutLine("password=pass");
				}
				return { stdout: "", stderr: "" };
			});

			const ref: GitRepoRef = {
				sourceKind: "url",
				url: "https://github.com/org/repo.git",
				connectionId: null,
				pick: null,
			};

			let attempts = 0;
			const fn = async (c: GitCredential) => {
				attempts++;
				if (attempts === 1) {
					expect(c.display.source).toBe("machine");
					throw new GitFailure("machine-rejected", "Authentication failed for https://github.com/org/repo.git");
				}
				expect(c.display.source).toBe("connection");
				expect(c.display.fallback).toBe(true);
				return "success";
			};

			const res = await service.withCredential(ref, fn);
			expect(res.result).toBe("success");
			expect(res.credential.source).toBe("connection");
			expect(res.credential.fallback).toBe(true);
			expect(attempts).toBe(2);
		});

		it("withCredential throws pick-credential error if more than one saved token matches on failure", async () => {
			const conn1Enc = credentialsService.encrypt({ token: "tok1" });
			const conn2Enc = credentialsService.encrypt({ token: "tok2" });
			const configEnc = credentialsService.encrypt({ host: "github.com" });
			mockPrisma.connection.findMany.mockResolvedValue([
				{
					id: "conn-1",
					label: "Token 1",
					status: "ACTIVE",
					tokenExpiresAt: null,
					lastErrorMessage: null,
					credentialsEnc: conn1Enc,
					connectionConfigEnc: configEnc,
					integration: { templateId: "git-host-token", label: "Git host token" },
				},
				{
					id: "conn-2",
					label: "Token 2",
					status: "ACTIVE",
					tokenExpiresAt: null,
					lastErrorMessage: null,
					credentialsEnc: conn2Enc,
					connectionConfigEnc: configEnc,
					integration: { templateId: "git-host-token", label: "Git host token" },
				},
			]);

			const gitSpawnMod = await import("../../core/harness/git-spawn.js");
			vi.mocked(gitSpawnMod.gitConfigRead).mockImplementation(async (args: string[]) => {
				if (args.includes("credential.helper")) return { stdout: "gh", stderr: "" };
				return { stdout: "", stderr: "" };
			});
			vi.mocked(gitSpawnMod.spawnGit).mockImplementation(async (_args: string[], opts: any) => {
				if (opts?.onStdoutLine) {
					opts.onStdoutLine("username=octocat");
					opts.onStdoutLine("password=pass");
				}
				return { stdout: "", stderr: "" };
			});

			const ref: GitRepoRef = {
				sourceKind: "url",
				url: "https://github.com/org/repo.git",
				connectionId: null,
				pick: null,
			};

			await expect(
				service.withCredential(ref, async () => {
					throw new GitFailure("machine-rejected", "Authentication failed");
				}),
			).rejects.toMatchObject({
				code: "machine-rejected",
				action: "pick-credential",
			});
		});

		it("does not retry fallback on SSH machine failures", async () => {
			const ref: GitRepoRef = {
				sourceKind: "url",
				url: "git@github.com:org/repo.git",
				connectionId: null,
				pick: null,
			};

			let attempts = 0;
			await expect(
				service.withCredential(ref, async () => {
					attempts++;
					throw new GitFailure("machine-rejected", "Permission denied (publickey)");
				}),
			).rejects.toThrowError(GitFailure);

			expect(attempts).toBe(1);
		});

		it("records failure when fn throws GitFailure with token-rejected on a connection source", async () => {
			const connEnc = credentialsService.encrypt({ token: "ghp_fail" });
			const configEnc = credentialsService.encrypt({ host: "github.com" });
			mockPrisma.connection.findMany.mockResolvedValue([
				{
					id: "conn-fail",
					label: "Fail Token",
					status: "ACTIVE",
					tokenExpiresAt: null,
					lastErrorMessage: null,
					credentialsEnc: connEnc,
					connectionConfigEnc: configEnc,
					integration: { templateId: "git-host-token", label: "Git host token" },
				},
			]);

			const gitSpawnMod = await import("../../core/harness/git-spawn.js");
			vi.mocked(gitSpawnMod.gitConfigRead).mockResolvedValue({ stdout: "", stderr: "" });

			const ref: GitRepoRef = {
				sourceKind: "url",
				url: "https://github.com/org/repo.git",
				connectionId: null,
				pick: null,
			};

			await expect(
				service.withCredential(ref, async () => {
					throw new GitFailure("token-rejected", "Authentication failed for token");
				}),
			).rejects.toThrowError(GitFailure);

			expect(mockIntegrations.recordGitFailure).toHaveBeenCalledWith(
				"conn-fail",
				expect.objectContaining({ code: "token-rejected" }),
			);
		});

		it("records failure when retry fallback attempt fails with token-rejected", async () => {
			const connEnc = credentialsService.encrypt({ token: "ghp_retry_fail" });
			const configEnc = credentialsService.encrypt({ host: "github.com" });
			mockPrisma.connection.findMany.mockResolvedValue([
				{
					id: "conn-retry-fail",
					label: "Retry Fail Token",
					status: "ACTIVE",
					tokenExpiresAt: null,
					lastErrorMessage: null,
					credentialsEnc: connEnc,
					connectionConfigEnc: configEnc,
					integration: { templateId: "git-host-token", label: "Git host token" },
				},
			]);

			const gitSpawnMod = await import("../../core/harness/git-spawn.js");
			vi.mocked(gitSpawnMod.gitConfigRead).mockImplementation(async (args: string[]) => {
				if (args.includes("credential.helper")) return { stdout: "gh", stderr: "" };
				return { stdout: "", stderr: "" };
			});
			vi.mocked(gitSpawnMod.spawnGit).mockImplementation(async (_args: string[], opts: any) => {
				if (opts?.onStdoutLine) {
					opts.onStdoutLine("username=octocat");
					opts.onStdoutLine("password=pass");
				}
				return { stdout: "", stderr: "" };
			});

			const ref: GitRepoRef = {
				sourceKind: "url",
				url: "https://github.com/org/repo.git",
				connectionId: null,
				pick: null,
			};

			let attempts = 0;
			await expect(
				service.withCredential(ref, async () => {
					attempts++;
					if (attempts === 1) {
						throw new GitFailure("machine-rejected", "Authentication failed");
					}
					throw new GitFailure("token-rejected", "Token also rejected");
				}),
			).rejects.toThrowError(GitFailure);

			expect(mockIntegrations.recordGitFailure).toHaveBeenCalledWith(
				"conn-retry-fail",
				expect.objectContaining({ code: "token-rejected" }),
			);
		});
	});

	describe("candidates and tokenFor", () => {
		it("candidates returns matching tokens for host", async () => {
			const connEnc = credentialsService.encrypt({ token: "t1" });
			const configEnc = credentialsService.encrypt({ host: "github.com" });
			mockPrisma.connection.findMany.mockResolvedValue([
				{
					id: "c-1",
					label: "T1",
					status: "ACTIVE",
					tokenExpiresAt: null,
					lastErrorMessage: null,
					credentialsEnc: connEnc,
					connectionConfigEnc: configEnc,
					integration: { templateId: "git-host-token", label: "Git host token" },
				},
			]);

			const cands = await service.candidates("https://github.com/org/repo.git");
			expect(cands).toHaveLength(1);
			expect(cands[0].connectionId).toBe("c-1");

			const empty = await service.candidates("https://gitlab.com/org/repo.git");
			expect(empty).toHaveLength(0);
		});

		it("tokenFor returns HostToken when connectionId matches host", async () => {
			const connEnc = credentialsService.encrypt({ token: "t1" });
			const configEnc = credentialsService.encrypt({ host: "github.com" });
			mockPrisma.connection.findMany.mockResolvedValue([
				{
					id: "c-1",
					label: "T1",
					status: "ACTIVE",
					tokenExpiresAt: null,
					lastErrorMessage: null,
					credentialsEnc: connEnc,
					connectionConfigEnc: configEnc,
					integration: { templateId: "git-host-token", label: "Git host token" },
				},
			]);

			const tok = await service.tokenFor("https://github.com/org/repo.git", "c-1");
			expect(tok).not.toBeNull();
			expect(tok?.token).toBe("t1");

			const wrongHost = await service.tokenFor("https://gitlab.com/org/repo.git", "c-1");
			expect(wrongHost).toBeNull();
		});
	});

	describe("legacy link preview", () => {
		it("surfaces legacy-link problem when repository was linked to a removed github-app connection", async () => {
			mockPrisma.connection.findMany.mockResolvedValue([]);
			mockPrisma.connection.findUnique.mockResolvedValue({
				integration: { templateId: "github-app" },
			});

			const gitSpawnMod = await import("../../core/harness/git-spawn.js");
			vi.mocked(gitSpawnMod.gitConfigRead).mockResolvedValue({ stdout: "", stderr: "" });

			const ref: GitRepoRef = {
				sourceKind: "url",
				url: "https://github.com/org/repo.git",
				connectionId: "conn-legacy-app",
				pick: null,
			};

			const preview = await service.preview(ref);
			expect(preview.problem?.code).toBe("legacy-link");
			expect(preview.problem?.message).toContain("This repository was linked to a removed GitHub App connection");
		});
	});

	describe("host-token unit coverage", () => {
		it("isGitHostTemplate identifies gitHost templates", () => {
			expect(isGitHostTemplate("git-host-token")).toBe(true);
			expect(isGitHostTemplate("github-token")).toBe(true);
			expect(isGitHostTemplate("prometheus")).toBe(false);
			expect(isGitHostTemplate("unknown-template")).toBe(false);
		});

		it("pickOf extracts credentialConnectionId from object, stringified JSON, or null", () => {
			expect(pickOf({ credentialConnectionId: "c-pick" })).toBe("c-pick");
			expect(pickOf(JSON.stringify({ credentialConnectionId: "c-json" }))).toBe("c-json");
			expect(pickOf("invalid-json")).toBeNull();
			expect(pickOf(null)).toBeNull();
			expect(pickOf({})).toBeNull();
			expect(pickOf({ credentialConnectionId: "" })).toBeNull();
		});

		it("readHostToken returns null when template is not gitHost or decryption fails", () => {
			const badTemplateConn: any = {
				id: "c-bad",
				integration: { templateId: "prometheus" },
			};
			expect(readHostToken(badTemplateConn, credentialsService)).toBeNull();

			const decryptFailConn: any = {
				id: "c-fail",
				integration: { templateId: "git-host-token" },
				credentialsEnc: Buffer.from("invalid-encrypted-data"),
			};
			expect(readHostToken(decryptFailConn, credentialsService)).toBeNull();
		});

		it("readHostToken handles github-token baseUrl fallback and missing host/token", () => {
			const noHostConn: any = {
				id: "c-nohost",
				integration: { templateId: "git-host-token", label: "No Host" },
				credentialsEnc: credentialsService.encrypt({ token: "tok" }),
				connectionConfigEnc: credentialsService.encrypt({ host: "" }),
				status: "ACTIVE",
			};
			expect(readHostToken(noHostConn, credentialsService)).toBeNull();

			const noTokenConn: any = {
				id: "c-notok",
				integration: { templateId: "git-host-token", label: "No Tok" },
				credentialsEnc: credentialsService.encrypt({}),
				connectionConfigEnc: credentialsService.encrypt({ host: "github.com" }),
				status: "ACTIVE",
			};
			expect(readHostToken(noTokenConn, credentialsService)).toBeNull();

			// github-token reading baseUrl from config instead of creds
			const configBaseUrlConn: any = {
				id: "c-config-base",
				label: "",
				integration: { templateId: "github-token", label: "Integration Label Fallback" },
				credentialsEnc: credentialsService.encrypt({ apiKey: "secret" }),
				connectionConfigEnc: credentialsService.encrypt({ baseUrl: "https://ghe-config.corp/api/v3" }),
				status: "ACTIVE",
			};
			const res = readHostToken(configBaseUrlConn, credentialsService);
			expect(res).not.toBeNull();
			expect(res?.host).toBe("ghe-config.corp");
			expect(res?.label).toBe("Integration Label Fallback");
		});
	});
});
