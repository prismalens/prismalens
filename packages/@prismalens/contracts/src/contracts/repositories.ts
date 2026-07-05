// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Repository route contracts
 */
import { oc } from "@orpc/contract";
import { z } from "zod";
import {
	BatchCreateRepositoriesSchema,
	IdParamSchema,
	LinkRepositorySchema,
	PaginationSchema,
	RepositorySchema,
	RepositoryWithServicesSchema,
	ServiceRepositorySchema,
} from "../schemas/index.js";

export const repositoriesContract = {
	/**
	 * Batch create repositories from VCS import
	 * POST /repositories/batch
	 */
	batchCreate: oc
		.route({
			method: "POST",
			path: "/repositories/batch",
			summary: "Batch create repositories from VCS import",
			tags: ["repositories"],
		})
		.input(BatchCreateRepositoriesSchema)
		.output(
			z.object({
				created: z.number().int(),
				repositories: z.array(RepositorySchema),
			}),
		),

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
};
