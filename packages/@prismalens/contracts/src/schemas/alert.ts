// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Alert schemas
 */
import { z } from "zod";
import {
	AlertStatusSchema,
	DateStringSchema,
	SeveritySchema,
} from "./common.js";
import { ServiceSchema } from "./service.js";

// =============================================================================
// ALERT SCHEMAS
// =============================================================================

export const AlertSchema = z.object({
	id: z.string().uuid(),
	dedupKey: z.string(),
	fingerprint: z.string().nullable(),
	externalId: z.string().nullable(),
	title: z.string().min(1),
	description: z.string().nullable(),
	severity: SeveritySchema,
	status: AlertStatusSchema,
	source: z.string().nullable(),
	sourceUrl: z.string().nullable(),
	serviceId: z.string().uuid().nullable(),
	incidentId: z.string().uuid().nullable(),
	tags: z.array(z.string()).nullable(),
	labels: z.record(z.string()).nullable(),
	triggeredAt: DateStringSchema,
	acknowledgedAt: DateStringSchema.nullable(),
	resolvedAt: DateStringSchema.nullable(),
	occurrenceCount: z.number().int(),
	lastOccurrence: DateStringSchema,
	rawPayload: z.string().nullable(),
	createdAt: DateStringSchema,
	updatedAt: DateStringSchema,
});

export const CreateAlertSchema = z.object({
	title: z.string().min(1),
	description: z.string().optional(),
	severity: SeveritySchema.optional(),
	source: z.string().optional(),
	sourceAlertId: z.string().optional(),
	sourceUrl: z.string().optional(),
	serviceId: z.string().uuid().optional(),
	tags: z.array(z.string()).optional(),
	labels: z.record(z.string()).optional(),
	rawPayload: z.record(z.unknown()).optional(),
});

export const UpdateAlertSchema = z.object({
	title: z.string().optional(),
	description: z.string().optional(),
	severity: SeveritySchema.optional(),
	status: AlertStatusSchema.optional(),
});

// =============================================================================
// ALERT WITH RELATIONS
// =============================================================================

// Minimal incident reference to avoid circular dependency
const IncidentRefSchema = z.object({
	id: z.string().uuid(),
	number: z.number().int(),
	title: z.string(),
	status: z.string(),
	severity: z.string(),
});

export const AlertWithRelationsSchema = AlertSchema.extend({
	service: ServiceSchema.nullable().optional(),
	incident: IncidentRefSchema.nullable().optional(),
});

// =============================================================================
// ALERT QUERY SCHEMAS
// =============================================================================

export const AlertQuerySchema = z.object({
	status: AlertStatusSchema.optional(),
	severity: SeveritySchema.optional(),
	serviceId: z.string().uuid().optional(),
	incidentId: z.string().uuid().optional(),
	hasIncident: z.coerce.boolean().optional(),
	limit: z.coerce.number().int().min(1).max(100).default(50),
	offset: z.coerce.number().int().min(0).default(0),
});

// =============================================================================
// ALERT CORRELATION RESPONSE
// =============================================================================

export const AlertCorrelationResponseSchema = z.object({
	alert: AlertSchema,
	correlation: z.object({
		incidentId: z.string().uuid().optional(),
		incidentNumber: z.number().int().optional(),
		reason: z.string().optional(),
		isNewIncident: z.boolean(),
	}),
});

export const CorrelateAlertResponseSchema = z.object({
	alert: AlertSchema,
	incidentId: z.string().uuid().optional(),
	incidentNumber: z.number().int().optional(),
	reason: z.string().optional(),
	isNewIncident: z.boolean(),
});

// =============================================================================
// ALERT STATS
// =============================================================================

export const AlertStatsSchema = z.object({
	total: z.number().int(),
	byStatus: z.record(z.number().int()),
	bySeverity: z.record(z.number().int()),
});

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type Alert = z.infer<typeof AlertSchema>;
export type CreateAlertInput = z.infer<typeof CreateAlertSchema>;
export type UpdateAlertInput = z.infer<typeof UpdateAlertSchema>;
export type AlertWithRelations = z.infer<typeof AlertWithRelationsSchema>;
export type AlertQuery = z.infer<typeof AlertQuerySchema>;
export type AlertCorrelationResponse = z.infer<
	typeof AlertCorrelationResponseSchema
>;
export type CorrelateAlertResponse = z.infer<
	typeof CorrelateAlertResponseSchema
>;
export type AlertStats = z.infer<typeof AlertStatsSchema>;
