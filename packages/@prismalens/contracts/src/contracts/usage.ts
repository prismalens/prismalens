// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { oc } from "@orpc/contract";
import { z } from "zod";
import {
	EnforcementSchema,
	UsageLimitsSchema,
	UsageQuerySchema,
	UsageSummarySchema,
} from "../schemas/usage.js";

/** The Usage view (#1101 cat 17) and the Permissions page's enforcement line (cat 18). */
export const usageContract = {
	summary: oc
		.route({
			method: "GET",
			path: "/usage",
			summary: "Tokens and cost from the turns agents reported",
			tags: ["usage"],
		})
		.input(UsageQuerySchema)
		.output(UsageSummarySchema),
	limits: oc
		.route({
			method: "GET",
			path: "/usage/limits",
			summary: "Each agent's usage windows as it last reported them",
			tags: ["usage"],
		})
		.input(z.object({}))
		.output(UsageLimitsSchema),
	enforcement: oc
		.route({
			method: "GET",
			path: "/usage/enforcement",
			summary:
				"What each agent enforced at each permission level, from its runs",
			tags: ["usage"],
		})
		.input(z.object({}))
		.output(EnforcementSchema),
};
