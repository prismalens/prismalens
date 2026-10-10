// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The Impact chart: the firing alert's own expression, re-run live on the connected Prometheus (#811).
 */
import { oc } from "@orpc/contract";
import { ImpactChartSchema, ImpactQuerySchema } from "../schemas/index.js";

export const impactContract = {
	/**
	 * The last 24 hours of the incident's alert expression
	 * GET /incidents/:id/impact
	 */
	forIncident: oc
		.route({
			method: "GET",
			path: "/incidents/{id}/impact",
			summary: "The incident's impact over the last 24 hours",
			tags: ["incidents"],
		})
		.input(ImpactQuerySchema)
		.output(ImpactChartSchema),
};
