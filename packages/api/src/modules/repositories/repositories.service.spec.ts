// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * addSource (ADR 0004 §2, #629): the service form's Repository field always
 * saves, even when git fails — a failed validation lands as `syncError`, never
 * a thrown request — and becomes the service's one primary repo, demoting
 * whichever repo held that slot before. PrismaService, RepoSourceService and
 * IntegrationsService are doubles; `$transaction(async (tx) => …)` is
 * exercised through the same interactive-tx double as
 * `incidents.service.spec.ts` uses.
 */
import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { RepoSourceService } from "../../core/harness/repo-source.service.js";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { IntegrationsService } from "../integrations/integrations.service.js";
import { RepositoriesService } from "./repositories.service.js";

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
		repository: { findFirst: vi.fn() },
		$transaction: vi.fn(),
	};

	const mockRepoSource = {
		checkFolder: vi.fn(),
		validate: vi.fn(),
	};

	const mockIntegrations = {
		gitToken: vi.fn(),
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
				{ provide: IntegrationsService, useValue: mockIntegrations },
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
});
