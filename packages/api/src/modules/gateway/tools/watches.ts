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
} from "@prismalens/integrations/harness";
import { z } from "zod";
import { withRules } from "./rules.js";
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
	const base = { group: "record", effect: "record", serves: ANYWHERE } as const;
	// A wake or a watch resumes the thread, a paid turn: only for a run someone is there for.
	const attended = { ...ANYWHERE, attended: true } as const;
	return [
		defineHarnessTool({
			...base,
			name: "pl_wakeup_schedule",
			title: "Wake this thread later",
			description: withRules(
				"Have PrismaLens take this thread up again after `delaySeconds` (60 to 86,400). Use it when there is nothing to do until then, such as waiting for a deploy or a rollout. You hear `reason` as a message then; say in it what to check. A thread has one wake of its own: a new one replaces the last. If you are still working when it comes, it waits for your next pause.",
				"waiting on another thread: use pl_thread_wait.",
			),
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
			name: "pl_pr_link",
			title: "Link a pull request",
			description: withRules(
				"Link a pull request or merge request to this thread by its URL, so the thread shows its checks and review and pl_pr_watch can follow it. Only a PR on a repository PrismaLens knows can be linked. Returns its id for pl_pr_watch. Use it when you open or find a PR the user should follow.",
				"a PR on a repository PrismaLens does not know.",
			),
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
			name: "pl_pr_watch",
			title: "Watch a pull request",
			description: withRules(
				"Watch a pull request linked to this thread (its id from pl_pr_link) and be woken when `until` holds: `checks_done` when its checks finish, `review` when it is approved or changes are requested, `merged` when it merges. A merged or closed PR ends any watch. PrismaLens reads it every 2 minutes for up to 12 hours; end your turn after calling. Watching the same PR again replaces its condition. Use it when your next step depends on the PR.",
				"a PR this thread has not linked: call pl_pr_link first.",
			),
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
			name: "pl_pr_unwatch",
			title: "Stop watching a pull request",
			description: withRules(
				"Stop a watch pl_pr_watch started on this thread, by the PR's id. Returns `stopped: false` when nothing watched it. Use it when the outcome no longer matters.",
				"a PR nothing watches.",
			),
			input: z.object({ prId: PR_ID }),
			run: async ({ prId }, ctx) => ({
				value: await data.unwatch(ctx.runId, prId),
			}),
		}),
	];
}
