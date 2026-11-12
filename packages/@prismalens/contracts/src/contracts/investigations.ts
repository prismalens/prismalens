// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Investigation route contracts
 */
import { oc } from "@orpc/contract";
import { z } from "zod";
import {
	AnswerAskResultSchema,
	AnswerAskSchema,
	AnswerSecretResultSchema,
	AnswerSecretSchema,
	CancelSubagentResultSchema,
	CancelSubagentSchema,
	CompactInvestigationSchema,
	CreateInvestigationSchema,
	EditQueuedMessageSchema,
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
	QueuedMessageChangeResultSchema,
	RestartSummarySchema,
	RevertChangesInputSchema,
	RevertChangesResultSchema,
	RunDiffQuerySchema,
	RunDiffSchema,
	RunTreeQuerySchema,
	RunTreeSchema,
	SendInvestigationMessageResultSchema,
	SendInvestigationMessageSchema,
	SetAutoResumeSchema,
	UpdateInvestigationStatusSchema,
	WithdrawQueuedMessageSchema,
	WorktreeChangesQuerySchema,
	WorktreeChangesSchema,
	WorktreeFileContentSchema,
	WorktreeFileQuerySchema,
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
	 * Change a queued message's text before the agent claims it (#1024)
	 * PATCH /investigations/:id/messages/:messageId
	 */
	editMessage: oc
		.route({
			method: "PATCH",
			path: "/investigations/{id}/messages/{messageId}",
			summary: "Edit a queued message before the agent reads it",
			tags: ["investigations"],
		})
		.input(IdParamSchema.merge(EditQueuedMessageSchema))
		.output(QueuedMessageChangeResultSchema)
		.errors({
			ALREADY_DELIVERED: {
				status: 409,
				message: "The agent already read the message, or it was never queued",
			},
		}),

	/**
	 * Take back a queued message before the agent claims it (#1024)
	 * DELETE /investigations/:id/messages/:messageId
	 */
	withdrawMessage: oc
		.route({
			method: "DELETE",
			path: "/investigations/{id}/messages/{messageId}",
			summary: "Withdraw a queued message before the agent reads it",
			tags: ["investigations"],
		})
		.input(IdParamSchema.merge(WithdrawQueuedMessageSchema))
		.output(QueuedMessageChangeResultSchema)
		.errors({
			ALREADY_DELIVERED: {
				status: 409,
				message: "The agent already read the message, or it was never queued",
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
			summary: "Answer one of the run's asks: permission, question or input",
			tags: ["investigations"],
		})
		.input(IdParamSchema.merge(AnswerAskSchema))
		.output(AnswerAskResultSchema)
		.errors({
			CONFLICT: {
				message:
					"The ask is no longer waiting: it was answered, timed out, or the run ended",
			},
			FORBIDDEN: {
				message: "Only the owner can answer this ask",
			},
		}),

	/**
	 * Stop one sub-agent the agent started in its session (#1025). Host only, and
	 * only when the agent granted that sub-agent's cancel.
	 * POST /investigations/:id/subagents/:sessionId/cancel
	 */
	cancelSubagent: oc
		.route({
			method: "POST",
			path: "/investigations/{id}/subagents/{sessionId}/cancel",
			summary: "Stop one sub-agent, when its agent allows it",
			tags: ["investigations"],
		})
		.input(CancelSubagentSchema)
		.output(CancelSubagentResultSchema)
		.errors({
			CONFLICT: { message: "The sub-agent is not running, or its run ended" },
			FORBIDDEN: {
				message: "Only the owner can stop it, and only when its agent allows",
			},
		}),

	/**
	 * Hand a run the secret it asked for (#1024 spec B). Write-only and host only:
	 * nothing answers the value back, and no event, log or push carries it.
	 * POST /investigations/:id/secrets/:requestId
	 */
	answerSecret: oc
		.route({
			method: "POST",
			path: "/investigations/{id}/secrets/{requestId}",
			summary: "Give a run the secret it asked for, write-only",
			tags: ["investigations"],
		})
		.input(AnswerSecretSchema)
		.output(AnswerSecretResultSchema)
		.errors({
			CONFLICT: { message: "The request is no longer waiting" },
			FORBIDDEN: { message: "Only the owner can answer this" },
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

	/**
	 * One directory of a commit the run recorded (#973)
	 * GET /investigations/:id/tree?sha=&prefix=
	 */
	getTree: oc
		.route({
			method: "GET",
			path: "/investigations/{id}/tree",
			summary: "List one directory at a commit the run recorded",
			tags: ["investigations"],
		})
		.input(RunTreeQuerySchema)
		.output(RunTreeSchema),

	/**
	 * The diff of a commit pair the run recorded when it started (#973)
	 * GET /investigations/:id/diff?pair=&path=
	 */
	getDiff: oc
		.route({
			method: "GET",
			path: "/investigations/{id}/diff",
			summary: "Diff a commit pair the run recorded",
			tags: ["investigations"],
		})
		.input(RunDiffQuerySchema)
		.output(RunDiffSchema),

	/**
	 * The run's live workspace against the commit it started at (#1020)
	 * GET /investigations/:id/changes
	 */
	getChanges: oc
		.route({
			method: "GET",
			path: "/investigations/{id}/changes",
			summary: "Diff a run's live workspace against the commit it started at",
			tags: ["investigations"],
		})
		.input(WorktreeChangesQuerySchema)
		.output(WorktreeChangesSchema),

	/**
	 * One file's text at a commit the Changes tab showed (#1101 category 16)
	 * GET /investigations/:id/changes/file?repo=&commit=&path=
	 */
	getChangesFile: oc
		.route({
			method: "GET",
			path: "/investigations/{id}/changes/file",
			summary: "Read one file at a commit of the thread's diff",
			tags: ["investigations"],
		})
		.input(WorktreeFileQuerySchema)
		.output(WorktreeFileContentSchema),

	/**
	 * Revert a file, a hunk or a turn in the thread's own worktree, or undo a revert (#1101 category 16)
	 * POST /investigations/:id/changes/revert
	 */
	revertChanges: oc
		.route({
			method: "POST",
			path: "/investigations/{id}/changes/revert",
			summary: "Revert a file, hunk or turn in the thread's worktree",
			tags: ["investigations"],
		})
		.input(RevertChangesInputSchema)
		.output(RevertChangesResultSchema),

	/**
	 * Take up a run a restart cut off and PrismaLens did not resume itself (#981)
	 * POST /investigations/:id/resume
	 */
	resume: oc
		.route({
			method: "POST",
			path: "/investigations/{id}/resume",
			summary: "Resume a run a restart interrupted",
			tags: ["investigations"],
		})
		.input(IdParamSchema)
		.output(InvestigationSchema)
		.errors({
			CONFLICT: {
				message: "The run was not interrupted by a restart, or is live",
			},
		}),

	/**
	 * Compact a finished thread's session with its agent's own command (#1024)
	 * POST /investigations/:id/compact
	 */
	compact: oc
		.route({
			method: "POST",
			path: "/investigations/{id}/compact",
			summary: "Compact a finished thread's session",
			tags: ["investigations"],
			successStatus: 202,
		})
		.input(IdParamSchema.merge(CompactInvestigationSchema))
		.output(InvestigationSchema)
		.errors({
			CONFLICT: {
				message:
					"The thread is running, or its agent has no compact command or no session",
			},
		}),

	/**
	 * Turn the resume after a usage limit on or off for one thread (#1024)
	 * PUT /investigations/:id/auto-resume
	 */
	setAutoResume: oc
		.route({
			method: "PUT",
			path: "/investigations/{id}/auto-resume",
			summary: "Resume this thread when its usage limit resets",
			tags: ["investigations"],
		})
		.input(IdParamSchema.merge(SetAutoResumeSchema))
		.output(InvestigationSchema),

	/**
	 * What the last start did with the runs a stop cut off (#981)
	 * GET /restart
	 */
	restartSummary: oc
		.route({
			method: "GET",
			path: "/restart",
			summary: "The runs the last start resumed and the ones it could not",
			tags: ["investigations"],
		})
		.input(z.object({}))
		.output(RestartSummarySchema),
};
