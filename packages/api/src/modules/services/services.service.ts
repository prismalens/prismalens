// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Injectable, Logger } from "@nestjs/common";
import type { Service, ServiceDependency } from "@prismalens/database";
import { Prisma } from "@prismalens/database";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import {
	IncidentStatus,
	TimelineEntryType,
	TimelineSource,
} from "../../shared/enums/index.js";
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
		await this.claimAdvisory(service);
		return service;
	}

	/** The claim never fails the save it follows. */
	private async claimAdvisory(service: Pick<Service, "id" | "name">) {
		await this.claimWaiting(service).catch((err: unknown) =>
			this.logger.warn(
				`Service ${service.name} could not claim waiting incidents: ${err}`,
			),
		);
	}

	/**
	 * The label mapping, applied late (#673 w5-10): an incident still waiting
	 * with no service, whose alerts' `service` label names this one, joins it.
	 * Resolved and merged incidents keep their history; no run starts.
	 */
	async claimWaiting(service: Pick<Service, "id" | "name">): Promise<number> {
		const incidents = await this.prisma.incident.findMany({
			where: {
				serviceId: null,
				mergedIntoId: null,
				status: { not: IncidentStatus.closed },
				alerts: {
					some: { serviceId: null, labels: { contains: service.name } },
				},
			},
			select: { id: true, alerts: { select: { id: true, labels: true } } },
		});
		let claimed = 0;
		for (const incident of incidents) {
			const named = incident.alerts.map((a) => serviceLabel(a.labels));
			if (!named.includes(service.name)) continue;
			if (named.some((n) => n !== null && n !== service.name)) continue;
			// Conditional on still waiting: a concurrent claim or correlation may have won since the read.
			const won = await this.prisma.$transaction(async (tx) => {
				const { count } = await tx.incident.updateMany({
					where: { id: incident.id, serviceId: null, mergedIntoId: null },
					data: { serviceId: service.id },
				});
				if (count !== 1) return false;
				await tx.alert.updateMany({
					where: {
						id: {
							in: incident.alerts
								.filter((_, i) => named[i] === service.name)
								.map((a) => a.id),
						},
						serviceId: null,
					},
					data: { serviceId: service.id },
				});
				await tx.timelineEntry.create({
					data: {
						incidentId: incident.id,
						type: TimelineEntryType.custom,
						title: `Moved to ${service.name}: its alert's service label names it`,
						description: `The service ${service.name} was added after this incident opened.`,
						source: TimelineSource.system,
						metadata: JSON.stringify({
							reason: "service-claimed",
							serviceId: service.id,
						}),
					},
				});
				return true;
			});
			if (won) claimed++;
		}
		if (claimed > 0)
			this.logger.log(
				`Service ${service.name} claimed ${claimed} waiting incident(s) by their alerts' service label`,
			);
		return claimed;
	}

	/**
	 * The distinct, non-empty team names the catalog actually carries, sorted
	 * (#325). The filter's options come from the data, never a hardcoded list.
	 */
	async listTeams(): Promise<string[]> {
		const rows = await this.prisma.service.findMany({
			where: { team: { not: null } },
			distinct: ["team"],
			select: { team: true },
			orderBy: { team: "asc" },
		});
		return rows
			.map((r) => r.team?.trim())
			.filter((t): t is string => Boolean(t));
	}

	/**
	 * Find service by ID with dependencies and repositories
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
	 * Find all services with repositories
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

		// SQLite has no `mode` on string filters (Prisma throws "Unknown argument");
		// its LIKE is already case-insensitive for ASCII.
		if (options?.search) {
			where.OR = [
				{ name: { contains: options.search } },
				{ displayName: { contains: options.search } },
			];
		}

		const [data, total] = await this.prisma.$transaction([
			this.prisma.service.findMany({
				where,
				include: {
					repositories: {
						include: { repository: true },
					},
					// The list says what each depends on and what uses it (study-v3 §7).
					dependencies: true,
					dependents: true,
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
			// #331 — validated before it is stored, so a path that would fail at
			// investigation time fails here instead, with a message the operator
			// can act on. `undefined` leaves an existing mapping untouched.

			const service = await this.prisma.service.update({
				where: { id },
				data: updateData,
			});

			this.logger.log(`Updated service ${id}`);
			if ("name" in dto) await this.claimAdvisory(service);
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

/** The alert's `service` label, the one the label mapping reads; null without one. */
function serviceLabel(labels: string | null): string | null {
	if (!labels) return null;
	try {
		const parsed = JSON.parse(labels) as Record<string, unknown>;
		const v = parsed.service;
		return typeof v === "string" && v ? v : null;
	} catch {
		return null;
	}
}
