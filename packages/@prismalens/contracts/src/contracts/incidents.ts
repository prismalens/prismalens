// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Incident route contracts
 */
import { oc } from "@orpc/contract";
import { z } from "zod";
import {
	AttachmentSchema,
	ChatIncidentSchema,
	CloseIncidentSchema,
	CreateIncidentSchema,
	GetAttachmentSchema,
	IdParamSchema,
	IncidentQuerySchema,
	IncidentSchema,
	IncidentStatsQuerySchema,
	IncidentStatsSchema,
	IncidentWithRelationsSchema,
	InvestigateIncidentResponseSchema,
	InvestigateIncidentSchema,
	InvestigationRefusalSchema,
	paginatedResponseSchema,
	UpdateIncidentSchema,
	UploadAttachmentSchema,
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
	getStats: oc
		.route({
			method: "GET",
			path: "/incidents/stats",
			summary:
				"Count incidents over a window: total, open, by status and severity, and what needs a human",
			tags: ["incidents"],
		})
		.input(IncidentStatsQuerySchema)
		.output(IncidentStatsSchema),

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
		.input(IdParamSchema.merge(InvestigateIncidentSchema))
		.output(InvestigateIncidentResponseSchema)
		.errors({
			PRECONDITION_FAILED: {
				data: InvestigationRefusalSchema,
				message: "Investigation cannot be started",
			},
		}),

	/**
	 * Start a chat run: a person's message is its first turn, and it ends with no report (#673)
	 * POST /incidents/:id/chat
	 */
	chat: oc
		.route({
			method: "POST",
			path: "/incidents/{id}/chat",
			summary: "Start a chat run on the incident",
			tags: ["incidents"],
		})
		.input(IdParamSchema.merge(ChatIncidentSchema))
		.output(InvestigateIncidentResponseSchema)
		.errors({
			PRECONDITION_FAILED: {
				data: InvestigationRefusalSchema,
				message: "Chat cannot be started",
			},
			CONFLICT: {
				data: z.object({ liveInvestigationId: z.string().uuid() }),
				message: "A run is working on this incident",
			},
		}),

	/**
	 * Attach a file for the agent, before the message or brief that carries it (R4.3)
	 * POST /incidents/:id/attachments
	 */
	uploadAttachment: oc
		.route({
			method: "POST",
			path: "/incidents/{id}/attachments",
			summary: "Attach an image or a text file for the agent",
			tags: ["incidents"],
		})
		.input(UploadAttachmentSchema)
		.output(AttachmentSchema),

	/**
	 * The attached file's bytes
	 * GET /incidents/:id/attachments/:attachmentId
	 */
	attachment: oc
		.route({
			method: "GET",
			path: "/incidents/{id}/attachments/{attachmentId}",
			summary: "Download an attached file",
			tags: ["incidents"],
		})
		.input(GetAttachmentSchema)
		.output(z.file()),

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
		.input(CloseIncidentSchema)
		.output(IncidentSchema),
};
