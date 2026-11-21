// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A thread's PR subscriptions (#1179): list, start or resume, cancel, release parked
 * deliveries, and read now.
 */
import { oc } from "@orpc/contract";
import {
	PrSubscriptionCancelSchema,
	PrSubscriptionCreateSchema,
	PrSubscriptionListInputSchema,
	PrSubscriptionListSchema,
	PrSubscriptionPolledSchema,
	PrSubscriptionReleasedSchema,
	PrSubscriptionThreadSchema,
	PrSubscriptionViewSchema,
} from "../schemas/index.js";

export const prSubscriptionsContract = {
	/** GET /threads/:id/pr-subscriptions - active, and ended in the last 7 days, newest first */
	list: oc
		.route({
			method: "GET",
			path: "/threads/{id}/pr-subscriptions",
			summary: "List a thread's PR subscriptions",
			tags: ["threads"],
		})
		.input(PrSubscriptionListInputSchema)
		.output(PrSubscriptionListSchema),

	/** POST /threads/:id/pr-subscriptions - the thread's user subscription, or a fresh copy of an ended one */
	create: oc
		.route({
			method: "POST",
			path: "/threads/{id}/pr-subscriptions",
			summary: "Subscribe a thread to a PR's events",
			tags: ["threads"],
		})
		.input(PrSubscriptionCreateSchema)
		.output(PrSubscriptionViewSchema),

	/** DELETE /threads/:id/pr-subscriptions/:subscriptionId */
	cancel: oc
		.route({
			method: "DELETE",
			path: "/threads/{id}/pr-subscriptions/{subscriptionId}",
			summary: "Cancel a PR subscription",
			tags: ["threads"],
		})
		.input(PrSubscriptionCancelSchema)
		.output(PrSubscriptionViewSchema),

	/** POST /threads/:id/pr-subscriptions/retry - every parked delivery goes out again */
	retry: oc
		.route({
			method: "POST",
			path: "/threads/{id}/pr-subscriptions/retry",
			summary: "Send a thread's held PR events again",
			tags: ["threads"],
		})
		.input(PrSubscriptionThreadSchema)
		.output(PrSubscriptionReleasedSchema),

	/** POST /threads/:id/pr-subscriptions/poll - read now, unless the origin is cooling down */
	poll: oc
		.route({
			method: "POST",
			path: "/threads/{id}/pr-subscriptions/poll",
			summary: "Read a thread's subscribed PRs now",
			tags: ["threads"],
		})
		.input(PrSubscriptionThreadSchema)
		.output(PrSubscriptionPolledSchema),
};
