/**
 * Webhook schemas (Prometheus AlertManager, generic)
 */
import { z } from "zod";
import { SeveritySchema } from "./common.js";

// =============================================================================
// PROMETHEUS ALERTMANAGER SCHEMAS
// =============================================================================

export const PrometheusAlertSchema = z.object({
	status: z.enum(["firing", "resolved"]),
	labels: z.record(z.string()),
	annotations: z.record(z.string()).optional(),
	startsAt: z.string(),
	endsAt: z.string().optional(),
	generatorURL: z.string().optional(),
	fingerprint: z.string().optional(),
});

export const PrometheusWebhookSchema = z.object({
	version: z.string().optional(),
	groupKey: z.string().optional(),
	truncatedAlerts: z.number().optional(),
	status: z.enum(["firing", "resolved"]),
	receiver: z.string().optional(),
	groupLabels: z.record(z.string()).optional(),
	commonLabels: z.record(z.string()).optional(),
	commonAnnotations: z.record(z.string()).optional(),
	externalURL: z.string().optional(),
	alerts: z.array(PrometheusAlertSchema),
});

export const PrometheusWebhookResponseSchema = z.object({
	received: z.number().int(),
	processed: z.number().int(),
	alertIds: z.array(z.string().uuid()),
});

// =============================================================================
// GENERIC WEBHOOK SCHEMAS
// =============================================================================

export const GenericWebhookSchema = z.object({
	title: z.string().min(1),
	description: z.string().optional(),
	severity: SeveritySchema.optional(),
	source: z.string().optional(),
	sourceAlertId: z.string().optional(),
	sourceUrl: z.string().optional(),
	serviceId: z.string().uuid().optional(),
	serviceName: z.string().optional(), // Will be matched to service by name
	tags: z.array(z.string()).optional(),
	labels: z.record(z.string()).optional(),
	rawPayload: z.record(z.unknown()).optional(),
});

export const GenericWebhookResponseSchema = z.object({
	alertId: z.string().uuid(),
	incidentId: z.string().uuid().optional(),
	isNewIncident: z.boolean(),
});

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type PrometheusAlert = z.infer<typeof PrometheusAlertSchema>;
export type PrometheusWebhook = z.infer<typeof PrometheusWebhookSchema>;
export type PrometheusWebhookResponse = z.infer<
	typeof PrometheusWebhookResponseSchema
>;
export type GenericWebhook = z.infer<typeof GenericWebhookSchema>;
export type GenericWebhookResponse = z.infer<
	typeof GenericWebhookResponseSchema
>;
