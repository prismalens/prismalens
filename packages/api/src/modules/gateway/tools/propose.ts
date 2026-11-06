// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type Proposal,
	type ProposalChange,
	ProposalChangeSchema,
} from "@prismalens/contracts/schemas";
import {
	defineHarnessTool,
	fail,
	type HarnessTool,
} from "@prismalens/integrations/harness";
import { z } from "zod";
import { withRules } from "./rules.js";
import { ANYWHERE } from "./serves.js";

export interface ProposalsData {
	propose(
		runId: string,
		change: ProposalChange,
		why: string,
	): Promise<Proposal | { error: string; invalid?: true }>;
}

/** One card for any change an agent proposes; nothing changes until the user applies it (#1024). */
export function proposeTools(data: ProposalsData): HarnessTool[] {
	return [
		defineHarnessTool({
			name: "propose_action",
			title: "Propose a change to the user",
			description: withRules(
				"Put a card in front of the user for one change PrismaLens makes for them: a thread-tree setting, a scheduled prompt on this thread's project or service, linking a project to a service, or adding a project. Use it when the change needs the user's say. Nothing changes until they click Apply; the card shows `why`. Asynchronous: do not poll or ask again.",
				"changes you can make in your own workspace, or anything outside PrismaLens.",
			),
			group: "record",
			effect: "record",
			serves: ANYWHERE,
			input: z.object({
				change: ProposalChangeSchema,
				why: z.string().trim().min(1).max(1_000),
			}),
			run: async ({ change, why }, ctx) => {
				const r = await data.propose(ctx.runId, change, why);
				if ("error" in r && r.invalid)
					return fail(
						"invalid_input",
						r.error,
						"Propose a value inside the setting's range, or none.",
					);
				if ("error" in r)
					return fail(
						"limit_reached",
						r.error,
						"Wait for the user to apply or dismiss the open cards before proposing more.",
					);
				return {
					value: {
						proposalId: r.id,
						state: r.state,
						next: "The user applies or dismisses it on the card; you hear nothing more unless they tell you.",
					},
				};
			},
		}),
	];
}
