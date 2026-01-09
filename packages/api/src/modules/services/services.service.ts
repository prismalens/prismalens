import { Injectable, Logger } from "@nestjs/common";
import type { Service, ServiceDependency } from "@prismalens/database";
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
				repository: dto.repository,
				tags: dto.tags ? JSON.stringify(dto.tags) : null,
				metadata: dto.metadata ? JSON.stringify(dto.metadata) : null,
			},
		});

		this.logger.log(`Created service ${service.id}: ${service.name}`);
		return service;
	}

	/**
	 * Find service by ID with dependencies
	 */
	async findById(id: string): Promise<ServiceWithDependencies | null> {
		return this.prisma.service.findUnique({
			where: { id },
			include: {
				dependencies: {
					include: { dependency: true },
				},
				dependents: {
					include: { dependent: true },
				},
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
	 * Find all services
	 */
	async findAll(options?: {
		type?: string;
		tier?: string;
		team?: string;
		limit?: number;
		offset?: number;
	}): Promise<Service[]> {
		return this.prisma.service.findMany({
			where: {
				...(options?.type && { type: options.type }),
				...(options?.tier && { tier: options.tier }),
				...(options?.team && { team: options.team }),
			},
			orderBy: [{ tier: "asc" }, { name: "asc" }],
			take: options?.limit,
			skip: options?.offset,
		});
	}

	/**
	 * Update a service
	 */
	async update(id: string, dto: UpdateServiceDto): Promise<Service | null> {
		try {
			const updateData: Record<string, unknown> = {
				...dto,
				updatedAt: new Date(),
			};

			// JSON stringify arrays/objects
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
		} catch {
			return null;
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
		} catch {
			return false;
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
		} catch {
			return null;
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
