// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Alert route contracts
 */
import { oc } from "@orpc/contract";
import { z } from "zod";
import {
	AlertCorrelationResponseSchema,
	AlertDetailSchema,
	AlertQuerySchema,
	AlertSchema,
	AlertStatsSchema,
	AlertWithRelationsSchema,
	CorrelateAlertResponseSchema,
	CreateAlertSchema,
	IdParamSchema,
	paginatedResponseSchema,
	UpdateAlertSchema,
} from "../schemas/index.js";

export const alertsContract = {
	/**
	 * Create a new alert
	 * POST /alerts
	 */
	create: oc
		.route({
			method: "POST",
			path: "/alerts",
			summary: "Create a new alert",
			tags: ["alerts"],
		})
		.input(CreateAlertSchema)
		.output(AlertCorrelationResponseSchema),

	/**
	 * List alerts with filtering
	 * GET /alerts
	 */
	list: oc
		.route({
			method: "GET",
			path: "/alerts",
			summary: "List alerts with optional filtering",
			tags: ["alerts"],
		})
		.input(AlertQuerySchema)
		.output(paginatedResponseSchema(AlertWithRelationsSchema)),

	/**
	 * Get uncorrelated alerts
	 * GET /alerts/uncorrelated
	 */
	listUncorrelated: oc
		.route({
			method: "GET",
			path: "/alerts/uncorrelated",
			summary: "List alerts not yet correlated to incidents",
			tags: ["alerts"],
		})
		.input(
			z.object({ limit: z.coerce.number().int().min(1).max(100).default(100) }),
		)
		.output(z.array(AlertSchema)),

	/**
	 * Get alert statistics
	 * GET /alerts/stats
	 */
	getStats: oc
		.route({
			method: "GET",
			path: "/alerts/stats",
			summary: "Get alert statistics",
			tags: ["alerts"],
		})
		.input(z.object({}))
		.output(AlertStatsSchema),

	/**
	 * Get a single alert by ID
	 * GET /alerts/:id
	 *
	 * Carries `suppressedBy` — the enabled correlation rule currently holding a
	 * suppressed alert down, or `null` when nothing blocks re-correlation. Read
	 * it before offering a re-correlate control: while it is non-null,
	 * `POST /alerts/{id}/correlate` will refuse.
	 */
	get: oc
		.route({
			method: "GET",
			path: "/alerts/{id}",
			summary: "Get alert by ID",
			tags: ["alerts"],
		})
		.input(IdParamSchema)
		.output(AlertDetailSchema),

	/**
	 * Update an alert
	 * PATCH /alerts/:id
	 */
	update: oc
		.route({
			method: "PATCH",
			path: "/alerts/{id}",
			summary: "Update alert",
			tags: ["alerts"],
		})
		.input(IdParamSchema.merge(UpdateAlertSchema))
		.output(AlertSchema),

	/**
	 * Acknowledge an alert
	 * POST /alerts/:id/acknowledge
	 */
	acknowledge: oc
		.route({
			method: "POST",
			path: "/alerts/{id}/acknowledge",
			summary: "Acknowledge alert",
			tags: ["alerts"],
		})
		.input(IdParamSchema)
		.output(AlertSchema),

	/**
	 * Resolve an alert
	 * POST /alerts/:id/resolve
	 */
	resolve: oc
		.route({
			method: "POST",
			path: "/alerts/{id}/resolve",
			summary: "Resolve alert",
			tags: ["alerts"],
		})
		.input(IdParamSchema)
		.output(AlertSchema),

	/**
	 * Correlate an alert to an incident
	 * POST /alerts/:id/correlate
	 *
	 * This is also the un-suppression path (ADR-0028 §4): re-running the waterfall
	 * on a suppressed alert is how an operator gets it back onto an incident.
	 *
	 * Refuses with `CONFLICT` (409) when an enabled `suppress` rule still matches
	 * the alert, rather than silently re-suppressing and answering 200 with no
	 * incident. The error data is described by `SuppressedByRuleConflictSchema` —
	 * parse it to name the rule and act on it. The rule is never bypassed — the
	 * only way through is to disable it or amend its match criteria via
	 * `PATCH /correlation/rules/{id}`, after which this call succeeds.
	 */
	correlate: oc
		.route({
			method: "POST",
			path: "/alerts/{id}/correlate",
			summary: "Correlate alert to incident",
			tags: ["alerts"],
		})
		.input(IdParamSchema)
		.output(CorrelateAlertResponseSchema),

	/**
	 * Delete an alert
	 * DELETE /alerts/:id
	 */
	delete: oc
		.route({
			method: "DELETE",
			path: "/alerts/{id}",
			summary: "Delete alert",
			tags: ["alerts"],
		})
		.input(IdParamSchema)
		.output(z.void()),
};
