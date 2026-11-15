// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Threads that start threads (#1101 cat 10): who started a thread and what it started,
 * the cards an agent proposes, and the caps the user sets.
 */
import { oc } from "@orpc/contract";
import {
	ProposalIdSchema,
	ProposalSchema,
	ThreadLinksSchema,
	ThreadTreeIdSchema,
	ThreadTreeSettingsSchema,
} from "../schemas/index.js";

export const threadTreeContract = {
	/**
	 * Who started a thread and the threads it started (#1101 cat 10)
	 * GET /threads/:id/links
	 */
	links: oc
		.route({
			method: "GET",
			path: "/threads/{id}/links",
			summary: "Read a thread's start links",
			tags: ["threads"],
		})
		.input(ThreadTreeIdSchema)
		.output(ThreadLinksSchema),

	/**
	 * Apply what the agent proposed, through the normal API for its kind. Host only.
	 * POST /threads/:id/proposals/:pid/apply
	 */
	applyProposal: oc
		.route({
			method: "POST",
			path: "/threads/{id}/proposals/{pid}/apply",
			summary: "Apply an agent's proposal",
			tags: ["threads"],
		})
		.input(ProposalIdSchema)
		.output(ProposalSchema),

	/**
	 * POST /threads/:id/proposals/:pid/dismiss
	 */
	dismissProposal: oc
		.route({
			method: "POST",
			path: "/threads/{id}/proposals/{pid}/dismiss",
			summary: "Dismiss an agent's proposal",
			tags: ["threads"],
		})
		.input(ProposalIdSchema)
		.output(ProposalSchema),

	/**
	 * Revoke "Allow for threads started from here" on this thread's chain. Host only.
	 * DELETE /threads/:id/tree/allowance
	 */
	revokeAllowance: oc
		.route({
			method: "DELETE",
			path: "/threads/{id}/tree/allowance",
			summary: "Revoke a start chain's allowance",
			tags: ["threads"],
		})
		.input(ThreadTreeIdSchema)
		.output(ThreadLinksSchema),

	/**
	 * Agents may start threads, and the caps
	 * GET /threads/tree-settings
	 */
	getSettings: oc
		.route({
			method: "GET",
			path: "/threads/tree-settings",
			summary: "Read the agent-started thread settings",
			tags: ["threads"],
		})
		.output(ThreadTreeSettingsSchema),

	/**
	 * Host only: it changes what an agent may run.
	 * PUT /threads/tree-settings
	 */
	updateSettings: oc
		.route({
			method: "PUT",
			path: "/threads/tree-settings",
			summary: "Change the agent-started thread settings",
			tags: ["threads"],
		})
		.input(ThreadTreeSettingsSchema)
		.output(ThreadTreeSettingsSchema),
};
