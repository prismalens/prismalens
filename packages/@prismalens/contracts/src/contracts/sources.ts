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
	HostRepositoriesInputSchema,
	HostRepositoriesSchema,
	OwnerAvatarsToggleSchema,
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

	hostRepositories: oc
		.route({
			method: "GET",
			path: "/sources/git-hosts/{host}/repositories",
			summary:
				"The repositories a git host's resolved credential can see, most recently pushed first",
			tags: ["sources"],
		})
		.input(HostRepositoriesInputSchema)
		.output(HostRepositoriesSchema),

	setOwnerAvatars: oc
		.route({
			method: "PUT",
			path: "/sources/owner-avatars",
			summary:
				"Turn the git host owner avatar fallback for project logos on or off",
			tags: ["sources"],
		})
		.input(OwnerAvatarsToggleSchema)
		.output(OwnerAvatarsToggleSchema),

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
