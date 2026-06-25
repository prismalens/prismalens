/**
 * Investigation route contracts
 */
import { oc } from "@orpc/contract";
import { z } from "zod";
import {
	AgentExecutionWithToolsSchema,
	CreateInvestigationSchema,
	IdParamSchema,
	InvestigationProgressSchema,
	InvestigationQuerySchema,
	InvestigationSchema,
	InvestigationStatusSchema,
	InvestigationWithRelationsSchema,
	ProgressSnapshotSchema,
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
	 * Run an investigation in-process with @prismalens/engine
	 * POST /investigations/:id/run
	 */
	run: oc
		.route({
			method: "POST",
			path: "/investigations/{id}/run",
			summary: "Run an investigation in-process with the engine",
			tags: ["investigations"],
		})
		.input(IdParamSchema)
		.output(InvestigationSchema),

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

	/**
	 * Get investigation progress from LangGraph checkpoints
	 * GET /investigations/:id/progress
	 */
	getProgress: oc
		.route({
			method: "GET",
			path: "/investigations/{id}/progress",
			summary: "Get real-time investigation progress from checkpoints",
			tags: ["investigations"],
		})
		.input(IdParamSchema)
		.output(InvestigationProgressSchema.nullable()),

	/**
	 * Get investigation progress history (all checkpoints)
	 * GET /investigations/:id/progress/history
	 */
	getProgressHistory: oc
		.route({
			method: "GET",
			path: "/investigations/{id}/progress/history",
			summary: "Get investigation progress history for timeline",
			tags: ["investigations"],
		})
		.input(IdParamSchema)
		.output(z.array(ProgressSnapshotSchema)),
};
