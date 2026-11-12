// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { OPERATE_SCOPE } from "@prismalens/auth";
import { threadsContract } from "@prismalens/contracts";
import type { Request } from "express";
import {
	isOwner,
	requireOperate,
	requireOwner,
} from "../../core/auth/owner.js";
import { CronService } from "../cron/cron.service.js";
import { AttachmentsService } from "../investigations/attachments.service.js";
import { LinksService } from "./links.service.js";
import { PrFeedService } from "./pr-feed.service.js";
import { PullRequestsService } from "./pull-requests.service.js";
import { ThreadContextService } from "./thread-context.service.js";
import { ThreadLifecycleService } from "./thread-lifecycle.service.js";
import { ThreadsService } from "./threads.service.js";

/** The device may start, continue and stop runs: the host's session, or a device paired to. */
function canOperate(request: unknown): boolean {
	return !!(request as Request | undefined)?.operator?.device.scopes.includes(
		OPERATE_SCOPE,
	);
}

@Controller()
export class ThreadsController {
	constructor(
		private readonly threads: ThreadsService,
		private readonly attachments: AttachmentsService,
		private readonly context: ThreadContextService,
		private readonly pullRequests: PullRequestsService,
		private readonly links: LinksService,
		private readonly feed: PrFeedService,
		private readonly cronJobs: CronService,
		private readonly lifecycle: ThreadLifecycleService,
	) {}

	@Implement(threadsContract)
	routes() {
		return {
			// POST /threads - The first message starts a project, service or no-subject thread (#1020)
			start: implement(threadsContract.start).handler(({ input, context }) => {
				requireOperate(context.request);
				return this.threads.start(input);
			}),

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
			// Settling that ends a run, job, child or worktree takes Stop's permission (#1024 surface F)
			settle: implement(threadsContract.settle).handler(({ input, context }) =>
				this.threads.settle(input.id, input.settled, input.restore, {
					...(input.stopRunning ? { stopRunning: true } : {}),
					operate: canOperate(context.request),
				}),
			),

			// GET /threads/:id/settle-preview - What settling would end (#1024 surface F)
			settlePreview: implement(threadsContract.settlePreview).handler(
				({ input }) => this.lifecycle.preview(input.id),
			),

			// POST /threads/:id/pull-requests/:prId/watch
			watchPullRequest: implement(threadsContract.watchPullRequest).handler(
				({ input, context }) => {
					requireOperate(context.request);
					return this.feed.watch(input.id, input.prId);
				},
			),

			// DELETE /threads/:id/pull-requests/:prId/watch
			unwatchPullRequest: implement(threadsContract.unwatchPullRequest).handler(
				({ input, context }) => {
					requireOperate(context.request);
					return this.feed.unwatch(input.id, input.prId);
				},
			),

			// GET /threads/:id/pull-requests/:prId/checks/:runId/log - Read once per head commit
			prCheckLog: implement(threadsContract.prCheckLog).handler(({ input }) =>
				this.pullRequests.checkLog(input.id, input.prId, input.runId),
			),

			// GET /threads/:id/cron - The thread's Scheduled section
			cron: implement(threadsContract.cron).handler(async ({ input }) => ({
				jobs: await this.cronJobs.list(input.id),
			})),

			// DELETE /threads/:id/cron/:jobId
			deleteCron: implement(threadsContract.deleteCron).handler(
				async ({ input, context }) => {
					requireOperate(context.request);
					return {
						removed: await this.cronJobs.remove(input.id, input.jobId),
					};
				},
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
				({ input, context }) => {
					requireOwner(
						context.request,
						"Only the owner can change thread settings.",
					);
					return this.threads.updateSettings(input);
				},
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
					this.context.context(input.id, isOwner(context.request)),
			),

			// GET /threads/:id/pull-requests - Read from the host only when older than 60 s
			pullRequests: implement(threadsContract.pullRequests).handler(
				async ({ input }) =>
					this.feed.withWatches(
						input.id,
						await this.pullRequests.list(input.id),
					),
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
			).handler(async ({ input }) =>
				this.feed.withWatches(
					input.id,
					await this.pullRequests.list(input.id, { force: true }),
				),
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
