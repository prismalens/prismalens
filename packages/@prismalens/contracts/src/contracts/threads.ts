// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Thread route contracts (#1020): project, service and no-subject threads.
 */
import { oc } from "@orpc/contract";
import { z } from "zod";
import {
	AttachmentSchema,
	DeleteCronJobSchema,
	ForkThreadResponseSchema,
	ForkThreadSchema,
	GetAttachmentSchema,
	InvestigationRefusalSchema,
	LinkPullRequestSchema,
	PrCheckLogInputSchema,
	PrCheckLogSchema,
	PullRequestSchema,
	RenameThreadSchema,
	ResolvedLinksSchema,
	ResolveLinksSchema,
	SearchMessagesInputSchema,
	SearchMessagesSchema,
	ServedAttachmentSchema,
	SettlePreviewSchema,
	SettleRefusalSchema,
	SettleResponseSchema,
	SettleThreadSchema,
	StartThreadResponseSchema,
	StartThreadSchema,
	ThreadAsksSchema,
	ThreadContextSchema,
	ThreadCronSchema,
	ThreadFeedQuerySchema,
	ThreadFeedSchema,
	ThreadFlagResponseSchema,
	ThreadFlagSchema,
	ThreadIdSchema,
	ThreadListQuerySchema,
	ThreadListSchema,
	ThreadPullRequestsSchema,
	ThreadSettingsSchema,
	ThreadStatusesInputSchema,
	ThreadStatusesSchema,
	UnlinkPullRequestSchema,
	UploadDraftAttachmentSchema,
	UploadThreadAttachmentSchema,
	WatchPullRequestSchema,
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

	/** Message text across threads, newest activity first; `next` walks on past them (#1101 cat 13). */
	searchMessages: oc
		.route({
			method: "GET",
			path: "/threads/search-messages",
			summary: "Find message text across threads",
			tags: ["threads"],
		})
		.input(SearchMessagesInputSchema)
		.output(SearchMessagesSchema),

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
	 * Every open ask across threads, for answering from the list (#1101 category 8)
	 * GET /threads/asks
	 */
	asks: oc
		.route({
			method: "GET",
			path: "/threads/asks",
			summary: "List open asks across threads",
			tags: ["threads"],
		})
		.output(ThreadAsksSchema),

	/**
	 * The status of each named thread: the header, the panel roster and schedule runs read it
	 * POST /threads/statuses
	 */
	statuses: oc
		.route({
			method: "POST",
			path: "/threads/statuses",
			summary: "Read the status of each named thread",
			tags: ["threads"],
		})
		.input(ThreadStatusesInputSchema)
		.output(ThreadStatusesSchema),

	/**
	 * Pin or unpin a thread
	 * POST /threads/:id/pin
	 */
	pin: oc
		.route({
			method: "POST",
			path: "/threads/{id}/pin",
			summary: "Pin or unpin a thread",
			tags: ["threads"],
		})
		.input(ThreadFlagSchema)
		.output(ThreadFlagResponseSchema),

	/**
	 * Archive or unarchive a thread: archived threads leave the list
	 * POST /threads/:id/archive
	 */
	archive: oc
		.route({
			method: "POST",
			path: "/threads/{id}/archive",
			summary: "Archive or unarchive a thread",
			tags: ["threads"],
		})
		.input(ThreadFlagSchema)
		.output(ThreadFlagResponseSchema)
		.errors({
			CONFLICT: { message: "A running thread cannot be archived" },
		}),

	/**
	 * Fork here or ask a side question: a child thread that reads this one
	 * POST /threads/:id/fork
	 */
	fork: oc
		.route({
			method: "POST",
			path: "/threads/{id}/fork",
			summary: "Start a child thread from this one",
			tags: ["threads"],
		})
		.input(ForkThreadSchema)
		.output(ForkThreadResponseSchema)
		.errors({
			PRECONDITION_FAILED: {
				data: InvestigationRefusalSchema,
				message: "The child thread cannot be started",
			},
		}),

	/**
	 * Keep as thread: a side question becomes a fork, listed in the tree
	 * POST /threads/:id/keep
	 */
	keep: oc
		.route({
			method: "POST",
			path: "/threads/{id}/keep",
			summary: "Keep a side question as a forked thread",
			tags: ["threads"],
		})
		.input(ThreadIdSchema)
		.output(z.object({ id: z.string() }))
		.errors({
			NOT_FOUND: { message: "No side question with that id" },
		}),

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
		.output(SettleResponseSchema)
		.errors({
			CONFLICT: {
				data: SettleRefusalSchema,
				message: "The thread cannot be settled as asked",
			},
		}),

	/**
	 * What settling would end: wakes, watches, cron jobs, children, runs, worktrees
	 * GET /threads/:id/settle-preview
	 */
	settlePreview: oc
		.route({
			method: "GET",
			path: "/threads/{id}/settle-preview",
			summary: "Preview what settling a thread would end",
			tags: ["threads"],
		})
		.input(ThreadIdSchema)
		.output(SettlePreviewSchema),

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
	 * Watch a linked PR: its status changes reach the agent (#1024 surface F)
	 * POST /threads/:id/pull-requests/:prId/watch
	 */
	watchPullRequest: oc
		.route({
			method: "POST",
			path: "/threads/{id}/pull-requests/{prId}/watch",
			summary: "Watch a pull request for status changes",
			tags: ["threads"],
		})
		.input(WatchPullRequestSchema)
		.output(PullRequestSchema),

	/**
	 * DELETE /threads/:id/pull-requests/:prId/watch
	 */
	unwatchPullRequest: oc
		.route({
			method: "DELETE",
			path: "/threads/{id}/pull-requests/{prId}/watch",
			summary: "Stop watching a pull request",
			tags: ["threads"],
		})
		.input(WatchPullRequestSchema)
		.output(PullRequestSchema),

	/**
	 * One check's log tail, read from the host once per head commit (#1101 category 15)
	 * GET /threads/:id/pull-requests/:prId/checks/:runId/log
	 */
	prCheckLog: oc
		.route({
			method: "GET",
			path: "/threads/{id}/pull-requests/{prId}/checks/{runId}/log",
			summary: "Read a pull request check's log tail",
			tags: ["threads"],
		})
		.input(PrCheckLogInputSchema)
		.output(PrCheckLogSchema),

	/**
	 * The thread's cron jobs, for its Scheduled section (#1024 surface F)
	 * GET /threads/:id/cron
	 */
	cron: oc
		.route({
			method: "GET",
			path: "/threads/{id}/cron",
			summary: "List a thread's cron jobs",
			tags: ["threads"],
		})
		.input(ThreadIdSchema)
		.output(ThreadCronSchema),

	/**
	 * DELETE /threads/:id/cron/:jobId
	 */
	deleteCron: oc
		.route({
			method: "DELETE",
			path: "/threads/{id}/cron/{jobId}",
			summary: "Delete one of a thread's cron jobs",
			tags: ["threads"],
		})
		.input(DeleteCronJobSchema)
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
