// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A run's options to stop the impact: applied, undone and checked by their stamped id (#811).
 */
import { oc } from "@orpc/contract";
import { z } from "zod";
import {
	FixCheckSchema,
	FixesSchema,
	FixOptionSchema,
} from "../schemas/index.js";

const StepParamSchema = z.object({ id: z.string().uuid() });

export const fixesContract = {
	/**
	 * Every next step of a run's report in rank order, with applied and check state
	 * GET /investigations/:id/fixes
	 */
	forInvestigation: oc
		.route({
			method: "GET",
			path: "/investigations/{id}/fixes",
			summary: "A run's options with their applied and check state",
			tags: ["investigations"],
		})
		.input(StepParamSchema)
		.output(FixesSchema),

	/**
	 * "I applied it", after a confirmed copy
	 * POST /fixes/:id/applied
	 */
	apply: oc
		.route({
			method: "POST",
			path: "/fixes/{id}/applied",
			summary: "Record that the user applied an option",
			tags: ["investigations"],
		})
		.input(StepParamSchema)
		.output(FixOptionSchema),

	/**
	 * Undo "I applied it"; refused once a check has run
	 * DELETE /fixes/:id/applied
	 */
	undo: oc
		.route({
			method: "DELETE",
			path: "/fixes/{id}/applied",
			summary: "Take back an applied mark before any check",
			tags: ["investigations"],
		})
		.input(StepParamSchema)
		.output(FixOptionSchema),

	/**
	 * Check now: one observation of the alert's expression, judged in code
	 * POST /fixes/:id/check
	 */
	check: oc
		.route({
			method: "POST",
			path: "/fixes/{id}/check",
			summary: "Check whether an applied option stopped the impact",
			tags: ["investigations"],
		})
		.input(StepParamSchema)
		.output(FixCheckSchema),
};
