// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Live change hints (walk f27): which lists changed, never the data. The client
 * re-reads what it shows, so a missed hint costs one refetch, not a wrong screen.
 */

import { eventIterator, oc } from "@orpc/contract";
import { z } from "zod";
import { lazySchema } from "../lazy-schema.js";

export const LIVE_TOPICS = [
	"incidents",
	"alerts",
	"investigations",
	"schedules",
	/** An agent's event: the thread list's previews and activity moved (#1020). */
	"threads",
	/** Something happened a person may want to hear about (#1101 category 4). */
	"attention",
] as const;
export const LiveTopicSchema = /* @__PURE__ */ lazySchema(() =>
	z.enum(LIVE_TOPICS),
);
export type LiveTopic = z.infer<typeof LiveTopicSchema>;

export const LiveChangeSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		topics: z.array(LiveTopicSchema).min(1),
	}),
);
export type LiveChange = z.infer<typeof LiveChangeSchema>;

export const LiveBeatSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({ beat: z.literal(true) }),
);
export type LiveBeat = z.infer<typeof LiveBeatSchema>;

export const liveContract = {
	/**
	 * GET /live/changes — a server-sent event stream of change hints, and a beat
	 * every `STREAM_BEAT_MS` so a silent drop shows.
	 */
	changes: oc
		.route({
			method: "GET",
			path: "/live/changes",
			summary: "Stream which lists changed, as they change",
			tags: ["live"],
		})
		.input(z.object({}))
		.output(eventIterator(z.union([LiveChangeSchema, LiveBeatSchema]))),
};
