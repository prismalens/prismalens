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
	registered,
} from "@prismalens/integrations/harness";
import { z } from "zod";
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
			...registered("pl_propose_action"),
			group: "record",
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
