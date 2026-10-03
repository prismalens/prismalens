// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Live change hints (walk f27): which lists changed, never the data. The client
 * re-reads what it shows, so a missed hint costs one refetch, not a wrong screen.
 */

import { eventIterator, oc } from "@orpc/contract";
import { z } from "zod";

export const LIVE_TOPICS = ["incidents", "alerts", "investigations"] as const;
export const LiveTopicSchema = z.enum(LIVE_TOPICS);
export type LiveTopic = z.infer<typeof LiveTopicSchema>;

export const LiveChangeSchema = z.object({
	topics: z.array(LiveTopicSchema).min(1),
});
export type LiveChange = z.infer<typeof LiveChangeSchema>;

export const liveContract = {
	/**
	 * GET /live/changes — a server-sent event stream of change hints.
	 */
	changes: oc
		.route({
			method: "GET",
			path: "/live/changes",
			summary: "Stream which lists changed, as they change",
			tags: ["live"],
		})
		.input(z.object({}))
		.output(eventIterator(LiveChangeSchema)),
};
