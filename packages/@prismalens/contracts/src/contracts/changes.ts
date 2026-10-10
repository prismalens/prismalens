// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * What changed around an incident, read from its services' git hosts (#811).
 */
import { oc } from "@orpc/contract";
import {
	IncidentChangesQuerySchema,
	IncidentChangesSchema,
} from "../schemas/index.js";

export const changesContract = {
	/**
	 * Deploys, releases, merges and commits around an incident's start
	 * GET /incidents/:id/changes
	 */
	forIncident: oc
		.route({
			method: "GET",
			path: "/incidents/{id}/changes",
			summary: "What changed around an incident's start",
			tags: ["incidents"],
		})
		.input(IncidentChangesQuerySchema)
		.output(IncidentChangesSchema),
};
