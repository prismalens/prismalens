// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Alert mapping rule schemas
 */
import { z } from "zod";
import { DateStringSchema, QueryBooleanSchema } from "./common.js";

// =============================================================================
// ALERT MAPPING RULE SCHEMAS
// =============================================================================

export const AlertMappingRuleSchema = z.object({
	id: z.string().uuid(),
	name: z.string().min(1),
	description: z.string().nullable(),
	priority: z.number().int(), // Lower = higher priority
	enabled: z.boolean(),
	matchCriteria: z.record(z.string(), z.unknown()), // JSON match criteria
	serviceId: z.string().uuid(),
	createdAt: DateStringSchema,
	updatedAt: DateStringSchema,
});

export const CreateMappingRuleSchema = z.object({
	name: z.string().min(1),
	description: z.string().optional(),
	priority: z.number().int().optional(),
	enabled: z.boolean().optional(),
	matchCriteria: z.record(z.string(), z.unknown()),
	serviceId: z.string().uuid(),
});

export const UpdateMappingRuleSchema = CreateMappingRuleSchema.partial();

// =============================================================================
// ALERT MAPPING WITH RELATIONS
// =============================================================================

const ServiceRefSchema = z.object({
	id: z.string().uuid(),
	name: z.string(),
	displayName: z.string().nullable(),
});

export const AlertMappingRuleWithServiceSchema = AlertMappingRuleSchema.extend({
	service: ServiceRefSchema.optional(),
});

// =============================================================================
// TEST MAPPING SCHEMAS
// =============================================================================

export const TestMappingSchema = z.object({
	alertData: z.record(z.string(), z.unknown()),
});

export const TestMappingResponseSchema = z.object({
	matchedRule: AlertMappingRuleSchema.nullable(),
	serviceId: z.string().uuid().nullable(),
	serviceName: z.string().nullable(),
});

// =============================================================================
// ALERT MAPPING QUERY SCHEMAS
// =============================================================================

export const AlertMappingQuerySchema = z.object({
	serviceId: z.string().uuid().optional(),
	enabled: QueryBooleanSchema.optional(),
	limit: z.coerce.number().int().min(1).max(100).default(50),
	offset: z.coerce.number().int().min(0).default(0),
});

// =============================================================================
// ALERT MAPPING HEALTH SCHEMAS
// =============================================================================

export const AlertMappingHealthIssueTypeSchema = z.enum([
	"unmapped_service",
	"never_matched",
	"stopped_matching",
]);

export const AlertMappingHealthIssueSchema = z.object({
	id: z.string(),
	type: AlertMappingHealthIssueTypeSchema,
	title: z.string(),
	description: z.string(),
	ruleId: z.string().uuid().optional(),
	ruleName: z.string().optional(),
	serviceId: z.string().uuid().optional(),
	serviceName: z.string().optional(),
	lastMatchedAt: DateStringSchema.nullable().optional(),
});

export const ServiceMappingHealthSchema = z.object({
	serviceId: z.string().uuid(),
	serviceName: z.string(),
	serviceDisplayName: z.string().nullable(),
	hasEnabledRules: z.boolean(),
	ruleCount: z.number().int(),
	enabledRuleCount: z.number().int(),
});

export const RuleMappingHealthStatusSchema = z.enum([
	"healthy",
	"never_matched",
	"stopped_matching",
	"disabled",
]);

export const RuleMappingHealthSchema = z.object({
	ruleId: z.string().uuid(),
	ruleName: z.string(),
	serviceId: z.string().uuid(),
	serviceName: z.string().nullable(),
	enabled: z.boolean(),
	status: RuleMappingHealthStatusSchema,
	totalMatches: z.number().int(),
	windowMatches: z.number().int(),
	lastMatchedAt: DateStringSchema.nullable(),
});

export const AlertMappingHealthSummarySchema = z.object({
	totalIssues: z.number().int(),
	unmappedServicesCount: z.number().int(),
	neverMatchedRulesCount: z.number().int(),
	stoppedMatchingRulesCount: z.number().int(),
	healthyRulesCount: z.number().int(),
	disabledRulesCount: z.number().int(),
	totalRules: z.number().int(),
	totalServices: z.number().int(),
	windowHours: z.number().int(),
});

export const AlertMappingHealthResponseSchema = z.object({
	summary: AlertMappingHealthSummarySchema,
	issues: z.array(AlertMappingHealthIssueSchema),
	services: z.array(ServiceMappingHealthSchema),
	rules: z.array(RuleMappingHealthSchema),
});

export const AlertMappingHealthQuerySchema = z.object({
	windowHours: z.coerce.number().int().min(1).max(2160).default(168),
});

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type AlertMappingRule = z.infer<typeof AlertMappingRuleSchema>;
export type CreateMappingRuleInput = z.infer<typeof CreateMappingRuleSchema>;
export type UpdateMappingRuleInput = z.infer<typeof UpdateMappingRuleSchema>;
export type AlertMappingRuleWithService = z.infer<
	typeof AlertMappingRuleWithServiceSchema
>;
export type TestMappingInput = z.infer<typeof TestMappingSchema>;
export type TestMappingResponse = z.infer<typeof TestMappingResponseSchema>;
export type AlertMappingQuery = z.infer<typeof AlertMappingQuerySchema>;
export type AlertMappingHealthIssueType = z.infer<
	typeof AlertMappingHealthIssueTypeSchema
>;
export type AlertMappingHealthIssue = z.infer<
	typeof AlertMappingHealthIssueSchema
>;
export type ServiceMappingHealth = z.infer<typeof ServiceMappingHealthSchema>;
export type RuleMappingHealthStatus = z.infer<
	typeof RuleMappingHealthStatusSchema
>;
export type RuleMappingHealth = z.infer<typeof RuleMappingHealthSchema>;
export type AlertMappingHealthSummary = z.infer<
	typeof AlertMappingHealthSummarySchema
>;
export type AlertMappingHealthResponse = z.infer<
	typeof AlertMappingHealthResponseSchema
>;
export type AlertMappingHealthQuery = z.infer<
	typeof AlertMappingHealthQuerySchema
>;
