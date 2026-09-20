// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Incident route contracts
 */
import { oc } from "@orpc/contract";
import {
	CreateIncidentSchema,
	IdParamSchema,
	IncidentQuerySchema,
	IncidentSchema,
	IncidentWithRelationsSchema,
	InvestigateIncidentResponseSchema,
	InvestigationRefusalSchema,
	paginatedResponseSchema,
	UpdateIncidentSchema,
} from "../schemas/index.js";

export const incidentsContract = {
	/**
	 * Create a new incident
	 * POST /incidents
	 */
	create: oc
		.route({
			method: "POST",
			path: "/incidents",
			summary: "Create a new incident",
			tags: ["incidents"],
		})
		.input(CreateIncidentSchema)
		.output(IncidentSchema),

	/**
	 * List incidents with filtering
	 * GET /incidents
	 */
	list: oc
		.route({
			method: "GET",
			path: "/incidents",
			summary: "List incidents with optional filtering",
			tags: ["incidents"],
		})
		.input(IncidentQuerySchema)
		.output(paginatedResponseSchema(IncidentWithRelationsSchema)),

	/**
	 * Get a single incident by ID
	 * GET /incidents/:id
	 */
	get: oc
		.route({
			method: "GET",
			path: "/incidents/{id}",
			summary: "Get incident by ID",
			tags: ["incidents"],
		})
		.input(IdParamSchema)
		.output(IncidentWithRelationsSchema),

	/**
	 * Update an incident
	 * PATCH /incidents/:id
	 */
	update: oc
		.route({
			method: "PATCH",
			path: "/incidents/{id}",
			summary: "Update incident",
			tags: ["incidents"],
		})
		.input(IdParamSchema.merge(UpdateIncidentSchema))
		.output(IncidentSchema),

	/**
	 * Start investigation for an incident
	 * POST /incidents/:id/investigate
	 */
	investigate: oc
		.route({
			method: "POST",
			path: "/incidents/{id}/investigate",
			summary: "Start AI investigation for incident",
			tags: ["incidents"],
		})
		.input(IdParamSchema)
		.output(InvestigateIncidentResponseSchema)
		.errors({
			PRECONDITION_FAILED: {
				data: InvestigationRefusalSchema,
				message: "Investigation cannot be started",
			},
		}),

	/**
	 * Resolve an incident
	 * POST /incidents/:id/resolve
	 */
	resolve: oc
		.route({
			method: "POST",
			path: "/incidents/{id}/resolve",
			summary: "Resolve incident",
			tags: ["incidents"],
		})
		.input(IdParamSchema)
		.output(IncidentSchema),

	/**
	 * Close a resolved incident
	 * POST /incidents/:id/close
	 */
	close: oc
		.route({
			method: "POST",
			path: "/incidents/{id}/close",
			summary: "Close incident",
			tags: ["incidents"],
		})
		.input(IdParamSchema)
		.output(IncidentSchema),
};
