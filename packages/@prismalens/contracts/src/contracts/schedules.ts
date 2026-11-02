// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Scheduled task route contracts (#979). Reads are open to every paired device; writes answer
 * FORBIDDEN unless the caller is the host.
 */
import { oc } from "@orpc/contract";
import { z } from "zod";
import {
	ScheduleDetailQuerySchema,
	ScheduleDetailSchema,
	ScheduleEnabledSchema,
	ScheduleIdSchema,
	ScheduleInputSchema,
	ScheduleListResponseSchema,
	SchedulePreviewInputSchema,
	SchedulePreviewSchema,
	ScheduleSchema,
	ScheduleTickSchema,
	ScheduleUpdateSchema,
} from "../schemas/index.js";

export const schedulesContract = {
	list: oc
		.route({
			method: "GET",
			path: "/schedules",
			summary: "List schedules and built-in jobs",
			tags: ["schedules"],
		})
		.input(z.object({}).optional())
		.output(ScheduleListResponseSchema),

	get: oc
		.route({
			method: "GET",
			path: "/schedules/{id}",
			summary: "A schedule and its runs",
			tags: ["schedules"],
		})
		.input(ScheduleDetailQuerySchema)
		.output(ScheduleDetailSchema),

	preview: oc
		.route({
			method: "POST",
			path: "/schedules/preview",
			summary: "Describe a recurrence and its next runs",
			tags: ["schedules"],
		})
		.input(SchedulePreviewInputSchema)
		.output(SchedulePreviewSchema),

	create: oc
		.route({
			method: "POST",
			path: "/schedules",
			summary: "Create a schedule (host only)",
			tags: ["schedules"],
		})
		.input(ScheduleInputSchema)
		.output(ScheduleSchema),

	update: oc
		.route({
			method: "PUT",
			path: "/schedules/{id}",
			summary: "Change a schedule (host only)",
			tags: ["schedules"],
		})
		.input(ScheduleUpdateSchema)
		.output(ScheduleSchema),

	setEnabled: oc
		.route({
			method: "POST",
			path: "/schedules/{id}/enabled",
			summary: "Pause or resume a schedule (host only)",
			tags: ["schedules"],
		})
		.input(ScheduleEnabledSchema)
		.output(ScheduleSchema),

	runNow: oc
		.route({
			method: "POST",
			path: "/schedules/{id}/run",
			summary: "Run a schedule now (host only)",
			tags: ["schedules"],
		})
		.input(ScheduleIdSchema)
		.output(ScheduleTickSchema),

	remove: oc
		.route({
			method: "DELETE",
			path: "/schedules/{id}",
			summary: "Delete a schedule (host only)",
			tags: ["schedules"],
		})
		.input(ScheduleIdSchema)
		.output(z.object({ ok: z.literal(true) })),
};
