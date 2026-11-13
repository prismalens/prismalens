// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Service catalog schemas
 */
import { z } from "zod";
import { lazySchema } from "../lazy-schema.js";
import {
	DateStringSchema,
	DependencyCriticalitySchema,
	DependencyTypeSchema,
	PaginationSchema,
	ServiceTierSchema,
	ServiceTypeSchema,
} from "./common.js";
import {
	IconSourceSchema,
	RepositorySchema,
	ServiceRepositorySchema,
} from "./repository.js";

// =============================================================================
// SERVICE SCHEMAS
// =============================================================================

export const ServiceSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		id: z.string().uuid(),
		name: z.string().min(1),
		displayName: z.string().nullable(),
		description: z.string().nullable(),
		type: ServiceTypeSchema,
		tier: ServiceTierSchema,
		team: z.string().nullable(),
		slackChannel: z.string().nullable(),
		tags: z.array(z.string()).nullable(),
		metadata: z.record(z.string(), z.unknown()).nullable(),
		createdAt: DateStringSchema,
		updatedAt: DateStringSchema,
		/** Its primary project's logo; absent means the monogram (#1024 E). */
		iconUrl: z.string().optional(),
		iconSource: IconSourceSchema.optional(),
	}),
);

/** The longest investigation notes a service keeps. */
export const SERVICE_NOTES_MAX = 4096;

/** `metadata.investigation` as the services API checks it; other keys pass as stored. */
export const ServiceInvestigationMetadataSchema = /* @__PURE__ */ lazySchema(
	() =>
		z
			.object({
				/** What the agent should know first about this service (#673). */
				notes: z.string().max(SERVICE_NOTES_MAX).optional(),
			})
			.passthrough(),
);
export type ServiceInvestigationMetadata = z.infer<
	typeof ServiceInvestigationMetadataSchema
>;

export const CreateServiceSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		name: z.string().min(1),
		displayName: z.string().optional(),
		description: z.string().optional(),
		type: ServiceTypeSchema.optional(),
		tier: ServiceTierSchema.optional(),
		team: z.string().optional(),
		slackChannel: z.string().optional(),
		tags: z.array(z.string()).optional(),
		metadata: z.record(z.string(), z.unknown()).optional(),
	}),
);

export const UpdateServiceSchema = /* @__PURE__ */ lazySchema(() =>
	CreateServiceSchema.partial(),
);

// =============================================================================
// SERVICE LIST QUERY SCHEMA
// =============================================================================

export const ServiceListQuerySchema = /* @__PURE__ */ lazySchema(() =>
	PaginationSchema.extend({
		type: ServiceTypeSchema.optional(),
		tier: ServiceTierSchema.optional(),
		team: z.string().optional(),
		search: z.string().optional(),
	}),
);

// =============================================================================
// SERVICE DEPENDENCY SCHEMAS
// =============================================================================

export const ServiceDependencySchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		id: z.string().uuid(),
		dependentId: z.string().uuid(),
		dependencyId: z.string().uuid(),
		dependencyType: DependencyTypeSchema,
		criticality: DependencyCriticalitySchema,
		createdAt: DateStringSchema,
	}),
);

export const AddDependencySchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		dependencyId: z.string().uuid(),
		dependencyType: DependencyTypeSchema.optional(),
		criticality: DependencyCriticalitySchema.optional(),
	}),
);

export const UpdateDependencySchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		dependencyType: DependencyTypeSchema.optional(),
		criticality: DependencyCriticalitySchema.optional(),
	}),
);

// =============================================================================
// SERVICE INVESTIGATION CONFIG SCHEMA
// =============================================================================

export const ServiceInvestigationConfigSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		autoInvestigate: z
			.enum(["always", "critical_and_high", "critical_only", "never"])
			.default("always"),
		requiresApproval: z.boolean().default(false),
		analysisContext: z.string().optional(),
	}),
);

// =============================================================================
// SERVICE WITH RELATIONS (includes nested repos)
// =============================================================================

export const ServiceRepositoryNestedSchema = /* @__PURE__ */ lazySchema(() =>
	ServiceRepositorySchema.extend({
		repository: RepositorySchema,
	}),
);

export const ServiceWithRelationsSchema = /* @__PURE__ */ lazySchema(() =>
	ServiceSchema.extend({
		dependencies: z.array(ServiceDependencySchema).optional(),
		dependents: z.array(ServiceDependencySchema).optional(),
		repositories: z.array(ServiceRepositoryNestedSchema).optional(),
		alertCount: z.number().int().optional(),
		incidentCount: z.number().int().optional(),
		/** The newest alert received for this service; null when none ever arrived. */
		lastReportAt: DateStringSchema.nullable().optional(),
	}),
);

export const ServiceListResponseSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		data: z.array(ServiceWithRelationsSchema),
		total: z.number().int(),
	}),
);

// =============================================================================
// TOPOLOGY EDGE SCHEMA
// =============================================================================

export const TopologyEdgeSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		service: ServiceSchema,
		dependencyType: DependencyTypeSchema,
		criticality: DependencyCriticalitySchema,
	}),
);

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type Service = z.infer<typeof ServiceSchema>;
export type CreateServiceInput = z.infer<typeof CreateServiceSchema>;
export type UpdateServiceInput = z.infer<typeof UpdateServiceSchema>;
export type ServiceDependency = z.infer<typeof ServiceDependencySchema>;
export type AddDependencyInput = z.infer<typeof AddDependencySchema>;
export type UpdateDependencyInput = z.infer<typeof UpdateDependencySchema>;
export type ServiceWithRelations = z.infer<typeof ServiceWithRelationsSchema>;
export type ServiceListQuery = z.infer<typeof ServiceListQuerySchema>;
export type ServiceListResponse = z.infer<typeof ServiceListResponseSchema>;
export type ServiceInvestigationConfig = z.infer<
	typeof ServiceInvestigationConfigSchema
>;
export type TopologyEdge = z.infer<typeof TopologyEdgeSchema>;
export type ServiceRepositoryNested = z.infer<
	typeof ServiceRepositoryNestedSchema
>;
