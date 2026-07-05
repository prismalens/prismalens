// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Investigation route contracts
 */
import { oc } from "@orpc/contract";
import { z } from "zod";
import {
	AgentExecutionWithToolsSchema,
	CreateInvestigationSchema,
	GetInvestigationEventsSchema,
	IdParamSchema,
	InvestigationEventsPageSchema,
	InvestigationQuerySchema,
	InvestigationSchema,
	InvestigationStatusSchema,
	InvestigationWithRelationsSchema,
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
		.output(z.array(InvestigationWithRelationsSchema)),

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
	 * Get agent executions for an investigation
	 * GET /investigations/:id/agents
	 */
	getAgentExecutions: oc
		.route({
			method: "GET",
			path: "/investigations/{id}/agents",
			summary: "Get agent executions for investigation",
			tags: ["investigations"],
		})
		.input(IdParamSchema)
		.output(z.array(AgentExecutionWithToolsSchema)),

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
};
