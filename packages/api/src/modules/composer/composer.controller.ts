// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { draftsContract, referencesContract } from "@prismalens/contracts";
import { ReferencesService } from "../references/references.service.js";
import { DraftsService } from "./drafts.service.js";

@Controller()
export class DraftsController {
	constructor(private readonly drafts: DraftsService) {}

	@Implement(draftsContract)
	routes() {
		return {
			// GET /drafts/:scope
			get: implement(draftsContract.get).handler(({ input }) =>
				this.drafts.get(input.scope),
			),
			// PUT /drafts/:scope - 409 carries the current draft
			put: implement(draftsContract.put).handler(({ input }) =>
				this.drafts.put(input),
			),
			// DELETE /drafts/:scope
			delete: implement(draftsContract.delete).handler(({ input }) =>
				this.drafts.delete(input.scope),
			),
			// GET /drafts/:scope/attachments
			attachments: implement(draftsContract.attachments).handler(
				async ({ input }) => ({
					attachments: await this.drafts.attachments(input.scope),
				}),
			),
			// GET /drafts/:scope/attachments/:id - only a file this draft lists
			attachment: implement(draftsContract.attachment).handler(({ input }) =>
				this.drafts.attachment(input.scope, input.id),
			),
		};
	}
}

@Controller()
export class ReferencesController {
	constructor(private readonly references: ReferencesService) {}

	@Implement(referencesContract)
	routes() {
		return {
			// GET /references/search - `/`, `@`, `#` and Ctrl K (#1024)
			search: implement(referencesContract.search).handler(({ input }) =>
				this.references.search(input),
			),
			// POST /references/resolve - pasted links, in input order
			resolve: implement(referencesContract.resolve).handler(({ input }) =>
				this.references.resolveUrls(input.urls),
			),
			// POST /references/uses
			use: implement(referencesContract.use).handler(async ({ input }) => {
				await this.references.use([input]);
			}),
		};
	}
}
