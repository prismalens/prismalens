/**
 * Repository schemas
 */
import { z } from "zod";
import { DateStringSchema } from "./common.js";

// =============================================================================
// REPOSITORY SCHEMAS
// =============================================================================

export const RepositorySchema = z.object({
	id: z.string().uuid(),
	connectionId: z.string().uuid(),
	fullName: z.string(),
	url: z.string(),
	description: z.string().nullable(),
	language: z.string().nullable(),
	defaultBranch: z.string(),
	isPrivate: z.boolean(),
	metadata: z.record(z.unknown()).nullable(),
	createdAt: DateStringSchema,
	updatedAt: DateStringSchema,
});

export const CreateRepositorySchema = z.object({
	connectionId: z.string().uuid(),
	fullName: z.string(),
	url: z.string(),
	description: z.string().optional(),
	language: z.string().optional(),
	defaultBranch: z.string().optional(),
	isPrivate: z.boolean().optional(),
	metadata: z.record(z.unknown()).optional(),
});

export const BatchCreateRepositoriesSchema = z.object({
	repositories: z.array(CreateRepositorySchema).min(1),
});

// =============================================================================
// SERVICE REPOSITORY JUNCTION SCHEMAS
// =============================================================================

export const ServiceRepositorySchema = z.object({
	id: z.string().uuid(),
	serviceId: z.string().uuid(),
	repositoryId: z.string().uuid(),
	subPath: z.string().nullable(),
	isPrimary: z.boolean(),
	createdAt: DateStringSchema,
});

export const LinkRepositorySchema = z.object({
	serviceId: z.string().uuid(),
	subPath: z.string().optional(),
	isPrimary: z.boolean().optional(),
});

export const RepositoryWithServicesSchema = RepositorySchema.extend({
	services: z.array(ServiceRepositorySchema).optional(),
});

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type Repository = z.infer<typeof RepositorySchema>;
export type CreateRepositoryInput = z.infer<typeof CreateRepositorySchema>;
export type BatchCreateRepositoriesInput = z.infer<
	typeof BatchCreateRepositoriesSchema
>;
export type ServiceRepository = z.infer<typeof ServiceRepositorySchema>;
export type LinkRepositoryInput = z.infer<typeof LinkRepositorySchema>;
export type RepositoryWithServices = z.infer<
	typeof RepositoryWithServicesSchema
>;
