// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Repository route contracts
 */
import { oc } from "@orpc/contract";
import { z } from "zod";
import {
	AddRepositorySourceSchema,
	BrowseFoldersResultSchema,
	BrowseFoldersSchema,
	IdParamSchema,
	LinkRepositorySchema,
	PaginationSchema,
	RepositorySchema,
	RepositoryWithServicesSchema,
	ServiceRepositorySchema,
	SetRepositoryCredentialSchema,
} from "../schemas/index.js";
import { ProjectScriptsSchema } from "../schemas/thread-context.js";

export const repositoriesContract = {
	/**
	 * Name a service's code as a local folder or a git URL; validates it and links it as primary (ADR 0004 §2)
	 * POST /repositories/source
	 */
	addSource: oc
		.route({
			method: "POST",
			path: "/repositories/source",
			summary:
				"Add a repository by folder path or git URL and link it to a service",
			tags: ["repositories"],
		})
		.input(AddRepositorySourceSchema)
		.output(RepositorySchema),

	/**
	 * List the folders in a folder on the host, for the Add project browser (#1020). Host only.
	 * POST /fs/folders
	 */
	browseFolders: oc
		.route({
			method: "POST",
			path: "/fs/folders",
			summary: "List the folders inside a folder on this computer",
			tags: ["repositories"],
		})
		.input(BrowseFoldersSchema)
		.output(BrowseFoldersResultSchema),

	/**
	 * Start git in a plain folder project: init plus a first commit of what git does not ignore (#1020). Host only.
	 * POST /repositories/:id/git
	 */
	startGit: oc
		.route({
			method: "POST",
			path: "/repositories/{id}/git",
			summary: "Start git in a plain folder project",
			tags: ["repositories"],
		})
		.input(IdParamSchema)
		.output(RepositorySchema),

	/**
	 * Pin a saved git host token to a repository, or set it back to Auto, then validate again (#673)
	 * PATCH /repositories/:id/credential
	 */
	setCredential: oc
		.route({
			method: "PATCH",
			path: "/repositories/{id}/credential",
			summary: "Choose the saved token a repository clones with, or Auto",
			tags: ["repositories"],
		})
		.input(SetRepositoryCredentialSchema)
		.output(RepositorySchema),

	/**
	 * List all repositories
	 * GET /repositories
	 */
	list: oc
		.route({
			method: "GET",
			path: "/repositories",
			summary: "List all repositories",
			tags: ["repositories"],
		})
		.input(
			PaginationSchema.extend({
				connectionId: z.string().uuid().optional(),
				search: z.string().optional(),
			}),
		)
		.output(
			z.object({
				data: z.array(RepositoryWithServicesSchema),
				total: z.number().int(),
			}),
		),

	/**
	 * Count unlinked repositories (not linked to any service)
	 * GET /repositories/unlinked-count
	 */
	unlinkedCount: oc
		.route({
			method: "GET",
			path: "/repositories/unlinked-count",
			summary: "Count repositories not linked to any service",
			tags: ["repositories"],
		})
		.input(z.object({}))
		.output(z.object({ count: z.number().int() })),

	/**
	 * Get a repository by ID
	 * GET /repositories/:id
	 */
	get: oc
		.route({
			method: "GET",
			path: "/repositories/{id}",
			summary: "Get repository by ID",
			tags: ["repositories"],
		})
		.input(IdParamSchema)
		.output(RepositoryWithServicesSchema),

	/**
	 * Link a repository to a service
	 * POST /repositories/:id/link
	 */
	link: oc
		.route({
			method: "POST",
			path: "/repositories/{id}/link",
			summary: "Link repository to service",
			tags: ["repositories"],
		})
		.input(IdParamSchema.merge(LinkRepositorySchema))
		.output(ServiceRepositorySchema),

	/**
	 * Unlink a repository from a service
	 * DELETE /repositories/:id/unlink/:serviceId
	 */
	unlink: oc
		.route({
			method: "DELETE",
			path: "/repositories/{id}/unlink/{serviceId}",
			summary: "Unlink repository from service",
			tags: ["repositories"],
		})
		.input(z.object({ id: z.string().uuid(), serviceId: z.string().uuid() }))
		.output(z.void()),

	/**
	 * Delete an unlinked repository
	 * DELETE /repositories/:id
	 */
	delete: oc
		.route({
			method: "DELETE",
			path: "/repositories/{id}",
			summary: "Delete a repository (must be unlinked first)",
			tags: ["repositories"],
		})
		.input(IdParamSchema)
		.output(z.void()),

	/**
	 * Scripts a project's folder declares, read only; nothing runs them (#1024)
	 * GET /repositories/:id/scripts
	 */
	scripts: oc
		.route({
			method: "GET",
			path: "/repositories/{id}/scripts",
			summary:
				"List the package scripts, make targets and just recipes a project declares",
			tags: ["repositories"],
		})
		.input(IdParamSchema)
		.output(ProjectScriptsSchema),
};
