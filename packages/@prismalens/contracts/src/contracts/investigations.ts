// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Investigation route contracts
 */
import { oc } from "@orpc/contract";
import {
	AnswerAskResultSchema,
	AnswerAskSchema,
	CreateInvestigationSchema,
	EvidenceBlobQuerySchema,
	EvidenceBlobSchema,
	GetInvestigationEventsSchema,
	HandoffPreviewQuerySchema,
	HandoffPreviewSchema,
	IdParamSchema,
	InvestigationEventsPageSchema,
	InvestigationQuerySchema,
	InvestigationReportMarkdownSchema,
	InvestigationSchema,
	InvestigationStatusSchema,
	InvestigationWithRelationsSchema,
	paginatedResponseSchema,
	SendInvestigationMessageResultSchema,
	SendInvestigationMessageSchema,
	UpdateInvestigationStatusSchema,
	WriteInvestigationResultSchema,
} from "../schemas/index.js";

export const investigationsContract = {
	/**
	 * Create a new investigation
	 * POST /investigations
	 */
	create: oc
		.route({
			method: "POST",
			path: "/investigations",
			summary: "Create a new investigation",
			tags: ["investigations"],
		})
		.input(CreateInvestigationSchema)
		.output(InvestigationSchema),

	/**
	 * List investigations with filtering
	 * GET /investigations
	 */
	list: oc
		.route({
			method: "GET",
			path: "/investigations",
			summary: "List investigations with optional filtering",
			tags: ["investigations"],
		})
		.input(InvestigationQuerySchema)
		.output(paginatedResponseSchema(InvestigationWithRelationsSchema)),

	/**
	 * Get a single investigation by ID
	 * GET /investigations/:id
	 */
	get: oc
		.route({
			method: "GET",
			path: "/investigations/{id}",
			summary: "Get investigation by ID",
			tags: ["investigations"],
		})
		.input(IdParamSchema)
		.output(InvestigationWithRelationsSchema),

	/**
	 * Get investigation status (includes job queue info)
	 * GET /investigations/:id/status
	 */
	getStatus: oc
		.route({
			method: "GET",
			path: "/investigations/{id}/status",
			summary: "Get investigation status with job queue info",
			tags: ["investigations"],
		})
		.input(IdParamSchema)
		.output(InvestigationStatusSchema),

	/**
	 * Get the durable canonical event record for replay/history (ADR-0018).
	 * Paginated by an exclusive `seq` cursor; events are parsed through the
	 * CanonicalEvent schema on the way out.
	 * GET /investigations/:id/events
	 */
	getEvents: oc
		.route({
			method: "GET",
			path: "/investigations/{id}/events",
			summary: "Get the durable canonical event record (replay/history)",
			tags: ["investigations"],
		})
		.input(GetInvestigationEventsSchema)
		.output(InvestigationEventsPageSchema),

	/**
	 * Cancel an investigation
	 * POST /investigations/:id/cancel
	 */
	cancel: oc
		.route({
			method: "POST",
			path: "/investigations/{id}/cancel",
			summary: "Cancel a running investigation",
			tags: ["investigations"],
		})
		.input(IdParamSchema)
		.output(InvestigationSchema),

	/**
	 * Send the operator's message to a live run (#743)
	 * POST /investigations/:id/messages
	 */
	message: oc
		.route({
			method: "POST",
			path: "/investigations/{id}/messages",
			summary: "Send a message to a running investigation",
			tags: ["investigations"],
			successStatus: 202,
		})
		.input(IdParamSchema.merge(SendInvestigationMessageSchema))
		.output(SendInvestigationMessageResultSchema)
		.errors({
			CONFLICT: {
				message:
					"The run ended, or has not started, before the message reached it",
			},
		}),

	/**
	 * What a finished run's follow-up would carry to the chosen agent, and whether it can take it
	 * GET /investigations/:id/handoff
	 */
	handoff: oc
		.route({
			method: "GET",
			path: "/investigations/{id}/handoff",
			summary:
				"Preview a follow-up's route, carried context and recipient preflight",
			tags: ["investigations"],
		})
		.input(IdParamSchema.merge(HandoffPreviewQuerySchema))
		.output(HandoffPreviewSchema)
		.errors({
			CONFLICT: {
				message: "The run is live, or kept nothing to continue from",
			},
		}),

	/**
	 * Approve or deny the agent's permission ask on a live run (#673 w21)
	 * POST /investigations/:id/asks/:askId
	 */
	answerAsk: oc
		.route({
			method: "POST",
			path: "/investigations/{id}/asks/{askId}",
			summary: "Answer the agent's permission ask",
			tags: ["investigations"],
		})
		.input(IdParamSchema.merge(AnswerAskSchema))
		.output(AnswerAskResultSchema)
		.errors({
			CONFLICT: {
				message:
					"The ask is no longer waiting: it was answered, timed out, or the run ended",
			},
		}),

	/**
	 * Update investigation status (Worker)
	 * PATCH /investigations/:id/status
	 */
	updateStatus: oc
		.route({
			method: "PATCH",
			path: "/investigations/{id}/status",
			summary: "Update investigation status",
			tags: ["investigations"],
		})
		.input(UpdateInvestigationStatusSchema)
		.output(InvestigationSchema),

	/**
	 * Write investigation result (Worker)
	 * POST /investigations/:id/result
	 */
	writeResult: oc
		.route({
			method: "POST",
			path: "/investigations/{id}/result",
			summary: "Write investigation result",
			tags: ["investigations"],
		})
		.input(WriteInvestigationResultSchema)
		.output(InvestigationWithRelationsSchema),

	/**
	 * A completed investigation's report as Markdown
	 * GET /investigations/:id/report.md
	 */
	exportMarkdown: oc
		.route({
			method: "GET",
			path: "/investigations/{id}/report.md",
			summary: "Export the report as Markdown",
			tags: ["investigations"],
		})
		.input(IdParamSchema)
		.output(InvestigationReportMarkdownSchema),

	/**
	 * A file the run read, at the commit it recorded: read-only, tracked blobs only
	 * GET /investigations/:id/blob?sha=&path=
	 */
	getBlob: oc
		.route({
			method: "GET",
			path: "/investigations/{id}/blob",
			summary: "Read a file at the commit the run recorded",
			tags: ["investigations"],
		})
		.input(EvidenceBlobQuerySchema)
		.output(EvidenceBlobSchema),
};
