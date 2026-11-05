// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { threadsContract } from "@prismalens/contracts";
import { AttachmentsService } from "../investigations/attachments.service.js";
import { ThreadsService } from "./threads.service.js";

@Controller()
export class ThreadsController {
	constructor(
		private readonly threads: ThreadsService,
		private readonly attachments: AttachmentsService,
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
				this.threads.settle(input.id, input.settled),
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
		};
	}
}
