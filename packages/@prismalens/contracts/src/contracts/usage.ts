// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { oc } from "@orpc/contract";
import { z } from "zod";
import {
	AgentLimitsSchema,
	EnforcementSchema,
	ModelPricesSchema,
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
	readLimits: oc
		.route({
			method: "POST",
			path: "/usage/limits/read",
			summary:
				"Read one agent's plan limits now, through its own CLI, with no run",
			tags: ["usage"],
		})
		.input(z.object({ agent: z.string().min(1).max(100) }))
		.output(AgentLimitsSchema),
	prices: oc
		.route({
			method: "GET",
			path: "/usage/prices",
			summary:
				"The API prices the person set for models agents report no cost for",
			tags: ["usage"],
		})
		.input(z.object({}))
		.output(ModelPricesSchema),
	setPrices: oc
		.route({
			method: "PUT",
			path: "/usage/prices",
			summary: "Replace the person's API prices",
			tags: ["usage"],
		})
		.input(ModelPricesSchema)
		.output(ModelPricesSchema),
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
