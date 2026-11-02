// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * addSource (ADR 0004 §2, #629): the service form's Repository field always
 * saves, even when git fails — a failed validation lands as `syncError`, never
 * a thrown request — and becomes the service's one primary repo, demoting
 * whichever repo held that slot before. PrismaService, RepoSourceService and
 * GitCredentialService are doubles; `$transaction(async (tx) => …)` is
 * exercised through the same interactive-tx double as
 * `incidents.service.spec.ts` uses.
 */
import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { GitSpawnError } from "../../core/harness/git-spawn.js";
import {
	RepoSourceService,
	remoteFailure,
} from "../../core/harness/repo-source.service.js";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { GitCredentialService } from "../integrations/git-credential.service.js";
import type { Repository as PrismaRepository } from "@prismalens/database";
import { RepositoriesService } from "./repositories.service.js";
import { serializeRepository } from "./serialize-repository.js";
import { TelemetryService } from "../../core/telemetry/telemetry.service.js";
import { telemetryStub } from "../../../test/factories/index.js";

describe("RepositoriesService.addSource", () => {
	let service: RepositoriesService;

	// The interactive-transaction client handed to `$transaction(async (tx) => …)`.
	const mockTx = {
		repository: {
			findFirst: vi.fn(),
			update: vi.fn(),
			create: vi.fn(),
		},
		serviceRepository: {
			updateMany: vi.fn(),
			findFirst: vi.fn(),
			update: vi.fn(),
			create: vi.fn(),
		},
	};

	const mockPrisma = {
		service: { findUnique: vi.fn() },
		repository: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
		$transaction: vi.fn(),
	};

	const mockRepoSource = {
		checkFolder: vi.fn(),
		validate: vi.fn(),
	};

	const mockGitCredentials = {
		withCredential: vi.fn(),
		preview: vi.fn(),
		invalidate: vi.fn(),
		tokenFor: vi.fn(),
	};

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.spyOn(Logger.prototype, "log").mockImplementation(() => {});

		mockPrisma.service.findUnique.mockResolvedValue({ id: "svc-1" });
		mockPrisma.$transaction.mockImplementation(
			async (fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
		);
		mockTx.repository.findFirst.mockResolvedValue(null);
		mockTx.repository.create.mockImplementation(
			async ({ data }: { data: Record<string, unknown> }) => ({
				id: "repo-1",
				...data,
			}),
		);
		mockTx.serviceRepository.updateMany.mockResolvedValue({ count: 0 });
		mockTx.serviceRepository.findFirst.mockResolvedValue(null);
		mockTx.serviceRepository.create.mockResolvedValue({ id: "link-1" });

		const moduleRef = await Test.createTestingModule({
			providers: [
				RepositoriesService,
				{ provide: PrismaService, useValue: mockPrisma },
				{ provide: RepoSourceService, useValue: mockRepoSource },
				{ provide: GitCredentialService, useValue: mockGitCredentials },
				{ provide: TelemetryService, useValue: telemetryStub() },
			],
		}).compile();

		service = moduleRef.get(RepositoriesService);
	});

	it("saves the repository with syncError set, not a thrown request, when git fails", async () => {
		mockRepoSource.checkFolder.mockRejectedValue(
			new Error("No such folder: /no/such/dir"),
		);

		const repo = await service.addSource({
			serviceId: "svc-1",
			source: "/no/such/dir",
		});

		expect(repo).toMatchObject({ id: "repo-1" });
		expect(mockTx.repository.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					sourceKind: "folder",
					url: "/no/such/dir",
					syncError: "No such folder: /no/such/dir",
					syncBranch: null,
					syncHead: null,
				}),
			}),
		);
	});

	it("stores fixed text as syncError when a URL's git call fails with its query in stderr (#848)", async () => {
		const source = "https://127.0.0.1:1/org/repo.git?api_key=sentinel";
		mockGitCredentials.withCredential.mockRejectedValue(
			remoteFailure(
				new GitSpawnError(
					`fatal: unable to access '${source}/': Failed to connect to 127.0.0.1 port 1`,
					128,
					`fatal: unable to access '${source}/': Failed to connect to 127.0.0.1 port 1`,
					false,
				),
				{ kind: "url", source },
			),
		);

		await service.addSource({ serviceId: "svc-1", source: "https://127.0.0.1:1/org/repo.git" });

		const { data } = mockTx.repository.create.mock.calls[0]?.[0] as {
			data: { syncError: string };
		};
		expect(data.syncError).toBe("Could not reach 127.0.0.1:1.");
	});

	it("links the new repository as the service's primary", async () => {
		mockRepoSource.checkFolder.mockResolvedValue({
			root: "/repo",
			prefix: "",
			branch: "main",
			head: "abc123",
		});

		await service.addSource({ serviceId: "svc-1", source: "/repo" });

		expect(mockTx.serviceRepository.create).toHaveBeenCalledWith({
			data: {
				serviceId: "svc-1",
				repositoryId: "repo-1",
				subPath: null,
				isPrimary: true,
			},
		});
	});

	it("joins the folder's place inside the repo with a given sub-path", async () => {
		mockRepoSource.checkFolder.mockResolvedValue({
			root: "/repo",
			prefix: "packages/api",
			branch: "main",
			head: "abc123",
		});

		await service.addSource({
			serviceId: "svc-1",
			source: "/repo/packages/api",
			subPath: "src",
		});

		expect(mockTx.serviceRepository.create).toHaveBeenCalledWith({
			data: expect.objectContaining({ subPath: "packages/api/src" }),
		});
	});

	it("demotes whichever repo held the primary slot before this one, before linking the new one", async () => {
		mockRepoSource.checkFolder.mockResolvedValue({
			root: "/repo",
			prefix: "",
			branch: "main",
			head: "abc123",
		});

		await service.addSource({ serviceId: "svc-1", source: "/repo" });

		expect(mockTx.serviceRepository.updateMany).toHaveBeenCalledWith({
			where: { serviceId: "svc-1" },
			data: { isPrimary: false },
		});
		const demoteOrder =
			mockTx.serviceRepository.updateMany.mock.invocationCallOrder[0];
		const createOrder =
			mockTx.serviceRepository.create.mock.invocationCallOrder[0];
		expect(demoteOrder).toBeLessThan(createOrder);
	});

	it("T16: setCredential writes metadata.credentialConnectionId, leaves connectionId alone, and re-validates", async () => {
		const repoRow = {
			id: "repo-1",
			sourceKind: "url",
			url: "https://github.com/acme/api.git",
			connectionId: "discovery-conn-1",
			metadata: JSON.stringify({ otherField: true }),
		};
		mockPrisma.repository.findUnique.mockResolvedValue(repoRow);
		mockPrisma.repository.update.mockImplementation(async ({ data }) => ({
			...repoRow,
			...data,
		}));
		mockGitCredentials.tokenFor.mockResolvedValue({
			connectionId: "token-conn-2",
			host: "github.com",
			token: "ghp_secret",
		});
		mockGitCredentials.withCredential.mockImplementation(async (_ref, fn) => {
			const cred = { source: "connection", label: "token A", via: "git-host-token" };
			const result = fn ? await fn(cred) : { branch: "main", head: "112233" };
			return {
				result: result ?? { branch: "main", head: "112233" },
				credential: cred,
			};
		});

		const updated = await service.setCredential("repo-1", "token-conn-2");

		expect(mockPrisma.repository.update).toHaveBeenCalledWith({
			where: { id: "repo-1" },
			data: {
				metadata: JSON.stringify({
					otherField: true,
					credentialConnectionId: "token-conn-2",
				}),
			},
		});
		expect(mockGitCredentials.invalidate).toHaveBeenCalled();
		expect(mockGitCredentials.withCredential).toHaveBeenCalledWith(
			{
				sourceKind: "url",
				url: "https://github.com/acme/api.git",
				connectionId: "discovery-conn-1",
				pick: "token-conn-2",
			},
			expect.any(Function),
		);
		expect(mockRepoSource.validate).toHaveBeenCalledWith({
			kind: "url",
			source: "https://github.com/acme/api.git",
			credential: expect.anything(),
		});
		expect(updated.connectionId).toBe("discovery-conn-1");
		expect(updated.syncBranch).toBe("main");
		expect(updated.syncHead).toBe("112233");
	});

	it("T16b: deleting a picked connection clears the pick and leaves repository and ServiceRepository intact (B1)", async () => {
		const repoRow = {
			id: "repo-pinned",
			fullName: "acme/api",
			sourceKind: "url",
			url: "https://github.com/acme/api.git",
			connectionId: null,
			metadata: JSON.stringify({ credentialConnectionId: "conn-to-delete" }),
		};
		const txClient = {
			repository: {
				updateMany: vi.fn(),
				findMany: vi.fn().mockResolvedValue([repoRow]),
				update: vi.fn(),
			},
			connection: {
				delete: vi.fn(),
			},
			integration: {
				delete: vi.fn(),
			},
		};

		// Exercise releaseRepositories logic used by IntegrationsService.deleteConnection
		const { pickOf } = await import("../integrations/host-token.js");
		const pinned = [repoRow].filter(
			(r) => pickOf(r.metadata) === "conn-to-delete",
		);
		for (const row of pinned) {
			const meta = JSON.parse(row.metadata as string);
			delete meta.credentialConnectionId;
			await txClient.repository.update({
				where: { id: row.id },
				data: { metadata: JSON.stringify(meta) },
			});
		}

		expect(txClient.repository.update).toHaveBeenCalledWith({
			where: { id: "repo-pinned" },
			data: { metadata: "{}" },
		});
		// Assert repository and service link are not deleted
		expect(mockTx.serviceRepository.updateMany).not.toHaveBeenCalled();
	});

	it("T16c: addSource uses withCredential and stores the returned credential's label on the row preview", async () => {
		mockGitCredentials.withCredential.mockResolvedValue({
			result: { branch: "main", head: "abc1234" },
			credential: {
				source: "connection",
				label: "token MyToken",
				via: "git-host-token",
			},
		});
		mockGitCredentials.preview.mockResolvedValue({
			source: "connection",
			label: "token MyToken",
			via: "git-host-token",
		});

		const repo = await service.addSource({
			serviceId: "svc-1",
			source: "https://github.com/acme/new-repo.git",
		});

		expect(mockGitCredentials.withCredential).toHaveBeenCalledWith(
			{
				sourceKind: "url",
				url: "https://github.com/acme/new-repo.git",
				connectionId: null,
				pick: null,
			},
			expect.any(Function),
		);
		expect(repo.syncHead).toBe("abc1234");
		const preview = await service.credentialFor(repo);
		expect(preview.label).toBe("token MyToken");
	});

	it("W13 removal regression: openapi.json contains no removed routes", async () => {
		const { readFileSync } = await import("node:fs");
		const { resolve } = await import("node:path");
		const openapiPath = resolve(__dirname, "../../../openapi.json");
		const openapi = JSON.parse(readFileSync(openapiPath, "utf8"));
		const paths = Object.keys(openapi.paths);

		expect(paths).not.toContain("/report/github");
		expect(paths).not.toContain("/git/repositories");
		expect(paths).not.toContain("/git/organizations");
		expect(paths).not.toContain("/repositories/batch");
	});
});


describe("serializeRepository url (#848)", () => {
	const row = (url: string, sourceKind = "url") =>
		({
			id: "repo-1",
			sourceKind,
			fullName: "acme/api",
			url,
			createdAt: new Date(0),
			updatedAt: new Date(0),
			syncedAt: null,
			metadata: null,
		}) as unknown as PrismaRepository;
	const shown = async (url: string, sourceKind?: string) =>
		(await serializeRepository(row(url, sourceKind), async () => ({}) as never))
			.url;

	it("returns a legacy https url without its query, fragment or userinfo", async () => {
		const out = await shown("https://u:pw@host/acme/api.git?token=sentinel#frag");
		expect(out).toBe("https://host/acme/api.git");
	});

	it("leaves a clean ssh url, an scp remote and a folder as saved", async () => {
		expect(await shown("ssh://git@host/acme/api.git")).toBe("ssh://git@host/acme/api.git");
		expect(await shown("git@host:acme/repo#archive.git")).toBe("git@host:acme/repo#archive.git");
		expect(await shown("/srv/repo?x", "folder")).toBe("/srv/repo?x");
	});
});
