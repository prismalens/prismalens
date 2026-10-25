// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Sources: one connect flow for every category (#848). The descriptors in
 * `schemas/source-type.ts` say what each type needs; these routes test and save it.
 */
import { oc } from "@orpc/contract";
import { z } from "zod";
import {
	ConnectSourceResponseSchema,
	GitHostViewSchema,
	ProbeReportSchema,
	RunbooksToggleSchema,
	SourceDraftSchema,
	SourcesOverviewSchema,
	SourcesPreRunInputSchema,
	SourcesPreRunSchema,
} from "../schemas/index.js";

export const sourcesContract = {
	overview: oc
		.route({
			method: "GET",
			path: "/sources",
			summary: "Every telemetry connection with its state, and the git hosts",
			tags: ["sources"],
		})
		.input(z.object({}))
		.output(SourcesOverviewSchema),

	test: oc
		.route({
			method: "POST",
			path: "/sources/test",
			summary: "Probe a draft's address and credential without saving it",
			tags: ["sources"],
		})
		.input(SourceDraftSchema)
		.output(ProbeReportSchema),

	connect: oc
		.route({
			method: "POST",
			path: "/sources/connect",
			summary:
				"Save a draft: probed first unless saveUntested, and not saved when a required probe fails",
			tags: ["sources"],
		})
		.input(SourceDraftSchema)
		.output(ConnectSourceResponseSchema),

	retest: oc
		.route({
			method: "POST",
			path: "/sources/{id}/test",
			summary: "Re-run the probes for a saved source",
			tags: ["sources"],
		})
		.input(z.object({ id: z.string() }))
		.output(ProbeReportSchema),

	setRunbooks: oc
		.route({
			method: "PUT",
			path: "/sources/runbooks",
			summary: "Turn runbook discovery in the bound repos on or off",
			tags: ["sources"],
		})
		.input(RunbooksToggleSchema)
		.output(RunbooksToggleSchema),

	gitHosts: oc
		.route({
			method: "GET",
			path: "/sources/git-hosts",
			summary:
				"Each git host's credentials, in the order a repository tries them",
			tags: ["sources"],
		})
		.input(z.object({}))
		.output(z.array(GitHostViewSchema)),

	preRun: oc
		.route({
			method: "GET",
			path: "/sources/pre-run",
			summary:
				"What a service's runs would read before they start, for a deployment",
			tags: ["sources"],
		})
		.input(SourcesPreRunInputSchema)
		.output(SourcesPreRunSchema),
};
