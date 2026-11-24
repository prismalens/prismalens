// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Intake's one service lookup: a name (serviceName or the `service` label) to a
 * service, else to a project whose service is made on first use; an unnamed
 * alert goes to the workspace's only project.
 */
import { Test, type TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { AlertMappingService } from "./alert-mapping.service.js";

const mockPrisma = {
	$transaction: vi.fn(),
	service: { findUnique: vi.fn(), create: vi.fn(), count: vi.fn() },
	repository: { findMany: vi.fn() },
	serviceRepository: { findFirst: vi.fn(), create: vi.fn(), count: vi.fn() },
};

const project = (id: string, fullName: string) => ({
	id,
	fullName,
	subPath: null,
	plain: false,
});

describe("AlertMappingService.resolveServiceForAlert", () => {
	let service: AlertMappingService;

	beforeEach(async () => {
		vi.resetAllMocks();
		mockPrisma.$transaction.mockImplementation((run: (tx: unknown) => unknown) => run(mockPrisma));
		mockPrisma.service.findUnique.mockResolvedValue(null);
		mockPrisma.service.count.mockResolvedValue(0);
		mockPrisma.repository.findMany.mockResolvedValue([]);
		mockPrisma.serviceRepository.findFirst.mockResolvedValue(null);
		mockPrisma.serviceRepository.count.mockResolvedValue(0);

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				AlertMappingService,
				{ provide: PrismaService, useValue: mockPrisma },
			],
		}).compile();

		service = module.get<AlertMappingService>(AlertMappingService);
	});

	it("returns null when the alert names nothing and the workspace has no project", async () => {
		const result = await service.resolveServiceForAlert({ title: "No label" });

		expect(result).toBeNull();
		expect(mockPrisma.service.findUnique).not.toHaveBeenCalled();
		expect(mockPrisma.service.create).not.toHaveBeenCalled();
	});

	it("returns the service on an exact service label match", async () => {
		const checkout = { id: "svc-1", name: "checkout" };
		mockPrisma.service.findUnique.mockResolvedValue(checkout);

		const result = await service.resolveServiceForAlert({
			title: "High CPU",
			labels: { service: "checkout" },
		});

		expect(result).toBe(checkout);
		expect(mockPrisma.service.findUnique).toHaveBeenCalledWith({
			where: { name: "checkout" },
		});
	});

	it("returns the service named by serviceName when the alert has no label", async () => {
		const checkout = { id: "svc-1", name: "checkout" };
		mockPrisma.service.findUnique.mockResolvedValue(checkout);

		const result = await service.resolveServiceForAlert({
			title: "High CPU",
			serviceName: "checkout",
		});

		expect(result).toBe(checkout);
		expect(mockPrisma.service.findUnique).toHaveBeenCalledWith({
			where: { name: "checkout" },
		});
	});

	it("falls to the label when serviceName names no service or project", async () => {
		const checkout = { id: "svc-1", name: "checkout" };
		mockPrisma.service.findUnique.mockImplementation(
			async ({ where }: { where: { name: string } }) =>
				where.name === "checkout" ? checkout : null,
		);

		const result = await service.resolveServiceForAlert({
			title: "High CPU",
			serviceName: "typo",
			labels: { service: "checkout" },
		});

		expect(result).toBe(checkout);
	});

	it("does not fall back to a contains match: 'checkout-legacy' must not resolve to 'checkout'", async () => {
		mockPrisma.service.findUnique.mockImplementation(
			async ({ where }: { where: { name: string } }) =>
				where.name === "checkout" ? { id: "svc-1", name: "checkout" } : null,
		);
		const result = await service.resolveServiceForAlert({
			title: "High CPU",
			labels: { service: "checkout-legacy" },
		});

		expect(result).toBeNull();
		expect(mockPrisma.service.findUnique).toHaveBeenCalledWith({
			where: { name: "checkout-legacy" },
		});
		expect(mockPrisma.service.findUnique).not.toHaveBeenCalledWith({
			where: { name: "checkout" },
		});
	});

	it("makes and links a service for a project the alert's label names", async () => {
		const made = { id: "svc-new", name: "demo-proj" };
		mockPrisma.repository.findMany.mockResolvedValue([
			project("repo-1", "demo-proj"),
			project("repo-2", "other"),
		]);
		mockPrisma.service.create.mockResolvedValue(made);

		const result = await service.resolveServiceForAlert({
			title: "Boom",
			labels: { service: "demo-proj" },
		});

		expect(result).toBe(made);
		expect(mockPrisma.service.create).toHaveBeenCalledWith({
			data: { name: "demo-proj" },
		});
		expect(mockPrisma.serviceRepository.create).toHaveBeenCalledWith({
			data: {
				serviceId: "svc-new",
				repositoryId: "repo-1",
				subPath: null,
				isPrimary: true,
			},
		});
	});

	it("matches a project by its last path segment, ignoring case", async () => {
		const made = { id: "svc-new", name: "api" };
		mockPrisma.repository.findMany.mockResolvedValue([
			project("repo-1", "acme/api"),
		]);
		mockPrisma.service.create.mockResolvedValue(made);

		const result = await service.resolveServiceForAlert({
			title: "Boom",
			serviceName: "API",
		});

		expect(result).toBe(made);
		expect(mockPrisma.service.create).toHaveBeenCalledWith({
			data: { name: "api" },
		});
	});

	it("returns the project's existing service without making another", async () => {
		const existing = { id: "svc-1", name: "shop" };
		mockPrisma.repository.findMany.mockResolvedValue([
			project("repo-1", "shop-repo"),
		]);
		mockPrisma.serviceRepository.findFirst.mockResolvedValue({
			service: existing,
		});

		const result = await service.resolveServiceForAlert({
			title: "Boom",
			labels: { service: "shop-repo" },
		});

		expect(result).toBe(existing);
		expect(mockPrisma.service.create).not.toHaveBeenCalled();
		expect(mockPrisma.serviceRepository.create).not.toHaveBeenCalled();
	});

	it("routes neither of two projects that share a folder name", async () => {
		mockPrisma.repository.findMany.mockResolvedValue([
			project("repo-1", "a/api"),
			project("repo-2", "b/api"),
		]);

		const result = await service.resolveServiceForAlert({
			title: "Boom",
			labels: { service: "api" },
		});

		expect(result).toBeNull();
		expect(mockPrisma.service.create).not.toHaveBeenCalled();
	});

	it("sends an unnamed alert to the workspace's only project", async () => {
		const made = { id: "svc-new", name: "demo-proj" };
		mockPrisma.repository.findMany.mockResolvedValue([
			project("repo-1", "demo-proj"),
		]);
		mockPrisma.service.create.mockResolvedValue(made);

		const result = await service.resolveServiceForAlert({ title: "Boom" });

		expect(result).toBe(made);
		expect(mockPrisma.repository.findMany).toHaveBeenCalledWith({
			where: { plain: false },
			take: 2,
			orderBy: { createdAt: "asc" },
		});
	});

	it("leaves an unnamed alert unrouted when the workspace has two projects", async () => {
		mockPrisma.repository.findMany.mockResolvedValue([
			project("repo-1", "one"),
			project("repo-2", "two"),
		]);

		const result = await service.resolveServiceForAlert({ title: "Boom" });

		expect(result).toBeNull();
		expect(mockPrisma.service.create).not.toHaveBeenCalled();
	});

	it("leaves an unnamed alert unrouted when its only project is not the workspace's service", async () => {
		mockPrisma.repository.findMany.mockResolvedValue([
			project("repo-1", "demo-proj"),
		]);
		mockPrisma.service.count.mockResolvedValue(1);
		mockPrisma.serviceRepository.count.mockResolvedValue(0);

		const result = await service.resolveServiceForAlert({ title: "Boom" });

		expect(result).toBeNull();
		expect(mockPrisma.service.create).not.toHaveBeenCalled();
	});

	it("finds a stored service name that carries spaces by the name as sent", async () => {
		const spaced = { id: "svc-1", name: " checkout " };
		mockPrisma.service.findUnique.mockImplementation(
			async ({ where }: { where: { name: string } }) =>
				where.name === " checkout " ? spaced : null,
		);

		const result = await service.resolveServiceForAlert({
			title: "High CPU",
			labels: { service: " checkout " },
		});

		expect(result).toBe(spaced);
	});

	it("looks the project up by the trimmed name", async () => {
		const made = { id: "svc-new", name: "demo-proj" };
		mockPrisma.repository.findMany.mockResolvedValue([
			project("repo-1", "demo-proj"),
		]);
		mockPrisma.service.create.mockResolvedValue(made);

		const result = await service.resolveServiceForAlert({
			title: "Boom",
			serviceName: "  demo-proj ",
		});

		expect(result).toBe(made);
	});

	it("gives a project whose folder name another service holds a name of its own, and links only that project", async () => {
		const taken = { id: "svc-a", name: "api" };
		const made = { id: "svc-b", name: "team-b/api" };
		mockPrisma.repository.findMany.mockResolvedValue([
			project("repo-b", "team-b/api"),
		]);
		mockPrisma.service.findUnique.mockImplementation(
			async ({ where }: { where: { name: string } }) =>
				where.name === "api" ? taken : null,
		);
		mockPrisma.service.create.mockResolvedValue(made);

		const result = await service.resolveServiceForAlert({
			title: "Boom",
			labels: { service: "team-b/api" },
		});

		expect(result).toBe(made);
		expect(mockPrisma.service.create).toHaveBeenCalledWith({
			data: { name: "team-b/api" },
		});
		expect(mockPrisma.serviceRepository.create).toHaveBeenCalledWith({
			data: {
				serviceId: "svc-b",
				repositoryId: "repo-b",
				subPath: null,
				isPrimary: true,
			},
		});
	});

	it("takes the service a concurrent first alert linked when its own create loses a unique key", async () => {
		const winner = { id: "svc-w", name: "demo-proj" };
		mockPrisma.repository.findMany.mockResolvedValue([
			project("repo-1", "demo-proj"),
		]);
		mockPrisma.service.create.mockRejectedValueOnce(
			Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
		);
		mockPrisma.serviceRepository.findFirst
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ service: winner });

		const result = await service.resolveServiceForAlert({
			title: "Boom",
			serviceName: "demo-proj",
		});

		expect(result).toBe(winner);
		expect(mockPrisma.service.create).toHaveBeenCalledTimes(1);
		expect(mockPrisma.serviceRepository.create).not.toHaveBeenCalled();
	});

	it("rethrows an error that is not a lost unique key", async () => {
		mockPrisma.repository.findMany.mockResolvedValue([
			project("repo-1", "demo-proj"),
		]);
		mockPrisma.service.create.mockRejectedValueOnce(new Error("disk full"));

		await expect(
			service.resolveServiceForAlert({ title: "Boom", serviceName: "demo-proj" }),
		).rejects.toThrow("disk full");
	});
});
