// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Deployment route contracts
 */
import { oc } from "@orpc/contract";
import { z } from "zod";
import {
	BatchCreateDeploymentsSchema,
	DeploymentSchema,
	IdParamSchema,
	LinkDeploymentSchema,
	PaginationSchema,
} from "../schemas/index.js";

export const deploymentsContract = {
	/**
	 * Batch create deployments from platform import
	 * POST /deployments/batch
	 */
	batchCreate: oc
		.route({
			method: "POST",
			path: "/deployments/batch",
			summary: "Batch create deployments from platform import",
			tags: ["deployments"],
		})
		.input(BatchCreateDeploymentsSchema)
		.output(
			z.object({
				created: z.number().int(),
				deployments: z.array(DeploymentSchema),
			}),
		),

	/**
	 * List all deployments
	 * GET /deployments
	 */
	list: oc
		.route({
			method: "GET",
			path: "/deployments",
			summary: "List all deployments",
			tags: ["deployments"],
		})
		.input(
			PaginationSchema.extend({
				connectionId: z.string().uuid().optional(),
				serviceId: z.string().uuid().optional(),
				search: z.string().optional(),
			}),
		)
		.output(
			z.object({ data: z.array(DeploymentSchema), total: z.number().int() }),
		),

	/**
	 * Count unlinked deployments (not linked to any service)
	 * GET /deployments/unlinked-count
	 */
	unlinkedCount: oc
		.route({
			method: "GET",
			path: "/deployments/unlinked-count",
			summary: "Count deployments not linked to any service",
			tags: ["deployments"],
		})
		.input(z.object({}))
		.output(z.object({ count: z.number().int() })),

	/**
	 * Get a deployment by ID
	 * GET /deployments/:id
	 */
	get: oc
		.route({
			method: "GET",
			path: "/deployments/{id}",
			summary: "Get deployment by ID",
			tags: ["deployments"],
		})
		.input(IdParamSchema)
		.output(DeploymentSchema),

	/**
	 * Link a deployment to a service
	 * POST /deployments/:id/link
	 */
	link: oc
		.route({
			method: "POST",
			path: "/deployments/{id}/link",
			summary: "Link deployment to service",
			tags: ["deployments"],
		})
		.input(IdParamSchema.merge(LinkDeploymentSchema))
		.output(DeploymentSchema),

	/**
	 * Unlink a deployment from its service
	 * DELETE /deployments/:id/unlink
	 */
	unlink: oc
		.route({
			method: "DELETE",
			path: "/deployments/{id}/unlink",
			summary: "Unlink deployment from service",
			tags: ["deployments"],
		})
		.input(IdParamSchema)
		.output(z.void()),

	/**
	 * Delete an unlinked deployment
	 * DELETE /deployments/:id
	 */
	delete: oc
		.route({
			method: "DELETE",
			path: "/deployments/{id}",
			summary: "Delete a deployment (must be unlinked first)",
			tags: ["deployments"],
		})
		.input(IdParamSchema)
		.output(z.void()),
};
