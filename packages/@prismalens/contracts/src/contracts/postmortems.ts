// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Postmortem route contracts
 */
import { oc } from "@orpc/contract";
import { z } from "zod";
import {
	CreatePostmortemSchema,
	IdParamSchema,
	PostmortemSchema,
	PostmortemWithRelationsSchema,
	UpdatePostmortemSchema,
} from "../schemas/index.js";

export const postmortemsContract = {
	/**
	 * Get postmortem by incident ID
	 * GET /postmortems/incident/:incidentId
	 */
	getByIncidentId: oc
		.route({
			method: "GET",
			path: "/postmortems/incident/{incidentId}",
			summary: "Get postmortem by incident ID",
			tags: ["postmortems"],
		})
		.input(z.object({ incidentId: z.string().uuid() }))
		.output(PostmortemWithRelationsSchema.nullable()),

	/**
	 * Get postmortem by ID
	 * GET /postmortems/:id
	 */
	get: oc
		.route({
			method: "GET",
			path: "/postmortems/{id}",
			summary: "Get postmortem by ID",
			tags: ["postmortems"],
		})
		.input(IdParamSchema)
		.output(PostmortemWithRelationsSchema),

	/**
	 * Create a new postmortem
	 * POST /postmortems
	 */
	create: oc
		.route({
			method: "POST",
			path: "/postmortems",
			summary: "Create a new postmortem",
			tags: ["postmortems"],
		})
		.input(CreatePostmortemSchema)
		.output(PostmortemSchema),

	/**
	 * Update a postmortem
	 * PATCH /postmortems/:id
	 */
	update: oc
		.route({
			method: "PATCH",
			path: "/postmortems/{id}",
			summary: "Update postmortem",
			tags: ["postmortems"],
		})
		.input(
			z.object({
				id: z.string().uuid(),
				data: UpdatePostmortemSchema,
			}),
		)
		.output(PostmortemSchema),

	/**
	 * Publish a postmortem
	 * POST /postmortems/:id/publish
	 */
	publish: oc
		.route({
			method: "POST",
			path: "/postmortems/{id}/publish",
			summary: "Publish postmortem",
			tags: ["postmortems"],
		})
		.input(IdParamSchema)
		.output(PostmortemSchema),

	/**
	 * Delete a postmortem
	 * DELETE /postmortems/:id
	 */
	delete: oc
		.route({
			method: "DELETE",
			path: "/postmortems/{id}",
			summary: "Delete postmortem",
			tags: ["postmortems"],
		})
		.input(IdParamSchema)
		.output(z.void()),
};
