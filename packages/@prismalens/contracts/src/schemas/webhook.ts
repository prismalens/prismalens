// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

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
	labels: z.record(z.string(), z.string()),
	annotations: z.record(z.string(), z.string()).optional(),
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
	groupLabels: z.record(z.string(), z.string()).optional(),
	commonLabels: z.record(z.string(), z.string()).optional(),
	commonAnnotations: z.record(z.string(), z.string()).optional(),
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
	labels: z.record(z.string(), z.string()).optional(),
	rawPayload: z.record(z.string(), z.unknown()).optional(),
});

export const GenericWebhookResponseSchema = z.object({
	alertId: z.string().uuid(),
	incidentId: z.string().uuid().optional(),
	isNewIncident: z.boolean(),
});

// =============================================================================
// RENDER WEBHOOK SCHEMAS
// =============================================================================

export const RenderWebhookSchema = z.object({
	type: z.string().optional(),
	service: z
		.object({
			id: z.string(),
			name: z.string(),
			type: z.string().optional(),
		})
		.optional(),
	deploy: z
		.object({
			id: z.string(),
			status: z.string(),
			finishedAt: z.string().optional(),
		})
		.optional(),
	healthCheck: z
		.object({
			path: z.string().optional(),
			protocol: z.string().optional(),
		})
		.optional(),
	timestamp: z.string().optional(),
});

export const RenderWebhookResponseSchema = z.object({
	alertId: z.string().uuid(),
	incidentId: z.string().uuid().optional(),
	isNewIncident: z.boolean(),
});

// =============================================================================
// DEPLOY EVENT SCHEMAS (#854)
// =============================================================================

export const DeployStatusSchema = z.enum(["succeeded", "failed", "started"]);

export const DeployWebhookSchema = z.object({
	service: z.string().min(1),
	version: z.string().min(1),
	environment: z.string().min(1).default("production"),
	status: DeployStatusSchema.default("succeeded"),
	url: z.url({ protocol: /^https?$/ }).optional(),
	actor: z.string().optional(),
	/** The commit the deploy shipped, when it is not the version itself. */
	sha: z.string().optional(),
	/** When it happened; the receipt time when absent. */
	timestamp: z.iso.datetime({ offset: true }).optional(),
});

export const DeployWebhookResponseSchema = z.object({
	id: z.string().uuid(),
	/** False when the same service, version, environment and status was already recorded. */
	created: z.boolean(),
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
export type RenderWebhook = z.infer<typeof RenderWebhookSchema>;
export type RenderWebhookResponse = z.infer<typeof RenderWebhookResponseSchema>;
export type DeployWebhook = z.input<typeof DeployWebhookSchema>;
export type DeployWebhookResponse = z.infer<typeof DeployWebhookResponseSchema>;

// =============================================================================
// VENDOR ALERT SOURCES (Grafana, Datadog, Sentry, PagerDuty, CloudWatch via SNS, Azure Monitor, New Relic)
// =============================================================================

/** Each vendor's own body; the API maps it, so the contract only asks for a JSON object. */
export const AlertSourceWebhookSchema = z.record(z.string(), z.unknown());

export const AlertSourceWebhookResponseSchema = z.object({
	received: z.number().int(),
	processed: z.number().int(),
	alertIds: z.array(z.string().uuid()),
	incidentIds: z.array(z.string().uuid()),
	/** True when an SNS subscription handshake was answered. */
	confirmed: z.boolean().optional(),
});
