// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Webhook route contracts
 */
import { oc } from "@orpc/contract";
import { z } from "zod";

/** One delivery: when, how many alerts it carried, how many were taken. */
export const WebhookDeliverySchema = z.object({
	at: z.string(),
	received: z.number().int(),
	accepted: z.number().int(),
});
export type WebhookDelivery = z.infer<typeof WebhookDeliverySchema>;

import {
	GenericWebhookResponseSchema,
	GenericWebhookSchema,
	PrometheusWebhookResponseSchema,
	PrometheusWebhookSchema,
	RenderWebhookResponseSchema,
	RenderWebhookSchema,
} from "../schemas/index.js";

export const webhooksContract = {
	/**
	 * Receive Prometheus AlertManager webhook
	 * POST /webhooks/prometheus
	 */
	prometheus: oc
		.route({
			method: "POST",
			path: "/webhooks/prometheus",
			summary: "Receive Prometheus AlertManager webhook",
			tags: ["webhooks"],
		})
		.input(PrometheusWebhookSchema)
		.output(PrometheusWebhookResponseSchema),

	/**
	 * Receive generic webhook
	 * POST /webhooks/generic
	 */
	generic: oc
		.route({
			method: "POST",
			path: "/webhooks/generic",
			summary: "Receive generic alert webhook",
			tags: ["webhooks"],
		})
		.input(GenericWebhookSchema)
		.output(GenericWebhookResponseSchema),

	/**
	 * Receive Render deploy/health webhook
	 * POST /webhooks/render
	 */
	render: oc
		.route({
			method: "POST",
			path: "/webhooks/render",
			summary: "Receive Render deploy/health webhook",
			tags: ["webhooks"],
		})
		.input(RenderWebhookSchema)
		.output(RenderWebhookResponseSchema),

	/**
	 * The token a webhook sender presents. The operator's only (a loopback or
	 * signed-in caller, never a paired device), like managing pairing.
	 * GET /webhooks/token
	 */
	token: oc
		.route({
			method: "GET",
			path: "/webhooks/token",
			summary: "Read the token webhook senders present",
			tags: ["webhooks"],
		})
		.input(z.object({}))
		.output(z.object({ token: z.string() })),

	/**
	 * The last Alertmanager delivery the webhook took, for Settings, Alert sources.
	 * GET /webhooks/last-delivery
	 */
	lastDelivery: oc
		.route({
			method: "GET",
			path: "/webhooks/last-delivery",
			summary: "Read when the webhook last took a delivery, and what it held",
			tags: ["webhooks"],
		})
		.input(z.object({}))
		.output(WebhookDeliverySchema.nullable()),
};
