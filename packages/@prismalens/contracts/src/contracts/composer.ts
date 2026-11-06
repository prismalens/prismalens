// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Composer drafts and the reference search (#1024).
 */
import { oc } from "@orpc/contract";
import { z } from "zod";
import {
	ComposerDraftSchema,
	DraftScopeParamSchema,
	PutDraftSchema,
	ReferenceSearchInputSchema,
	ReferenceSearchResultSchema,
	ReferenceUseSchema,
} from "../schemas/index.js";

export const draftsContract = {
	/** GET /drafts/{scope}: null when the scope keeps no draft. */
	get: oc
		.route({
			method: "GET",
			path: "/drafts/{scope}",
			summary: "Read the composer draft for a thread or a new-thread scope",
			tags: ["drafts"],
		})
		.input(DraftScopeParamSchema)
		.output(ComposerDraftSchema.nullable()),

	/** PUT /drafts/{scope}: a stale `baseRev` or `generation` gets 409 with the current draft. */
	put: oc
		.route({
			method: "PUT",
			path: "/drafts/{scope}",
			summary: "Save the composer draft",
			tags: ["drafts"],
		})
		.input(PutDraftSchema)
		.output(ComposerDraftSchema)
		.errors({
			CONFLICT: {
				data: z.object({ current: ComposerDraftSchema }),
				message: "A newer draft was saved, or this draft was sent",
			},
		}),

	/** DELETE /drafts/{scope} */
	delete: oc
		.route({
			method: "DELETE",
			path: "/drafts/{scope}",
			summary: "Discard the composer draft",
			tags: ["drafts"],
		})
		.input(DraftScopeParamSchema)
		.output(z.object({ deleted: z.boolean() })),
};

export const referencesContract = {
	/** GET /references/search: `/`, `@`, `#` and Ctrl K. */
	search: oc
		.route({
			method: "GET",
			path: "/references/search",
			summary: "Search what a message can do or refer to",
			tags: ["references"],
		})
		.input(ReferenceSearchInputSchema)
		.output(ReferenceSearchResultSchema),

	/** POST /references/uses: the user picked a hit; it ranks higher next time. */
	use: oc
		.route({
			method: "POST",
			path: "/references/uses",
			summary: "Record a picked reference for ranking",
			tags: ["references"],
			successStatus: 204,
		})
		.input(ReferenceUseSchema)
		.output(z.void()),
};
