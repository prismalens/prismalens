/**
 * Incident schemas
 */
import { z } from "zod";
import { AlertSchema } from "./alert.js";
import {
	CoerceDateSchema,
	DateStringSchema,
	IncidentStatusSchema,
	PrioritySchema,
	SeveritySchema,
} from "./common.js";
import { ServiceSchema } from "./service.js";

// =============================================================================
// INCIDENT SCHEMAS
// =============================================================================

export const IncidentSchema = z.object({
	id: z.string().uuid(),
	number: z.number().int(),
	title: z.string().min(1),
	description: z.string().nullable(),
	severity: SeveritySchema,
	status: IncidentStatusSchema,
	priority: PrioritySchema,
	serviceId: z.string().uuid().nullable(),
	assignedToId: z.string().uuid().nullable(),
	correlationReason: z.string().nullable(),
	correlationRuleId: z.string().uuid().nullable(),
	tags: z.array(z.string()).nullable(),
	customerImpact: z.string().nullable(),
	affectedSystems: z.array(z.string()).nullable(),
	triggeredAt: DateStringSchema,
	acknowledgedAt: DateStringSchema.nullable(),
	resolvedAt: DateStringSchema.nullable(),
	alertCount: z.number().int(),
	timeToAcknowledge: z.number().int().nullable(),
	timeToResolve: z.number().int().nullable(),
	createdAt: DateStringSchema,
	updatedAt: DateStringSchema,
});

export const CreateIncidentSchema = z.object({
	title: z.string().min(1),
	description: z.string().optional(),
	severity: SeveritySchema.optional(),
	priority: PrioritySchema.optional(),
	serviceId: z.string().uuid().optional(),
	tags: z.array(z.string()).optional(),
	customerImpact: z.string().optional(),
	affectedSystems: z.array(z.string()).optional(),
});

export const UpdateIncidentSchema = z.object({
	title: z.string().optional(),
	description: z.string().optional(),
	severity: SeveritySchema.optional(),
	status: IncidentStatusSchema.optional(),
	priority: PrioritySchema.optional(),
	assignedToId: z.string().uuid().optional(),
	customerImpact: z.string().optional(),
	tags: z.array(z.string()).optional(),
});

// =============================================================================
// INCIDENT WITH RELATIONS
// =============================================================================

// User reference
const UserRefSchema = z.object({
	id: z.string().uuid(),
	email: z.string().email(),
	firstName: z.string().nullable(),
	lastName: z.string().nullable(),
});

// Investigation reference (minimal to avoid circular)
const InvestigationRefSchema = z.object({
	id: z.string().uuid(),
	status: z.string(),
	createdAt: DateStringSchema,
	completedAt: DateStringSchema.nullable(),
});

export const IncidentWithRelationsSchema = IncidentSchema.extend({
	service: ServiceSchema.nullable().optional(),
	assignedTo: UserRefSchema.nullable().optional(),
	alerts: z.array(AlertSchema).optional(),
	investigations: z.array(InvestigationRefSchema).optional(),
});

// =============================================================================
// INCIDENT QUERY SCHEMAS
// =============================================================================

export const IncidentQuerySchema = z.object({
	status: IncidentStatusSchema.optional(),
	severity: SeveritySchema.optional(),
	priority: PrioritySchema.optional(),
	serviceId: z.string().uuid().optional(),
	fromDate: CoerceDateSchema.optional(),
	toDate: CoerceDateSchema.optional(),
	limit: z.coerce.number().int().min(1).max(100).default(50),
	offset: z.coerce.number().int().min(0).default(0),
});

// =============================================================================
// INCIDENT ACTIONS
// =============================================================================

export const AddAlertToIncidentSchema = z.object({
	alertId: z.string().uuid(),
});

export const InvestigateIncidentResponseSchema = z.object({
	incidentId: z.string().uuid(),
	investigationId: z.string().uuid(),
	jobId: z.string().nullable(),
	queued: z.boolean(),
});

// =============================================================================
// INCIDENT STATS
// =============================================================================

export const IncidentStatsSchema = z.object({
	total: z.number().int(),
	active: z.number().int(),
	byStatus: z.record(z.number().int()),
	bySeverity: z.record(z.number().int()),
	byPriority: z.record(z.number().int()),
	avgTimeToAcknowledge: z.number().nullable(),
	avgTimeToResolve: z.number().nullable(),
});

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type Incident = z.infer<typeof IncidentSchema>;
export type CreateIncidentInput = z.infer<typeof CreateIncidentSchema>;
export type UpdateIncidentInput = z.infer<typeof UpdateIncidentSchema>;
export type IncidentWithRelations = z.infer<typeof IncidentWithRelationsSchema>;
export type IncidentQuery = z.infer<typeof IncidentQuerySchema>;
export type AddAlertToIncidentInput = z.infer<typeof AddAlertToIncidentSchema>;
export type InvestigateIncidentResponse = z.infer<
	typeof InvestigateIncidentResponseSchema
>;
export type IncidentStats = z.infer<typeof IncidentStatsSchema>;
