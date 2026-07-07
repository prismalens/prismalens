// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Injectable, Logger } from "@nestjs/common";
import type { Service, ServiceDependency } from "@prismalens/database";
import { Prisma } from "@prismalens/database";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import {
	AddDependencyDto,
	CreateServiceDto,
	UpdateServiceDto,
} from "./dto/index.js";

export type { Service, ServiceDependency };

export type ServiceWithDependencies = Service & {
	dependencies: Array<ServiceDependency & { dependency: Service }>;
	dependents: Array<ServiceDependency & { dependent: Service }>;
};

@Injectable()
export class ServicesService {
	private readonly logger = new Logger(ServicesService.name);

	constructor(private readonly prisma: PrismaService) {}

	/**
	 * Create a new service in the catalog
	 */
	async create(dto: CreateServiceDto): Promise<Service> {
		const service = await this.prisma.service.create({
			data: {
				name: dto.name,
				displayName: dto.displayName,
				description: dto.description,
				type: dto.type ?? "service",
				tier: dto.tier ?? "tier_3",
				team: dto.team,
				slackChannel: dto.slackChannel,
				tags: dto.tags ? JSON.stringify(dto.tags) : null,
				metadata: dto.metadata ? JSON.stringify(dto.metadata) : null,
			},
		});

		this.logger.log(`Created service ${service.id}: ${service.name}`);
		return service;
	}

	/**
	 * Find service by ID with dependencies, repositories, and deployments
	 */
	async findById(id: string) {
		return this.prisma.service.findUnique({
			where: { id },
			include: {
				dependencies: {
					include: { dependency: true },
				},
				dependents: {
					include: { dependent: true },
				},
				repositories: {
					include: { repository: true },
				},
				deployments: true,
			},
		});
	}

	/**
	 * Find service by unique name
	 */
	async findByName(name: string): Promise<Service | null> {
		return this.prisma.service.findUnique({
			where: { name },
		});
	}

	/**
	 * Find all services with repositories and deployments
	 */
	async findAll(options?: {
		type?: string;
		tier?: string;
		team?: string;
		search?: string;
		limit?: number;
		offset?: number;
	}): Promise<{ data: Service[]; total: number }> {
		const where: Record<string, unknown> = {
			...(options?.type && { type: options.type }),
			...(options?.tier && { tier: options.tier }),
			...(options?.team && { team: options.team }),
		};

		if (options?.search) {
			where.OR = [
				{ name: { contains: options.search, mode: "insensitive" } },
				{ displayName: { contains: options.search, mode: "insensitive" } },
			];
		}

		const [data, total] = await this.prisma.$transaction([
			this.prisma.service.findMany({
				where,
				include: {
					repositories: {
						include: { repository: true },
					},
					deployments: true,
				},
				orderBy: [{ tier: "asc" }, { name: "asc" }],
				take: options?.limit,
				skip: options?.offset,
			}),
			this.prisma.service.count({ where }),
		]);

		return { data, total };
	}

	/**
	 * Update a service
	 */
	async update(id: string, dto: UpdateServiceDto): Promise<Service | null> {
		try {
			const updateData: Record<string, unknown> = {
				updatedAt: new Date(),
			};

			const allowedFields = [
				"name",
				"displayName",
				"description",
				"type",
				"tier",
				"team",
				"slackChannel",
			] as const;

			for (const field of allowedFields) {
				if (field in dto) {
					updateData[field] = dto[field as keyof UpdateServiceDto];
				}
			}

			if (dto.tags) {
				updateData.tags = JSON.stringify(dto.tags);
			}
			if (dto.metadata) {
				updateData.metadata = JSON.stringify(dto.metadata);
			}

			const service = await this.prisma.service.update({
				where: { id },
				data: updateData,
			});

			this.logger.log(`Updated service ${id}`);
			return service;
		} catch (error) {
			if (
				error instanceof Prisma.PrismaClientKnownRequestError &&
				error.code === "P2025"
			) {
				return null;
			}
			throw error;
		}
	}

	/**
	 * Delete a service
	 */
	async delete(id: string): Promise<boolean> {
		try {
			await this.prisma.service.delete({
				where: { id },
			});
			this.logger.log(`Deleted service ${id}`);
			return true;
		} catch (error) {
			if (
				error instanceof Prisma.PrismaClientKnownRequestError &&
				error.code === "P2025"
			) {
				return false;
			}
			throw error;
		}
	}

	/**
	 * Add a dependency between services
	 */
	async addDependency(
		serviceId: string,
		dto: AddDependencyDto,
	): Promise<ServiceDependency | null> {
		try {
			const dependency = await this.prisma.serviceDependency.create({
				data: {
					dependentId: serviceId,
					dependencyId: dto.dependencyId,
					dependencyType: dto.dependencyType ?? "runtime",
					criticality: dto.criticality ?? "required",
				},
			});

			this.logger.log(
				`Added dependency ${dto.dependencyId} to service ${serviceId}`,
			);
			return dependency;
		} catch (error) {
			if (
				error instanceof Prisma.PrismaClientKnownRequestError &&
				(error.code === "P2025" || error.code === "P2002")
			) {
				return null;
			}
			throw error;
		}
	}

	/**
	 * Update a dependency's type or criticality
	 */
	async updateDependency(
		serviceId: string,
		dependencyId: string,
		dto: { dependencyType?: string; criticality?: string },
	): Promise<ServiceDependency | null> {
		try {
			const dependency = await this.prisma.serviceDependency.update({
				where: {
					dependentId_dependencyId: {
						dependentId: serviceId,
						dependencyId,
					},
				},
				data: {
					...(dto.dependencyType && { dependencyType: dto.dependencyType }),
					...(dto.criticality && { criticality: dto.criticality }),
				},
			});

			this.logger.log(
				`Updated dependency ${dependencyId} on service ${serviceId}`,
			);
			return dependency;
		} catch (error) {
			if (
				error instanceof Prisma.PrismaClientKnownRequestError &&
				error.code === "P2025"
			) {
				return null;
			}
			throw error;
		}
	}

	/**
	 * Remove a dependency
	 */
	async removeDependency(
		serviceId: string,
		dependencyId: string,
	): Promise<boolean> {
		try {
			await this.prisma.serviceDependency.delete({
				where: {
					dependentId_dependencyId: {
						dependentId: serviceId,
						dependencyId,
					},
				},
			});
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Get service count
	 */
	async count(options?: { type?: string; tier?: string }): Promise<number> {
		return this.prisma.service.count({
			where: {
				...(options?.type && { type: options.type }),
				...(options?.tier && { tier: options.tier }),
			},
		});
	}
}
