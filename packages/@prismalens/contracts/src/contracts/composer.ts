// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Composer drafts and the reference search (#1024).
 */
import { oc } from "@orpc/contract";
import { z } from "zod";
import {
	ComposerDraftSchema,
	DraftAttachmentParamSchema,
	DraftAttachmentSchema,
	DraftScopeParamSchema,
	PutDraftSchema,
	ReferenceResolveInputSchema,
	ReferenceResolveResultSchema,
	ReferenceSearchInputSchema,
	ReferenceSearchResultSchema,
	ReferenceUseSchema,
	ServedAttachmentSchema,
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

	/** GET /drafts/{scope}/attachments: the files the draft lists, in its order. */
	attachments: oc
		.route({
			method: "GET",
			path: "/drafts/{scope}/attachments",
			summary: "List the files a composer draft holds",
			tags: ["drafts"],
		})
		.input(DraftScopeParamSchema)
		.output(z.object({ attachments: z.array(DraftAttachmentSchema) })),

	/** GET /drafts/{scope}/attachments/{id}: the bytes, only for a file this draft lists. */
	attachment: oc
		.route({
			method: "GET",
			path: "/drafts/{scope}/attachments/{id}",
			summary: "Download a file a composer draft holds",
			tags: ["drafts"],
			outputStructure: "detailed",
		})
		.input(DraftAttachmentParamSchema)
		.output(ServedAttachmentSchema),
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

	/** POST /references/resolve: pasted links a connected source recognises, in input order. */
	resolve: oc
		.route({
			method: "POST",
			path: "/references/resolve",
			summary: "Resolve pasted links into references",
			tags: ["references"],
		})
		.input(ReferenceResolveInputSchema)
		.output(ReferenceResolveResultSchema),

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
