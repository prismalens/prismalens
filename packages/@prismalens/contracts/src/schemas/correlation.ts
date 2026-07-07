// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Correlation rule schemas
 */
import { z } from "zod";
import { CorrelationActionSchema, DateStringSchema } from "./common.js";

// =============================================================================
// CORRELATION RULE SCHEMAS
// =============================================================================

export const CorrelationRuleSchema = z.object({
	id: z.string().uuid(),
	name: z.string().min(1),
	description: z.string().nullable(),
	enabled: z.boolean(),
	priority: z.number().int(),
	matchCriteria: z.record(z.unknown()), // JSON criteria object
	timeWindowMinutes: z.number().int().min(1),
	action: CorrelationActionSchema,
	createdAt: DateStringSchema,
	updatedAt: DateStringSchema,
});

export const CreateCorrelationRuleSchema = z.object({
	name: z.string().min(1),
	description: z.string().optional(),
	enabled: z.boolean().optional(),
	priority: z.number().int().optional(),
	matchCriteria: z.record(z.unknown()),
	timeWindowMinutes: z.number().int().min(1).optional(),
	action: CorrelationActionSchema.optional(),
});

export const UpdateCorrelationRuleSchema =
	CreateCorrelationRuleSchema.partial();

// =============================================================================
// CORRELATION TEST SCHEMAS
// =============================================================================

export const TestCorrelationSchema = z.object({
	alertData: z.record(z.unknown()),
});

export const TestCorrelationResponseSchema = z.object({
	matchedRule: CorrelationRuleSchema.nullable(),
	action: CorrelationActionSchema,
	reason: z.string(),
});

// =============================================================================
// CORRELATION QUERY SCHEMAS
// =============================================================================

export const CorrelationRuleQuerySchema = z.object({
	enabled: z.coerce.boolean().optional(),
	limit: z.coerce.number().int().min(1).max(100).default(50),
	offset: z.coerce.number().int().min(0).default(0),
});

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type CorrelationRule = z.infer<typeof CorrelationRuleSchema>;
export type CreateCorrelationRuleInput = z.infer<
	typeof CreateCorrelationRuleSchema
>;
export type UpdateCorrelationRuleInput = z.infer<
	typeof UpdateCorrelationRuleSchema
>;
export type TestCorrelationInput = z.infer<typeof TestCorrelationSchema>;
export type TestCorrelationResponse = z.infer<
	typeof TestCorrelationResponseSchema
>;
export type CorrelationRuleQuery = z.infer<typeof CorrelationRuleQuerySchema>;
