// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Injectable, type OnModuleInit } from "@nestjs/common";
import { fail } from "@prismalens/integrations/harness";
import { GatewayService } from "../gateway/gateway.service.js";
import { PendingActionsService } from "./pending-actions.service.js";
import { ProposalsService } from "./proposals.service.js";
import { ThreadTreeService } from "./thread-tree.service.js";
import { TreeSettings } from "./tree-settings.service.js";

const GONE = () =>
	fail(
		"run_ended",
		"This thread is gone.",
		"Stop; nothing more can be done here.",
	);

/** Gives the gateway's tree tools their data: the tree module depends on the gateway, not back. */
@Injectable()
export class TreeGateway implements OnModuleInit {
	constructor(
		private readonly gateway: GatewayService,
		private readonly tree: ThreadTreeService,
		private readonly actions: PendingActionsService,
		private readonly proposals: ProposalsService,
		private readonly settings: TreeSettings,
	) {}

	private async rootOf(runId: string): Promise<string | null> {
		const tree = await this.tree.tree(runId);
		return tree?.rootId ?? null;
	}

	onModuleInit(): void {
		this.gateway.bindTree({
			actsOff: async () =>
				(await this.settings.get()).agentsStartThreads === "never",
			proposals: {
				propose: (runId, change, why) =>
					this.proposals.propose(runId, change, why),
			},
			tree: {
				start: async (runId, input) => {
					const rootId = await this.rootOf(runId);
					if (!rootId) return GONE();
					return this.actions.gate({
						callerId: runId,
						rootId,
						tool: "thread_start",
						args: input,
						requestId: input.requestId,
					});
				},
				cancel: async (runId, id, reason, requestId) => {
					const rootId = await this.rootOf(runId);
					if (!rootId) return GONE();
					return this.actions.gate({
						callerId: runId,
						rootId,
						tool: "thread_cancel",
						args: { id, reason, requestId },
						requestId,
					});
				},
				send: (runId, input) => this.tree.send(runId, input),
				wait: (runId, ids, mode) => this.tree.wait(runId, ids, mode),
				roster: async (runId) => {
					const roster = await this.tree.roster(runId);
					return roster ? { value: roster } : GONE();
				},
			},
		});
	}
}
