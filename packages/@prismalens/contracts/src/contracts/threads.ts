// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Thread route contracts (#1020): project, service and no-subject threads.
 */
import { oc } from "@orpc/contract";
import { z } from "zod";
import {
	AttachmentSchema,
	GetAttachmentSchema,
	InvestigationRefusalSchema,
	StartThreadResponseSchema,
	StartThreadSchema,
	ThreadListQuerySchema,
	ThreadListSchema,
	UploadDraftAttachmentSchema,
	UploadThreadAttachmentSchema,
} from "../schemas/index.js";

export const threadsContract = {
	/**
	 * Start a thread: its first message is the run's first turn
	 * POST /threads
	 */
	start: oc
		.route({
			method: "POST",
			path: "/threads",
			summary: "Start a project, service or no-subject thread",
			tags: ["threads"],
		})
		.input(StartThreadSchema)
		.output(StartThreadResponseSchema)
		.errors({
			PRECONDITION_FAILED: {
				data: InvestigationRefusalSchema,
				message: "The thread cannot be started",
			},
		}),

	/**
	 * A project's or service's threads, newest first
	 * GET /threads
	 */
	list: oc
		.route({
			method: "GET",
			path: "/threads",
			summary: "List threads on a project or service",
			tags: ["threads"],
		})
		.input(ThreadListQuerySchema)
		.output(ThreadListSchema),

	/**
	 * A file for a thread that does not exist yet; its start claims it
	 * POST /threads/drafts/:draftKey/attachments
	 */
	uploadDraftAttachment: oc
		.route({
			method: "POST",
			path: "/threads/drafts/{draftKey}/attachments",
			summary: "Attach a file before the thread starts",
			tags: ["threads"],
		})
		.input(UploadDraftAttachmentSchema)
		.output(AttachmentSchema),

	/**
	 * A file for a thread's next message
	 * POST /threads/:id/attachments
	 */
	uploadAttachment: oc
		.route({
			method: "POST",
			path: "/threads/{id}/attachments",
			summary: "Attach a file to a thread",
			tags: ["threads"],
		})
		.input(UploadThreadAttachmentSchema)
		.output(AttachmentSchema),

	/**
	 * The attached file's bytes
	 * GET /threads/:id/attachments/:attachmentId
	 */
	attachment: oc
		.route({
			method: "GET",
			path: "/threads/{id}/attachments/{attachmentId}",
			summary: "Download a thread's attached file",
			tags: ["threads"],
		})
		.input(GetAttachmentSchema)
		.output(z.file()),
};
