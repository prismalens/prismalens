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
} from "@prismalens/integrations/harness";
import { z } from "zod";
import { withRules } from "./rules.js";
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
		effect: "record",
		serves: { ...ANYWHERE, attended: true },
	} as const;
	return [
		defineHarnessTool({
			...base,
			name: "pl_cron_create",
			title: "Repeat a prompt on this thread",
			description: withRules(
				`Have PrismaLens send this thread \`prompt\` on a 5-field cron \`schedule\` in the host's time zone, at least ${CRON_MIN_GAP_MINUTES} minutes apart; \`recurring: false\` fires once. A recurring job ends after 7 days. Each fire reaches you as a message headed "Scheduled: <name>", at your next pause or by reopening the thread. At most ${CRON_JOBS_MAX} per thread. Returns its id and next fire. Use it for a check that repeats, such as a nightly look at a flaky test.`,
				"one later check: use pl_wakeup_schedule. Not for starting new runs: that is a Schedule the user sets in Settings.",
			),
			input: CronCreateInputSchema,
			run: async (input, ctx) => {
				const r = await data.create(ctx.runId, input);
				if ("error" in r) return fail(r.code, r.error, r.next);
				return { value: r };
			},
		}),
		defineHarnessTool({
			...base,
			name: "pl_cron_list",
			title: "List this thread's repeated prompts",
			description: withRules(
				"List the cron jobs on this thread: id, name, schedule, prompt, next fire and expiry. Use it before pl_cron_create or pl_cron_delete.",
				"wakes or Schedules: they are not cron jobs.",
			),
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
			name: "pl_cron_delete",
			title: "Delete a repeated prompt",
			description: withRules(
				"Delete a cron job on this thread by its id from pl_cron_list; it never fires again. Returns `deleted: false` when no such job exists. Use it when the check no longer matters.",
				"a wake: pl_wakeup_schedule replaces its own.",
			),
			input: z.object({ id: z.string().trim().min(1).max(100) }),
			run: async ({ id }, ctx) => ({
				value: { deleted: await data.remove(ctx.runId, id) },
			}),
		}),
	];
}
