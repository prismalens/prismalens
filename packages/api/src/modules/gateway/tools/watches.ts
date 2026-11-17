// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	PR_DELIVERY_MODES,
	PR_EVENT_GROUPS,
	type PrDeliveryMode,
	type PrEventGroup,
	PrSubscriptionFilterSchema,
	type PrSubscriptionSpecInput,
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

/** A PR subscription tool's answer: its value, or a failure the agent reads `next` on (#1179). */
export type SubscriptionAnswer =
	| { value: unknown }
	| {
			error:
				| "invalid_input"
				| "disabled"
				| "limit_reached"
				| "run_ended"
				| "not_found";
			message: string;
			next: string;
	  };

export interface SubscribeArgs {
	pr: string;
	events?: PrEventGroup[];
	filter?: PrSubscriptionSpecInput["filter"];
	delivery?: PrDeliveryMode;
	batchMinutes?: number;
	once?: boolean;
}

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
	subscribe(runId: string, input: SubscribeArgs): Promise<SubscriptionAnswer>;
	unsubscribe(
		runId: string,
		input: { subscription?: string; pr?: string },
	): Promise<SubscriptionAnswer>;
	subscriptions(runId: string): Promise<SubscriptionAnswer>;
}

const PR_REF = z.string().trim().min(1).max(2_000);

const answered = (r: SubscriptionAnswer) =>
	"error" in r ? fail(r.error, r.message, r.next) : { value: r.value };

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
			...registered("pl_pr_subscribe"),
			serves: attended,
			input: z.object({
				pr: PR_REF,
				events: z.array(z.enum(PR_EVENT_GROUPS)).min(1).max(7).optional(),
				filter: PrSubscriptionFilterSchema.optional(),
				delivery: z.enum(PR_DELIVERY_MODES).optional(),
				batchMinutes: z.number().int().min(2).max(120).optional(),
				once: z.boolean().optional(),
			}),
			run: async (input, ctx) =>
				answered(await data.subscribe(ctx.runId, input)),
		}),
		defineHarnessTool({
			...base,
			...registered("pl_pr_unsubscribe"),
			input: z.object({
				subscription: z.string().trim().min(1).max(200).optional(),
				pr: PR_REF.optional(),
			}),
			run: async (input, ctx) =>
				answered(await data.unsubscribe(ctx.runId, input)),
		}),
		defineHarnessTool({
			...registered("pl_pr_subscriptions"),
			group: "knowledge",
			serves: ANYWHERE,
			input: z.object({}),
			run: async (_input, ctx) => answered(await data.subscriptions(ctx.runId)),
		}),
	];
}
