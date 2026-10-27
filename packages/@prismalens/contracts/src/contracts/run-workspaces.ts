// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** Run workspaces (#925): settings, a service's override, kept workspaces, removals. */
import { oc } from "@orpc/contract";
import { z } from "zod";
import {
	RemoveWorkspaceResultSchema,
	RunWorkspaceGlobalSchema,
	RunWorkspaceSettingsSchema,
	RunWorkspacesSchema,
	RunWorkspaceTargetSchema,
	ServiceWorkspaceSchema,
	UpdateServiceWorkspaceSchema,
	WorkspaceRemovalsSchema,
} from "../schemas/run-workspace.js";

const tags = ["run-workspaces"];

export const runWorkspacesContract = {
	get: oc
		.route({
			method: "GET",
			path: "/settings/run-workspace",
			summary: "Get the global run workspace settings",
			tags,
		})
		.output(RunWorkspaceGlobalSchema),

	update: oc
		.route({
			method: "PUT",
			path: "/settings/run-workspace",
			summary: "Set the global run workspace settings. Host only",
			tags,
		})
		.input(RunWorkspaceSettingsSchema)
		.output(RunWorkspaceGlobalSchema),

	getService: oc
		.route({
			method: "GET",
			path: "/services/{serviceId}/run-workspace",
			summary: "Get a service's run workspace override and what it resolves to",
			tags,
		})
		.input(z.object({ serviceId: z.string() }))
		.output(ServiceWorkspaceSchema),

	updateService: oc
		.route({
			method: "PUT",
			path: "/services/{serviceId}/run-workspace",
			summary: "Set a service's run workspace override. Host only",
			tags,
		})
		.input(UpdateServiceWorkspaceSchema)
		.output(ServiceWorkspaceSchema),

	removals: oc
		.route({
			method: "GET",
			path: "/settings/run-workspace/removals",
			summary:
				"Recent workspace removals, and kept ones, with the reason for each",
			tags,
		})
		.output(WorkspaceRemovalsSchema),

	listForRun: oc
		.route({
			method: "GET",
			path: "/investigations/{runId}/workspaces",
			summary: "The run's kept workspaces",
			tags,
		})
		.input(z.object({ runId: z.string().uuid() }))
		.output(RunWorkspacesSchema),

	remove: oc
		.route({
			method: "POST",
			path: "/investigations/{runId}/workspaces/remove",
			summary: "Remove a kept workspace, changes and all. Host only",
			tags,
		})
		.input(RunWorkspaceTargetSchema)
		.output(RemoveWorkspaceResultSchema),

	open: oc
		.route({
			method: "POST",
			path: "/investigations/{runId}/workspaces/open",
			summary:
				"Open a kept workspace in this computer's file manager. Host only",
			tags,
		})
		.input(RunWorkspaceTargetSchema)
		.output(z.object({ opened: z.boolean() })),
};
