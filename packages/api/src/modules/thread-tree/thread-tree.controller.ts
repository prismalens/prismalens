// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import { threadTreeContract } from "@prismalens/contracts";
import type { Request } from "express";
import { requireOwner } from "../../core/auth/owner.js";
import { ProposalsService } from "./proposals.service.js";
import { ThreadTreeService } from "./thread-tree.service.js";
import { TreeSettings } from "./tree-settings.service.js";

/** ADR 0004 §6: a paired device and a run's bearer see the tree, never change what agents run. */
const hostOnly = (request: Request | undefined) =>
	requireOwner(request, "Only the owner can change what agents may run.");

@Controller()
export class ThreadTreeController {
	constructor(
		private readonly tree: ThreadTreeService,
		private readonly proposals: ProposalsService,
		private readonly settings: TreeSettings,
	) {}

	private async linksOf(id: string) {
		const links = await this.tree.links(id);
		if (!links)
			throw new ORPCError("NOT_FOUND", { message: "Thread not found" });
		return links;
	}

	@Implement(threadTreeContract)
	routes() {
		return {
			// GET /threads/:id/links - Started by, and the threads it started
			links: implement(threadTreeContract.links).handler(({ input }) =>
				this.linksOf(input.id),
			),

			// POST /threads/:id/proposals/:pid/apply - Host only, through the normal service
			applyProposal: implement(threadTreeContract.applyProposal).handler(
				async ({ input, context }) => {
					const device = hostOnly(context?.request);
					return this.proposals.apply(input.id, input.pid, device);
				},
			),

			// POST /threads/:id/proposals/:pid/dismiss
			dismissProposal: implement(threadTreeContract.dismissProposal).handler(
				({ input }) => this.proposals.dismiss(input.id, input.pid),
			),

			// DELETE /threads/:id/tree/allowance - Host only
			revokeAllowance: implement(threadTreeContract.revokeAllowance).handler(
				async ({ input, context }) => {
					hostOnly(context?.request);
					const links = await this.linksOf(input.id);
					await this.tree.revokeAllowance(links.chainId);
					return this.linksOf(input.id);
				},
			),

			// GET /threads/tree-settings
			getSettings: implement(threadTreeContract.getSettings).handler(() =>
				this.settings.get(),
			),

			// PUT /threads/tree-settings - Host only
			updateSettings: implement(threadTreeContract.updateSettings).handler(
				async ({ input, context }) => {
					hostOnly(context?.request);
					return this.settings.set(input);
				},
			),
		};
	}
}
