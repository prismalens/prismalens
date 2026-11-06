// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import { threadTreeContract } from "@prismalens/contracts";
import type { Request } from "express";
import { isHost } from "../../core/settings/settings.controller.js";
import { ProposalsService } from "./proposals.service.js";
import { ThreadTreeService } from "./thread-tree.service.js";
import { TreeSettings } from "./tree-settings.service.js";

const HOST_ONLY =
	"Only this machine's own session can change what agents may run.";

/** ADR 0004 §6: a paired device and a run's bearer see the tree, never change what agents run. */
function hostOnly(request: Request | undefined): string | null {
	if (!request || !isHost(request))
		throw new ORPCError("FORBIDDEN", { message: HOST_ONLY });
	return request.operator?.device.id ?? null;
}

@Controller()
export class ThreadTreeController {
	constructor(
		private readonly tree: ThreadTreeService,
		private readonly proposals: ProposalsService,
		private readonly settings: TreeSettings,
	) {}

	private async treeOf(id: string) {
		const tree = await this.tree.tree(id);
		if (!tree)
			throw new ORPCError("NOT_FOUND", { message: "Thread not found" });
		return tree;
	}

	@Implement(threadTreeContract)
	routes() {
		return {
			// GET /threads/:id/tree - The panel's Threads section
			tree: implement(threadTreeContract.tree).handler(({ input }) =>
				this.treeOf(input.id),
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
					const tree = await this.treeOf(input.id);
					await this.tree.revokeAllowance(tree.rootId);
					return this.treeOf(input.id);
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
