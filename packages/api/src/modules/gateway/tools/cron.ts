// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	CRON_JOBS_MAX,
	CRON_MIN_GAP_MINUTES,
	type CronCreateInput,
	CronCreateInputSchema,
	type CronJob,
} from "@prismalens/contracts";
import {
	defineHarnessTool,
	fail,
	type HarnessTool,
	registered,
} from "@prismalens/integrations/harness";
import { z } from "zod";
import { ANYWHERE } from "./serves.js";

/** The cron module's CronService, reached at call time like the watches. */
export const CRON_JOBS = Symbol("CRON_JOBS");

export interface CronData {
	create(
		runId: string,
		input: CronCreateInput,
	): Promise<
		| { id: string; name: string; next: string }
		| {
				error: string;
				code: "limit_reached" | "invalid_input" | "disabled";
				next: string;
		  }
	>;
	list(runId: string): Promise<CronJob[]>;
	remove(runId: string, jobId: string): Promise<boolean>;
}

/** A recurring prompt on the agent's own thread (#1024 surface F). */
export function cronTools(data: CronData): HarnessTool[] {
	// Each fire is a paid turn: only for a run someone is there for, as wakes are.
	const base = {
		group: "record",
		serves: { ...ANYWHERE, attended: true },
	} as const;
	return [
		defineHarnessTool({
			...base,
			...registered("pl_cron_create"),
			input: CronCreateInputSchema,
			run: async (input, ctx) => {
				const r = await data.create(ctx.runId, input);
				if ("error" in r) return fail(r.code, r.error, r.next);
				return { value: r };
			},
		}),
		defineHarnessTool({
			...base,
			...registered("pl_cron_list"),
			input: z.object({}),
			run: async (_input, ctx) => ({
				value: {
					jobs: (await data.list(ctx.runId)).map(
						({ id, name, schedule, prompt, next, expires }) => ({
							id,
							name,
							schedule,
							prompt,
							next,
							expires,
						}),
					),
				},
			}),
		}),
		defineHarnessTool({
			...base,
			...registered("pl_cron_delete"),
			input: z.object({ id: z.string().trim().min(1).max(100) }),
			run: async ({ id }, ctx) => ({
				value: { deleted: await data.remove(ctx.runId, id) },
			}),
		}),
	];
}
