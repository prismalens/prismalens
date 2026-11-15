// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	PR_WATCH_UNTIL,
	type PrWatchUntil,
	type PullRequest,
} from "@prismalens/contracts";
import {
	defineHarnessTool,
	fail,
	type HarnessTool,
	registered,
} from "@prismalens/integrations/harness";
import { z } from "zod";
import { ANYWHERE } from "./serves.js";

/** The threads module's ThreadWatchesService, reached at call time: it depends on modules that depend on the gateway. */
export const THREAD_WATCHES = Symbol("THREAD_WATCHES");

/** What the wake and PR tools change: surface C's wakes and surface D's pull requests. */
export interface WatchesData {
	wakeup(
		runId: string,
		delaySeconds: number,
		reason: string,
	): Promise<
		{ at: string; replaced: boolean } | { error: string; limit?: true }
	>;
	link(
		runId: string,
		url: string,
	): Promise<{ pr: PullRequest } | { error: string }>;
	watch(
		runId: string,
		prId: string,
		until: PrWatchUntil,
	): Promise<
		{ expiresAt: string; pr: string } | { error: string; limit?: true }
	>;
	unwatch(runId: string, prId: string): Promise<{ stopped: boolean }>;
}

const PR_ID = z.string().trim().min(1).max(200);

/** Waiting and watching: each writes only this thread's own record (#1024 spec B). */
export function watchTools(data: WatchesData): HarnessTool[] {
	const base = { group: "record", serves: ANYWHERE } as const;
	// A wake or a watch resumes the thread, a paid turn: only for a run someone is there for.
	const attended = { ...ANYWHERE, attended: true } as const;
	return [
		defineHarnessTool({
			...base,
			...registered("pl_wakeup_schedule"),
			serves: attended,
			input: z.object({
				delaySeconds: z.number().int().min(60).max(86_400),
				reason: z.string().trim().min(1).max(500),
			}),
			run: async ({ delaySeconds, reason }, ctx) => {
				const r = await data.wakeup(ctx.runId, delaySeconds, reason);
				if ("error" in r)
					return r.limit
						? fail(
								"limit_reached",
								r.error,
								"Finish without a wake; the user can continue the thread.",
							)
						: fail("run_ended", r.error, "Finish without a wake.");
				return { value: { scheduled: r.at, replacedEarlier: r.replaced } };
			},
		}),
		defineHarnessTool({
			...base,
			...registered("pl_pr_link"),
			input: z.object({ url: z.string().trim().url().max(2_000) }),
			run: async ({ url }, ctx) => {
				const r = await data.link(ctx.runId, url);
				if ("error" in r)
					return fail(
						"invalid_input",
						r.error,
						"Link a PR on one of this thread's repositories, or carry on without it.",
					);
				const { id, repo, number, state, review, checks, title } = r.pr;
				return {
					value: { id, pr: `${repo}#${number}`, title, state, review, checks },
				};
			},
		}),
		defineHarnessTool({
			...base,
			...registered("pl_pr_watch"),
			serves: attended,
			input: z.object({ prId: PR_ID, until: z.enum(PR_WATCH_UNTIL) }),
			run: async ({ prId, until }, ctx) => {
				const r = await data.watch(ctx.runId, prId, until);
				if ("error" in r && r.limit)
					return fail(
						"limit_reached",
						r.error,
						"Stop a watch with pl_pr_unwatch first, or carry on without this one.",
					);
				if ("error" in r)
					return fail(
						"invalid_input",
						r.error,
						"Call pl_pr_link with the PR's URL first, or carry on without watching it.",
					);
				return { value: { watching: r.pr, until, givesUpAt: r.expiresAt } };
			},
		}),
		defineHarnessTool({
			...base,
			...registered("pl_pr_unwatch"),
			input: z.object({ prId: PR_ID }),
			run: async ({ prId }, ctx) => ({
				value: await data.unwatch(ctx.runId, prId),
			}),
		}),
	];
}
