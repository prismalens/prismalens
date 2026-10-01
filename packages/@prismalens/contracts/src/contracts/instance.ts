// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Instance identity (#763). Public, so a launcher can tell which instance
 * answers on a port before it holds a credential. The id is not a secret:
 * matching it is accident prevention, never authentication.
 */

import { oc } from "@orpc/contract";
import { z } from "zod";

const InstanceSchema = z.object({
	instanceId: z.string().uuid(),
	version: z.string(),
	/** Bumped when this shape changes incompatibly. */
	apiVersion: z.literal(1),
});
export type InstanceInfo = z.infer<typeof InstanceSchema>;

export const instanceContract = {
	/**
	 * GET /instance
	 */
	get: oc
		.route({
			method: "GET",
			path: "/instance",
			summary: "Which PrismaLens instance this is",
			tags: ["instance"],
		})
		.input(z.object({}))
		.output(InstanceSchema),
};
