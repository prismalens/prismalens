// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { threadsContract } from "@prismalens/contracts";
import type { Request } from "express";
import { isHost } from "../../core/settings/settings.controller.js";
import { AttachmentsService } from "../investigations/attachments.service.js";
import { LinksService } from "./links.service.js";
import { PullRequestsService } from "./pull-requests.service.js";
import { ThreadContextService } from "./thread-context.service.js";
import { ThreadsService } from "./threads.service.js";

@Controller()
export class ThreadsController {
	constructor(
		private readonly threads: ThreadsService,
		private readonly attachments: AttachmentsService,
		private readonly context: ThreadContextService,
		private readonly pullRequests: PullRequestsService,
		private readonly links: LinksService,
	) {}

	@Implement(threadsContract)
	routes() {
		return {
			// POST /threads - The first message starts a project, service or no-subject thread (#1020)
			start: implement(threadsContract.start).handler(({ input }) =>
				this.threads.start(input),
			),

			// GET /threads - A project's or a service's threads
			list: implement(threadsContract.list).handler(async ({ input }) => ({
				data: await this.threads.list(input),
			})),

			// GET /threads/feed - Every thread in its section (#1020)
			feed: implement(threadsContract.feed).handler(({ input }) =>
				this.threads.feed(input),
			),

			// POST /threads/:id/visit
			visit: implement(threadsContract.visit).handler(({ input }) =>
				this.threads.visit(input.id),
			),

			// POST /threads/:id/settle
			settle: implement(threadsContract.settle).handler(({ input }) =>
				this.threads.settle(input.id, input.settled, input.restore),
			),

			// POST /threads/:id/title - The user names it; the agent never renames it after
			rename: implement(threadsContract.rename).handler(({ input }) =>
				this.threads.rename(input.id, input.title),
			),

			// GET /threads/settings
			getSettings: implement(threadsContract.getSettings).handler(() =>
				this.threads.getSettings(),
			),

			// PUT /threads/settings
			updateSettings: implement(threadsContract.updateSettings).handler(
				({ input }) => this.threads.updateSettings(input),
			),

			// POST /threads/drafts/:draftKey/attachments
			uploadDraftAttachment: implement(
				threadsContract.uploadDraftAttachment,
			).handler(({ input }) =>
				this.attachments.uploadDraft(input.draftKey, input.file),
			),

			// POST /threads/:id/attachments
			uploadAttachment: implement(threadsContract.uploadAttachment).handler(
				({ input }) => this.attachments.uploadForRun(input.id, input.file),
			),

			// GET /threads/:id/attachments/:attachmentId
			attachment: implement(threadsContract.attachment).handler(({ input }) =>
				this.attachments.readForRun(input.id, input.attachmentId),
			),

			// GET /threads/:id/context - What the right panel shows (#1024)
			context: implement(threadsContract.context).handler(
				({ input, context }) =>
					this.context.context(input.id, isHost(context.request as Request)),
			),

			// GET /threads/:id/pull-requests - Read from the host only when older than 60 s
			pullRequests: implement(threadsContract.pullRequests).handler(
				({ input }) => this.pullRequests.list(input.id),
			),

			// POST /threads/:id/pull-requests
			linkPullRequest: implement(threadsContract.linkPullRequest).handler(
				({ input }) => this.pullRequests.linkFromUser(input.id, input.url),
			),

			// DELETE /threads/:id/pull-requests/:prId
			unlinkPullRequest: implement(threadsContract.unlinkPullRequest).handler(
				async ({ input }) => ({
					removed: await this.pullRequests.unlink(input.id, input.prId),
				}),
			),

			// POST /threads/:id/pull-requests/refresh
			refreshPullRequests: implement(
				threadsContract.refreshPullRequests,
			).handler(({ input }) =>
				this.pullRequests.list(input.id, { force: true }),
			),

			// POST /threads/:id/links/resolve
			resolveLinks: implement(threadsContract.resolveLinks).handler(
				async ({ input }) => ({
					targets: await this.links.resolve(input.id, input.candidates),
				}),
			),
		};
	}
}
