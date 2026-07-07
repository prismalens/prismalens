// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import { servicesContract } from "@prismalens/contracts";
import type {
	Service,
	ServiceDependency,
	ServiceWithRelations,
	TopologyEdge,
} from "@prismalens/contracts/schemas";
import { requireAdmin } from "../../core/auth/index.js";
import type {
	AddDependencyDto,
	CreateServiceDto,
	UpdateServiceDto,
} from "./dto/index.js";
import {
	type Service as PrismaService,
	type ServiceDependency as PrismaServiceDependency,
	ServicesService,
	type ServiceWithDependencies,
} from "./services.service.js";

@Controller()
export class ServicesController {
	constructor(private readonly servicesService: ServicesService) {}

	@Implement(servicesContract)
	services() {
		return {
			// POST /services - Create a new service
			create: implement(servicesContract.create).handler(async ({ input }) => {
				// Check if service with same name exists
				const existing = await this.servicesService.findByName(input.name);
				if (existing) {
					throw new ORPCError("CONFLICT", {
						message: `Service with name '${input.name}' already exists`,
					});
				}

				const service = await this.servicesService.create(
					input as CreateServiceDto,
				);
				return this.serializeService(service);
			}),

			// GET /services - List all services
			list: implement(servicesContract.list).handler(async ({ input }) => {
				const { data, total } = await this.servicesService.findAll({
					type: input.type,
					tier: input.tier,
					team: input.team,
					search: input.search,
					limit: input.limit,
					offset: input.offset,
				});
				return {
					data: data.map((s) => this.serializeServiceWithRelations(s)),
					total,
				};
			}),

			// GET /services/:id - Get a single service by ID
			get: implement(servicesContract.get).handler(async ({ input }) => {
				const service = await this.servicesService.findById(input.id);
				if (!service) {
					throw new ORPCError("NOT_FOUND", {
						message: `Service ${input.id} not found`,
					});
				}
				return this.serializeServiceWithRelations(service);
			}),

			// PATCH /services/:id - Update a service
			update: implement(servicesContract.update).handler(async ({ input }) => {
				const { id, ...updateData } = input;
				const service = await this.servicesService.update(
					id,
					updateData as UpdateServiceDto,
				);
				if (!service) {
					throw new ORPCError("NOT_FOUND", {
						message: `Service ${id} not found`,
					});
				}
				return this.serializeService(service);
			}),

			// DELETE /services/:id - Delete a service
			delete: implement(servicesContract.delete).handler(
				async ({ input, context }) => {
					requireAdmin(context);
					const deleted = await this.servicesService.delete(input.id);
					if (!deleted) {
						throw new ORPCError("NOT_FOUND", {
							message: `Service ${input.id} not found`,
						});
					}
				},
			),

			// POST /services/:id/dependencies - Add a dependency
			addDependency: implement(servicesContract.addDependency).handler(
				async ({ input }) => {
					const { id, ...dependencyData } = input;

					// Verify service exists
					const service = await this.servicesService.findById(id);
					if (!service) {
						throw new ORPCError("NOT_FOUND", {
							message: `Service ${id} not found`,
						});
					}

					// Verify dependency service exists
					const dependency = await this.servicesService.findById(
						dependencyData.dependencyId,
					);
					if (!dependency) {
						throw new ORPCError("NOT_FOUND", {
							message: `Dependency service ${dependencyData.dependencyId} not found`,
						});
					}

					const result = await this.servicesService.addDependency(
						id,
						dependencyData as AddDependencyDto,
					);
					if (!result) {
						throw new ORPCError("CONFLICT", {
							message: "Dependency already exists",
						});
					}

					return this.serializeServiceDependency(result);
				},
			),

			// PATCH /services/:id/dependencies/:dependencyId - Update a dependency
			updateDependency: implement(servicesContract.updateDependency).handler(
				async ({ input }) => {
					const { id, dependencyId, ...updateData } = input;
					const result = await this.servicesService.updateDependency(
						id,
						dependencyId,
						updateData,
					);
					if (!result) {
						throw new ORPCError("NOT_FOUND", {
							message: "Dependency not found",
						});
					}
					return this.serializeServiceDependency(result);
				},
			),

			// DELETE /services/:id/dependencies/:dependencyId - Remove a dependency
			removeDependency: implement(servicesContract.removeDependency).handler(
				async ({ input }) => {
					const removed = await this.servicesService.removeDependency(
						input.id,
						input.dependencyId,
					);
					if (!removed) {
						throw new ORPCError("NOT_FOUND", {
							message: "Dependency not found",
						});
					}
				},
			),

			// GET /services/:id/topology - Get service topology
			getTopology: implement(servicesContract.getTopology).handler(
				async ({ input }) => {
					const service = await this.servicesService.findById(input.id);
					if (!service) {
						throw new ORPCError("NOT_FOUND", {
							message: `Service ${input.id} not found`,
						});
					}

					// Extract upstream and downstream from service dependencies with edge metadata
					const svc = service as ServiceWithDependencies;
					const upstream: TopologyEdge[] = (svc.dependencies ?? [])
						.filter((d) => d.dependency)
						.map((d) => ({
							service: this.serializeService(d.dependency),
							dependencyType:
								d.dependencyType as TopologyEdge["dependencyType"],
							criticality: d.criticality as TopologyEdge["criticality"],
						}));
					const downstream: TopologyEdge[] = (svc.dependents ?? [])
						.filter((d) => d.dependent)
						.map((d) => ({
							service: this.serializeService(d.dependent),
							dependencyType:
								d.dependencyType as TopologyEdge["dependencyType"],
							criticality: d.criticality as TopologyEdge["criticality"],
						}));

					return {
						service: this.serializeServiceWithRelations(service),
						upstream,
						downstream,
					};
				},
			),
		};
	}

