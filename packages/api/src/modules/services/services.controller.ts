import { Controller } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import { servicesContract } from "@prismalens/contracts";
import type {
	AddDependencyDto,
	CreateServiceDto,
	UpdateServiceDto,
} from "./dto/index.js";
import { ServicesService } from "./services.service.js";

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
				const services = await this.servicesService.findAll({
					limit: input.limit,
					offset: input.offset,
				});
				return services.map((s) => this.serializeServiceWithRelations(s));
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
			delete: implement(servicesContract.delete).handler(async ({ input }) => {
				const deleted = await this.servicesService.delete(input.id);
				if (!deleted) {
					throw new ORPCError("NOT_FOUND", {
						message: `Service ${input.id} not found`,
					});
				}
			}),

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

					// Extract upstream and downstream from service dependencies
					const upstream =
						(service as any).dependencies
							?.map((d: any) => d.dependency)
							.filter(Boolean) ?? [];
					const downstream =
						(service as any).dependents
							?.map((d: any) => d.service)
							.filter(Boolean) ?? [];

					return {
						service: this.serializeServiceWithRelations(service),
						upstream: upstream.map((s: any) => this.serializeService(s)),
						downstream: downstream.map((s: any) => this.serializeService(s)),
					};
				},
			),
		};
	}

	private serializeService(service: any): any {
		return {
			...service,
			tags: service.tags ? JSON.parse(service.tags) : null,
			metadata: service.metadata ? JSON.parse(service.metadata) : null,
			discoveryMetadata: service.discoveryMetadata
				? JSON.parse(service.discoveryMetadata)
				: null,
			createdAt: service.createdAt?.toISOString(),
			updatedAt: service.updatedAt?.toISOString(),
		};
	}

	private serializeServiceWithRelations(service: any): any {
		const serialized = this.serializeService(service);

		if (service.dependencies) {
			serialized.dependencies = service.dependencies.map((d: any) =>
				this.serializeServiceDependency(d),
			);
		}

		if (service.dependents) {
			serialized.dependents = service.dependents.map((d: any) =>
				this.serializeServiceDependency(d),
			);
		}

		return serialized;
	}

	private serializeServiceDependency(dep: any): any {
		return {
			...dep,
			createdAt: dep.createdAt?.toISOString(),
		};
	}
}
