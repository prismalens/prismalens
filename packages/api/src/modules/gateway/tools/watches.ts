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
import { ANYWHERE } from "./serves.js";

/** The threads module's ThreadWatchesService, reached at call time: it depends on modules that depend on the gateway. */
export const THREAD_WATCHES = Symbol("THREAD_WATCHES");

/** What the wake and PR tools change: surface C's wakes and surface D's pull requests. */
export interface WatchesData {
	wakeup(
		runId: string,
		delaySeconds: number,
		reason: string,
	): Promise<{ at: string; replaced: boolean } | { error: string }>;
	link(
		runId: string,
		url: string,
	): Promise<{ pr: PullRequest } | { error: string }>;
	watch(
		runId: string,
		prId: string,
		until: PrWatchUntil,
	): Promise<{ expiresAt: string; pr: string } | { error: string }>;
	unwatch(runId: string, prId: string): Promise<{ stopped: boolean }>;
}

const PR_ID = z.string().trim().min(1).max(200);

/** Waiting and watching: each writes only this thread's own record (#1024 spec B). */
export function watchTools(data: WatchesData): HarnessTool[] {
	const base = { group: "record", effect: "record", serves: ANYWHERE } as const;
	return [
		defineHarnessTool({
			...base,
			name: "wakeup_schedule",
			title: "Wake this thread later",
			description:
				"Have PrismaLens take this thread up again after `delaySeconds` (60 to 86,400), when there is nothing to do until then, such as waiting for a deploy or a rollout. You hear `reason` as a message then; say in it what to check. A thread has one wake of its own: a new one replaces the last. If you are still working when it comes, it waits for your next pause.",
			input: z.object({
				delaySeconds: z.number().int().min(60).max(86_400),
				reason: z.string().trim().min(1).max(500),
			}),
			run: async ({ delaySeconds, reason }, ctx) => {
				const r = await data.wakeup(ctx.runId, delaySeconds, reason);
				if ("error" in r)
					return fail("run_ended", r.error, "Finish without a wake.");
				return { value: { scheduled: r.at, replacedEarlier: r.replaced } };
			},
		}),
		defineHarnessTool({
			...base,
			name: "pr_link",
			title: "Link a pull request",
			description:
				"Link a pull request or merge request to this thread by its URL, so the thread shows its checks and review and pr_watch can follow it. Only a PR on a repository PrismaLens knows can be linked. Returns its id for pr_watch.",
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
			name: "pr_watch",
			title: "Watch a pull request",
			description:
				"Watch a pull request linked to this thread (its id from pr_link) and be woken when `until` holds: `checks_done` when its checks finish, `review` when it is approved or changes are requested, `merged` when it merges. A merged or closed PR ends any watch. PrismaLens reads it every 2 minutes for up to 12 hours; end your turn after calling. Watching the same PR again replaces its condition.",
			input: z.object({ prId: PR_ID, until: z.enum(PR_WATCH_UNTIL) }),
			run: async ({ prId, until }, ctx) => {
				const r = await data.watch(ctx.runId, prId, until);
				if ("error" in r)
					return fail(
						"invalid_input",
						r.error,
						"Call pr_link with the PR's URL first, or carry on without watching it.",
					);
				return { value: { watching: r.pr, until, givesUpAt: r.expiresAt } };
			},
		}),
		defineHarnessTool({
			...base,
			name: "pr_unwatch",
			title: "Stop watching a pull request",
			description:
				"Stop a watch pr_watch started on this thread, by the PR's id. Returns `stopped: false` when nothing watched it.",
			input: z.object({ prId: PR_ID }),
			run: async ({ prId }, ctx) => ({
				value: await data.unwatch(ctx.runId, prId),
			}),
		}),
	];
}