	private serializeService(service: PrismaService): Service {
		return {
			...service,
			tags: service.tags ? JSON.parse(service.tags) : null,
			metadata: service.metadata ? JSON.parse(service.metadata) : null,
			discoveryMetadata: service.discoveryMetadata
				? JSON.parse(service.discoveryMetadata)
				: null,
			createdAt: service.createdAt.toISOString(),
			updatedAt: service.updatedAt.toISOString(),
		} as Service;
	}

	private serializeServiceWithRelations(
		service: ServiceWithDependencies | PrismaService,
	): ServiceWithRelations {
		const serialized = this.serializeService(service);

		const withDeps = service as ServiceWithDependencies;
		const withRelations = service as Record<string, unknown>;

		// Serialize nested repositories (ServiceRepository + Repository)
		const repositories = Array.isArray(withRelations.repositories)
			? (withRelations.repositories as Array<Record<string, unknown>>).map(
					(sr) => ({
						...sr,
						createdAt:
							sr.createdAt instanceof Date
								? sr.createdAt.toISOString()
								: sr.createdAt,
						repository: sr.repository
							? {
									...(sr.repository as Record<string, unknown>),
									createdAt:
										(sr.repository as Record<string, unknown>)
											.createdAt instanceof Date
											? (
													(sr.repository as Record<string, unknown>)
														.createdAt as Date
												).toISOString()
											: (sr.repository as Record<string, unknown>).createdAt,
									updatedAt:
										(sr.repository as Record<string, unknown>)
											.updatedAt instanceof Date
											? (
													(sr.repository as Record<string, unknown>)
														.updatedAt as Date
												).toISOString()
											: (sr.repository as Record<string, unknown>).updatedAt,
									metadata:
										typeof (sr.repository as Record<string, unknown>)
											.metadata === "string"
											? JSON.parse(
													(sr.repository as Record<string, unknown>)
														.metadata as string,
												)
											: (sr.repository as Record<string, unknown>).metadata,
								}
							: undefined,
					}),
				)
			: [];

		// Serialize nested deployments
		const deployments = Array.isArray(withRelations.deployments)
			? (withRelations.deployments as Array<Record<string, unknown>>).map(
					(d) => ({
						...d,
						createdAt:
							d.createdAt instanceof Date
								? d.createdAt.toISOString()
								: d.createdAt,
						updatedAt:
							d.updatedAt instanceof Date
								? d.updatedAt.toISOString()
								: d.updatedAt,
						lastDeployedAt:
							d.lastDeployedAt instanceof Date
								? d.lastDeployedAt.toISOString()
								: d.lastDeployedAt,
						metadata:
							typeof d.metadata === "string"
								? JSON.parse(d.metadata as string)
								: d.metadata,
					}),
				)
			: [];

		return {
			...serialized,
			dependencies:
				withDeps.dependencies?.map((d) => this.serializeServiceDependency(d)) ??
				[],
			dependents:
				withDeps.dependents?.map((d) => this.serializeServiceDependency(d)) ??
				[],
			repositories,
			deployments,
		} as ServiceWithRelations;
	}

	private serializeServiceDependency(
		dep: PrismaServiceDependency & {
			dependency?: PrismaService;
			dependent?: PrismaService;
		},
	): ServiceDependency {
		return {
			id: dep.id,
			dependentId: dep.dependentId,
			dependencyId: dep.dependencyId,
			dependencyType: dep.dependencyType,
			criticality: dep.criticality,
			createdAt: dep.createdAt.toISOString(),
		} as ServiceDependency;
	}
}
