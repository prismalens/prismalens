// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Service discovery schemas
 */
import { z } from "zod";
import {
	DateStringSchema,
	ServiceTypeSchema,
	SuggestionStatusSchema,
} from "./common.js";

// =============================================================================
// SERVICE SUGGESTION SCHEMAS
// =============================================================================

export const SourceTypeSchema = z.enum(["repository", "deployment"]);
export type SourceType = z.infer<typeof SourceTypeSchema>;

export const ServiceSuggestionSchema = z.object({
	id: z.string().uuid(),
	connectionId: z.string().uuid(),
	suggestedName: z.string(),
	displayName: z.string().nullable(),
	repository: z.string(), // "owner/repo" for VCS, provider service name for deployments
	isMonorepo: z.boolean(),
	subPath: z.string().nullable(),
	sourceType: SourceTypeSchema,
	status: SuggestionStatusSchema,
	metadata: z.record(z.unknown()).nullable(),
	statusChangedAt: DateStringSchema.nullable(),
	acceptedServiceId: z.string().uuid().nullable(),
	acceptedDeploymentId: z.string().uuid().nullable(),
	createdAt: DateStringSchema,
	updatedAt: DateStringSchema,
});

// =============================================================================
// ACCEPT SUGGESTION SCHEMAS
// =============================================================================

export const AcceptSuggestionSchema = z.object({
	name: z.string().min(1).optional(), // Override suggested name
	displayName: z.string().optional(),
	description: z.string().optional(),
	type: ServiceTypeSchema.optional(),
	team: z.string().optional(),
});

export const AcceptBulkSuggestionsSchema = z.object({
	suggestionIds: z.array(z.string().uuid()).min(1),
});

export const AcceptSuggestionResponseSchema = z.object({
	serviceId: z.string().uuid(),
	serviceName: z.string(),
});

export const AcceptBulkSuggestionsResponseSchema = z.object({
	accepted: z.number().int(),
	services: z.array(
		z.object({
			suggestionId: z.string().uuid(),
			serviceId: z.string().uuid(),
			serviceName: z.string(),
		}),
	),
});

// =============================================================================
// SERVICE SUGGESTION QUERY SCHEMAS
// =============================================================================

export const ServiceSuggestionQuerySchema = z.object({
	connectionId: z.string().uuid().optional(),
	status: SuggestionStatusSchema.optional(),
	sourceType: SourceTypeSchema.optional(),
	limit: z.coerce.number().int().min(1).max(100).default(50),
	offset: z.coerce.number().int().min(0).default(0),
});

// =============================================================================
// DISCOVERY TRIGGER SCHEMAS
// =============================================================================

export const TriggerDiscoverySchema = z.object({
	connectionId: z.string().uuid(),
});

export const TriggerDiscoveryResponseSchema = z.object({
	discovered: z.number().int(),
	suggestions: z.array(ServiceSuggestionSchema),
});

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type ServiceSuggestion = z.infer<typeof ServiceSuggestionSchema>;
export type AcceptSuggestionInput = z.infer<typeof AcceptSuggestionSchema>;
export type AcceptBulkSuggestionsInput = z.infer<
	typeof AcceptBulkSuggestionsSchema
>;
export type AcceptSuggestionResponse = z.infer<
	typeof AcceptSuggestionResponseSchema
>;
export type AcceptBulkSuggestionsResponse = z.infer<
	typeof AcceptBulkSuggestionsResponseSchema
>;
export type ServiceSuggestionQuery = z.infer<
	typeof ServiceSuggestionQuerySchema
>;
export type TriggerDiscoveryInput = z.infer<typeof TriggerDiscoverySchema>;
export type TriggerDiscoveryResponse = z.infer<
	typeof TriggerDiscoveryResponseSchema
>;
