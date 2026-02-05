/**
 * Core Zod Schemas - Input Data Types
 *
 * Defines the fundamental schemas for alerts, incidents, and integrations.
 * These are the primary input data structures for the investigation workflow.
 */

import { z } from "zod";

// =============================================================================
// ALERT CONTEXT
// =============================================================================

/**
 * Alert context schema - represents a single alert in the investigation
 */
export const AlertContextSchema = z.object({
	alertId: z.string(),
	title: z.string(),
	description: z.string().optional(),
	severity: z.enum(["critical", "high", "medium", "low", "info"]),
	status: z
		.enum(["triggered", "acknowledged", "correlated", "resolved", "suppressed"])
		.optional(),
	source: z.string().optional(),
	sourceUrl: z.string().optional(),
	serviceId: z.string().optional(),
	serviceName: z.string().optional(),
	repository: z.string().optional(),
	labels: z.record(z.string()).optional(),
	tags: z.array(z.string()).optional(),
	triggeredAt: z.string().optional(),
	rawPayload: z.unknown().optional(),
});

export type AlertContext = z.infer<typeof AlertContextSchema>;

// =============================================================================
// INCIDENT CONTEXT
// =============================================================================

/**
 * Incident context schema - represents the incident being investigated
 * This is the primary unit of investigation, with alerts as supporting data.
 */
export const IncidentContextSchema = z.object({
	incidentId: z.string(),
	number: z.number().int(),
	title: z.string(),
	description: z.string().optional(),
	severity: z.enum(["critical", "high", "medium", "low", "info"]),
	status: z.enum([
		"triggered",
		"investigating",
		"identified",
		"monitoring",
		"resolved",
		"closed",
	]),
	priority: z.enum(["p1", "p2", "p3", "p4", "p5"]),
	serviceId: z.string().optional(),
	serviceName: z.string().optional(),
	correlationReason: z.string().optional(),
	alertCount: z.number().int(),
	triggeredAt: z.string(),
	acknowledgedAt: z.string().optional(),
	tags: z.array(z.string()).optional(),
	customerImpact: z.string().optional(),
	affectedSystems: z.array(z.string()).optional(),
});

export type IncidentContext = z.infer<typeof IncidentContextSchema>;

// =============================================================================
// INTEGRATION CONTEXT
// =============================================================================

/**
 * Integration context schema - credentials and config for external tools
 *
 * NOTE: This type contains sensitive credentials. In the new architecture,
 * integrations are passed via InvestigationConfig (RunnableConfig.configurable)
 * rather than being stored in checkpointed state.
 */
export const IntegrationContextSchema = z.object({
	type: z.string(),
	connectionId: z.string(),
	credentials: z.record(z.unknown()),
	config: z.record(z.unknown()),
	serviceOverrides: z.record(z.unknown()).optional(),
});

export type IntegrationContext = z.infer<typeof IntegrationContextSchema>;
