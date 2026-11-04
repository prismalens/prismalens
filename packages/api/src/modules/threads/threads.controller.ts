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
