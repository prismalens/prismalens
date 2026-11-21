// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Live change hints (walk f27): which lists changed, plus an agent's activity as a
 * delta. The client re-reads what it shows; a resumed stream replays what it missed.
 */

import { eventIterator, oc } from "@orpc/contract";
import { z } from "zod";
import { lazySchema } from "../lazy-schema.js";

/** On every API answer: the change stream's cursor when the read began, so a first connect replays what came after. */
export const LIVE_CURSOR_HEADER = "x-pl-live-cursor";

export const LIVE_TOPICS = [
	"incidents",
	"alerts",
	"investigations",
	"schedules",
	/** An agent's event: the thread list's previews and activity moved (#1020). */
	"threads",
	/** Something happened a person may want to hear about (#1101 category 4). */
	"attention",
	/** A thread was opened: only the feed's unseen marks moved (#1181). */
	"visits",
] as const;
export const LiveTopicSchema = /* @__PURE__ */ lazySchema(() =>
	z.enum(LIVE_TOPICS),
);
export type LiveTopic = z.infer<typeof LiveTopicSchema>;

/** A thread's agent wrote: the row's activity time and latest sentence, patched in place. */
export const ThreadActivitySchema = /* @__PURE__ */ lazySchema(() =>
	z.object({ id: z.string(), at: z.string(), text: z.string().optional() }),
);
export type ThreadActivity = z.infer<typeof ThreadActivitySchema>;

export const LiveChangeSchema = /* @__PURE__ */ lazySchema(() =>
	z
		.object({
			/** `${epoch}.${seq}`: a reconnect sends the last one back as `after` (#1181). */
			cursor: z.string(),
			topics: z.array(LiveTopicSchema),
			/** The threads a `threads` or `investigations` hint is about; absent means any. */
			scope: z.array(z.string()).optional(),
			activity: z.array(ThreadActivitySchema).optional(),
			/** Threads whose own row moved in a way only its page shows (usage). */
			detail: z.array(z.string()).optional(),
		})
		.refine(
			(c) => c.topics.length > 0 || !!c.activity?.length || !!c.detail?.length,
		),
);
export type LiveChange = z.infer<typeof LiveChangeSchema>;

export const LiveBeatSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({ beat: z.literal(true), cursor: z.string() }),
);
export type LiveBeat = z.infer<typeof LiveBeatSchema>;

/** The server cannot replay from the `after` sent: re-read everything. */
export const LiveResetSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({ reset: z.literal(true), cursor: z.string() }),
);
export type LiveReset = z.infer<typeof LiveResetSchema>;

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
		.input(z.object({ after: z.string().optional() }))
		.output(
			eventIterator(
				z.union([LiveChangeSchema, LiveResetSchema, LiveBeatSchema]),
			),
		),
};
