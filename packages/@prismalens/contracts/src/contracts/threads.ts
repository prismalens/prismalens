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
	LinkPullRequestSchema,
	PullRequestSchema,
	RenameThreadSchema,
	ResolvedLinksSchema,
	ResolveLinksSchema,
	ServedAttachmentSchema,
	SettledStateSchema,
	SettleThreadSchema,
	StartThreadResponseSchema,
	StartThreadSchema,
	ThreadContextSchema,
	ThreadFeedQuerySchema,
	ThreadFeedSchema,
	ThreadIdSchema,
	ThreadListQuerySchema,
	ThreadListSchema,
	ThreadPullRequestsSchema,
	ThreadSettingsSchema,
	UnlinkPullRequestSchema,
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
	 * Every thread in sections, an incident's threads paged as one unit
	 * GET /threads/feed
	 */
	feed: oc
		.route({
			method: "GET",
			path: "/threads/feed",
			summary: "List every thread in its section",
			tags: ["threads"],
		})
		.input(ThreadFeedQuerySchema)
		.output(ThreadFeedSchema),

	/**
	 * The operator opened the thread: its outcome counts as seen
	 * POST /threads/:id/visit
	 */
	visit: oc
		.route({
			method: "POST",
			path: "/threads/{id}/visit",
			summary: "Mark a thread seen",
			tags: ["threads"],
		})
		.input(ThreadIdSchema)
		.output(z.object({ lastVisitedAt: z.string() })),

	/**
	 * Settle a thread, or undo it; an incident's thread settles its block
	 * POST /threads/:id/settle
	 */
	settle: oc
		.route({
			method: "POST",
			path: "/threads/{id}/settle",
			summary: "Settle or unsettle a thread",
			tags: ["threads"],
		})
		.input(SettleThreadSchema)
		.output(
			z.object({
				ids: z.array(z.string()),
				previous: z.array(SettledStateSchema),
			}),
		),

	/**
	 * Name a thread; the agent never renames it after this
	 * POST /threads/:id/title
	 */
	rename: oc
		.route({
			method: "POST",
			path: "/threads/{id}/title",
			summary: "Rename a thread",
			tags: ["threads"],
		})
		.input(RenameThreadSchema)
		.output(z.object({ id: z.string(), title: z.string() })),

	/**
	 * When quiet threads settle on their own
	 * GET /threads/settings
	 */
	getSettings: oc
		.route({
			method: "GET",
			path: "/threads/settings",
			summary: "Read the thread list settings",
			tags: ["threads"],
		})
		.output(ThreadSettingsSchema),

	/**
	 * PUT /threads/settings
	 */
	updateSettings: oc
		.route({
			method: "PUT",
			path: "/threads/settings",
			summary: "Change the thread list settings",
			tags: ["threads"],
		})
		.input(ThreadSettingsSchema)
		.output(ThreadSettingsSchema),

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
			outputStructure: "detailed",
		})
		.input(GetAttachmentSchema)
		.output(ServedAttachmentSchema),

	/**
	 * What the right panel shows for this kind of thread (#1024)
	 * GET /threads/:id/context
	 */
	context: oc
		.route({
			method: "GET",
			path: "/threads/{id}/context",
			summary:
				"Read what a thread is about: machine, code, PRs, incident or schedule",
			tags: ["threads"],
		})
		.input(ThreadIdSchema)
		.output(ThreadContextSchema),

	/**
	 * The thread's pull requests, refreshed from the host when older than 60 s
	 * GET /threads/:id/pull-requests
	 */
	pullRequests: oc
		.route({
			method: "GET",
			path: "/threads/{id}/pull-requests",
			summary: "List a thread's pull requests with their state and checks",
			tags: ["threads"],
		})
		.input(ThreadIdSchema)
		.output(ThreadPullRequestsSchema),

	/**
	 * Link a pull request URL the user pasted
	 * POST /threads/:id/pull-requests
	 */
	linkPullRequest: oc
		.route({
			method: "POST",
			path: "/threads/{id}/pull-requests",
			summary: "Link a pull request to a thread",
			tags: ["threads"],
		})
		.input(LinkPullRequestSchema)
		.output(PullRequestSchema),

	/**
	 * DELETE /threads/:id/pull-requests/:prId
	 */
	unlinkPullRequest: oc
		.route({
			method: "DELETE",
			path: "/threads/{id}/pull-requests/{prId}",
			summary: "Unlink a pull request from a thread",
			tags: ["threads"],
		})
		.input(UnlinkPullRequestSchema)
		.output(z.object({ removed: z.boolean() })),

	/**
	 * Read every linked PR from its host now, and look the branch up again
	 * POST /threads/:id/pull-requests/refresh
	 */
	refreshPullRequests: oc
		.route({
			method: "POST",
			path: "/threads/{id}/pull-requests/refresh",
			summary: "Refresh a thread's pull requests from the git host",
			tags: ["threads"],
		})
		.input(ThreadIdSchema)
		.output(ThreadPullRequestsSchema),

	/**
	 * Which of the names the agent wrote exist, and what each opens
	 * POST /threads/:id/links/resolve
	 */
	resolveLinks: oc
		.route({
			method: "POST",
			path: "/threads/{id}/links/resolve",
			summary: "Resolve paths, URLs, threads and artifacts named in agent text",
			tags: ["threads"],
		})
		.input(ResolveLinksSchema)
		.output(ResolvedLinksSchema),
};
