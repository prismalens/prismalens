// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Repository schemas
 */
import { z } from "zod";
import { DateStringSchema } from "./common.js";

// =============================================================================
// REPOSITORY SCHEMAS
// =============================================================================

export const RepositorySourceKindSchema = z.enum(["folder", "url"]);

export const RepositorySchema = z.object({
	id: z.string().uuid(),
	/** Null for a folder or URL the operator typed; set when a VCS connection discovered it. */
	connectionId: z.string().uuid().nullable(),
	sourceKind: RepositorySourceKindSchema,
	fullName: z.string(),
	/** A git URL, or an absolute folder path when sourceKind is "folder". */
	url: z.string(),
	description: z.string().nullable(),
	language: z.string().nullable(),
	defaultBranch: z.string(),
	isPrivate: z.boolean(),
	metadata: z.record(z.string(), z.unknown()).nullable(),
	/** What the last save validated: branch and commit, or the git error verbatim (ADR 0004 §2). */
	syncBranch: z.string().nullable(),
	syncHead: z.string().nullable(),
	syncError: z.string().nullable(),
	syncedAt: DateStringSchema.nullable(),
	createdAt: DateStringSchema,
	updatedAt: DateStringSchema,
});

/** A service names its code as a local folder or a git URL; save validates it and links it as primary. */
export const AddRepositorySourceSchema = z.object({
	serviceId: z.string().uuid(),
	source: z.string().trim().min(1),
	subPath: z.string().trim().min(1).optional(),
});

export const CreateRepositorySchema = z.object({
	connectionId: z.string().uuid(),
	fullName: z.string(),
	url: z.string(),
	description: z.string().optional(),
	language: z.string().optional(),
	defaultBranch: z.string().optional(),
	isPrivate: z.boolean().optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
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
export type RepositorySourceKind = z.infer<typeof RepositorySourceKindSchema>;
export type AddRepositorySourceInput = z.infer<
	typeof AddRepositorySourceSchema
>;
export type CreateRepositoryInput = z.infer<typeof CreateRepositorySchema>;
export type BatchCreateRepositoriesInput = z.infer<
	typeof BatchCreateRepositoriesSchema
>;
export type ServiceRepository = z.infer<typeof ServiceRepositorySchema>;
export type LinkRepositoryInput = z.infer<typeof LinkRepositorySchema>;
export type RepositoryWithServices = z.infer<
	typeof RepositoryWithServicesSchema
>;
