// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Alert schemas
 */
import { z } from "zod";
import {
	type AlertStatus,
	AlertStatusSchema,
	DateStringSchema,
	QueryBooleanSchema,
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
	labels: z.record(z.string(), z.string()).nullable(),
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
	labels: z.record(z.string(), z.string()).optional(),
	rawPayload: z.record(z.string(), z.unknown()).optional(),
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
// SUPPRESSION ATTRIBUTION
// =============================================================================

/**
 * The enabled correlation rule that is currently holding a suppressed alert down.
 *
 * Derived from the live rule set on every read — never stored on the alert. That
 * is deliberate: the rule is the source of truth, so the moment an operator
 * disables the rule or amends its match criteria the alert stops reporting a
 * blocker and `POST /alerts/{id}/correlate` starts working. A persisted copy
 * would go stale and claim a suppression that no rule still enforces.
 */
export const SuppressingRuleSchema = z.object({
	ruleId: z.string(),
	ruleName: z.string(),
});

/**
 * Payload carried on the `CONFLICT` (409) that `POST /alerts/{id}/correlate`
 * raises while an enabled `suppress` rule still matches the alert. Exported so a
 * client can `parse` the error data instead of casting it.
 *
 * Naming the rule is the whole point of the refusal, so `ruleId`/`ruleName` are
 * required: an operator told only "this is suppressed" is back at the dead end.
 * Attribution is guaranteed because rule-based suppression is the only thing that
 * raises this error, and it always knows which rule fired.
 */
export const SuppressedByRuleConflictSchema = z.object({
	alertId: z.string(),
	ruleId: z.string(),
	ruleName: z.string(),
});

/**
 * Single-alert read model: `AlertWithRelations` plus the derived answer to
 * "why can't this alert be correlated right now, and what would unblock it".
 */
export const AlertDetailSchema = AlertWithRelationsSchema.extend({
	/**
	 * Non-null only while the alert is `suppressed` AND an enabled `suppress`
	 * rule still matches it. Null means nothing blocks re-correlation.
	 */
	suppressedBy: SuppressingRuleSchema.nullable(),
});

// =============================================================================
// ALERT QUERY SCHEMAS
// =============================================================================

export const AlertQuerySchema = z.object({
	status: AlertStatusSchema.optional(),
	severity: SeveritySchema.optional(),
	serviceId: z.string().uuid().optional(),
	incidentId: z.string().uuid().optional(),
	hasIncident: QueryBooleanSchema.optional(),
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
	byStatus: z.record(z.string(), z.number().int()),
	bySeverity: z.record(z.string(), z.number().int()),
});

// =============================================================================
// UNASSIGNED ALERTS DEFINITION
// =============================================================================

export const UNASSIGNED_ALERT_STATUSES = ["triggered", "acknowledged"] as const;

export type UnassignedAlertStatus = (typeof UNASSIGNED_ALERT_STATUSES)[number];

export function isUnassignedAlert(alert: {
	incidentId?: string | null;
	status: AlertStatus | string;
}): boolean {
	return (
		!alert.incidentId &&
		(UNASSIGNED_ALERT_STATUSES as readonly string[]).includes(alert.status)
	);
}

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type Alert = z.infer<typeof AlertSchema>;
export type CreateAlertInput = z.infer<typeof CreateAlertSchema>;
export type UpdateAlertInput = z.infer<typeof UpdateAlertSchema>;
export type AlertWithRelations = z.infer<typeof AlertWithRelationsSchema>;
export type SuppressingRule = z.infer<typeof SuppressingRuleSchema>;
export type SuppressedByRuleConflict = z.infer<
	typeof SuppressedByRuleConflictSchema
>;
export type AlertDetail = z.infer<typeof AlertDetailSchema>;
export type AlertQuery = z.infer<typeof AlertQuerySchema>;
export type AlertCorrelationResponse = z.infer<
	typeof AlertCorrelationResponseSchema
>;
export type CorrelateAlertResponse = z.infer<
	typeof CorrelateAlertResponseSchema
>;
export type AlertStats = z.infer<typeof AlertStatsSchema>;
