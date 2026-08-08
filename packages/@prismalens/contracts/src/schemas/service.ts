// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Service catalog schemas
 */
import { z } from "zod";
import {
	DateStringSchema,
	DependencyCriticalitySchema,
	DependencyTypeSchema,
	PaginationSchema,
	ServiceTierSchema,
	ServiceTypeSchema,
} from "./common.js";
import { DeploymentSchema } from "./deployment.js";
import { RepositorySchema, ServiceRepositorySchema } from "./repository.js";

// =============================================================================
// SERVICE SCHEMAS
// =============================================================================

export const ServiceSchema = z.object({
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
	/**
	 * Absolute path to this service's checkout on the machine running the worker
	 * (#331) — the working directory an investigation runs in. `null` means the
	 * service is UNMAPPED and its investigations say so in the run report.
	 */
	localCheckoutPath: z.string().nullable(),
	createdAt: DateStringSchema,
	updatedAt: DateStringSchema,
});

export const CreateServiceSchema = z.object({
	name: z.string().min(1),
	displayName: z.string().optional(),
	description: z.string().optional(),
	type: ServiceTypeSchema.optional(),
	tier: ServiceTierSchema.optional(),
	team: z.string().optional(),
	slackChannel: z.string().optional(),
	tags: z.array(z.string()).optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
	/**
	 * Local checkout to investigate in. Validated server-side before it is
	 * stored; `null` or an empty string clears the mapping.
	 */
	localCheckoutPath: z.string().nullable().optional(),
});

export const UpdateServiceSchema = CreateServiceSchema.partial();

// =============================================================================
// SERVICE LIST QUERY SCHEMA
// =============================================================================

export const ServiceListQuerySchema = PaginationSchema.extend({
	type: ServiceTypeSchema.optional(),
	tier: ServiceTierSchema.optional(),
	team: z.string().optional(),
	search: z.string().optional(),
});

// =============================================================================
// SERVICE DEPENDENCY SCHEMAS
// =============================================================================

export const ServiceDependencySchema = z.object({
	id: z.string().uuid(),
	dependentId: z.string().uuid(),
	dependencyId: z.string().uuid(),
	dependencyType: DependencyTypeSchema,
	criticality: DependencyCriticalitySchema,
	createdAt: DateStringSchema,
});

export const AddDependencySchema = z.object({
	dependencyId: z.string().uuid(),
	dependencyType: DependencyTypeSchema.optional(),
	criticality: DependencyCriticalitySchema.optional(),
});

export const UpdateDependencySchema = z.object({
	dependencyType: DependencyTypeSchema.optional(),
	criticality: DependencyCriticalitySchema.optional(),
});

// =============================================================================
// LOCAL CHECKOUT MAPPING (#331)
// =============================================================================

/** Why a candidate checkout path was refused — mirrors `@prismalens/config`. */
export const CheckoutRejectionSchema = z.enum([
	"empty",
	"not_absolute",
	"not_found",
	"not_a_directory",
	"not_a_git_repo",
]);

export const ValidateCheckoutPathSchema = z.object({
	path: z.string(),
});

export const CheckoutPathValidationSchema = z.object({
	valid: z.boolean(),
	/** The normalised absolute path — what a subsequent update should store. */
	path: z.string(),
	reason: CheckoutRejectionSchema.optional(),
	/** Operator-facing sentence; safe to render verbatim. */
	message: z.string().optional(),
	/** Root of the enclosing git work tree (present only when `valid`). */
	repoRoot: z.string().optional(),
	/** `owner/name` from the origin remote, when detectable. */
	repoSlug: z.string().optional(),
	/** True when `path` is a package inside a larger work tree. */
	isSubdirectory: z.boolean().optional(),
});

// =============================================================================
// SERVICE INVESTIGATION CONFIG SCHEMA
// =============================================================================

export const ServiceInvestigationConfigSchema = z.object({
	autoInvestigate: z
		.enum(["always", "critical_and_high", "critical_only", "never"])
		.default("always"),
	requiresApproval: z.boolean().default(false),
	analysisContext: z.string().optional(),
});

// =============================================================================
// SERVICE WITH RELATIONS (includes nested repos + deployments)
// =============================================================================

export const ServiceRepositoryNestedSchema = ServiceRepositorySchema.extend({
	repository: RepositorySchema,
});

export const ServiceWithRelationsSchema = ServiceSchema.extend({
	dependencies: z.array(ServiceDependencySchema).optional(),
	dependents: z.array(ServiceDependencySchema).optional(),
	repositories: z.array(ServiceRepositoryNestedSchema).optional(),
	deployments: z.array(DeploymentSchema).optional(),
	alertCount: z.number().int().optional(),
	incidentCount: z.number().int().optional(),
});

export const ServiceListResponseSchema = z.object({
	data: z.array(ServiceWithRelationsSchema),
	total: z.number().int(),
});

// =============================================================================
// TOPOLOGY EDGE SCHEMA
// =============================================================================

export const TopologyEdgeSchema = z.object({
	service: ServiceSchema,
	dependencyType: DependencyTypeSchema,
	criticality: DependencyCriticalitySchema,
});

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
export type CheckoutRejection = z.infer<typeof CheckoutRejectionSchema>;
export type ValidateCheckoutPathInput = z.infer<
	typeof ValidateCheckoutPathSchema
>;
export type CheckoutPathValidation = z.infer<
	typeof CheckoutPathValidationSchema
>;
export type ServiceRepositoryNested = z.infer<
	typeof ServiceRepositoryNestedSchema
>;
