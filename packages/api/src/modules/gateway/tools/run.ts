// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	defineHarnessTool,
	fail,
	type HarnessTool,
	registered,
} from "@prismalens/integrations/harness";
import { z } from "zod";
import { SCOPED } from "./serves.js";

/** The run's own state; a field the run never recorded is null, never zero. */
export interface RunStatusView {
	status: string;
	usage: {
		used: number;
		size: number;
		cost?: { amount: number; currency: string };
	} | null;
	/** Of the run's wall clock; null when the run has no start recorded. */
	secondsLeft: number | null;
	accessLevel: string | null;
	repos: {
		name: string;
		subPath: string | null;
		branch: string | null;
		commit: string;
		services: string[];
	}[];
}

/** Null when the run is gone. */
export type RunStatusLookup = (runId: string) => Promise<RunStatusView | null>;

export function runTools(status: RunStatusLookup): HarnessTool[] {
	return [
		defineHarnessTool({
			...registered("pl_run_status"),
			group: "knowledge",
			serves: SCOPED,
			input: z.object({}),
			run: async (_input, ctx) => {
				const s = await status(ctx.runId);
				return s
					? { value: s }
					: fail(
							"not_found",
							"This run is no longer recorded.",
							"Finish your answer from what you have.",
						);
			},
		}),
	];
}
