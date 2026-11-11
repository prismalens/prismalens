// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Attention (#1101 categories 3 and 4): the event list, Home's away view, each
 * thread's read position, the presence lease and the notification choices.
 */
import { oc } from "@orpc/contract";
import { z } from "zod";
import {
	AttentionEventsInputSchema,
	AttentionEventsSchema,
	AwayViewSchema,
	FollowInputSchema,
	MarkThreadReadInputSchema,
	NotifyPrefsSchema,
	PresenceInputSchema,
	PresenceSchema,
	ThreadReadSchema,
} from "../schemas/attention.js";

export const attentionContract = {
	/** GET /attention/events */
	events: oc
		.route({
			method: "GET",
			path: "/attention/events",
			summary: "List what happened to threads, unread or all",
			tags: ["attention"],
		})
		.input(AttentionEventsInputSchema)
		.output(AttentionEventsSchema),

	/** POST /attention/read — mark events read, or every one when no ids */
	markRead: oc
		.route({
			method: "POST",
			path: "/attention/read",
			summary: "Mark events read",
			tags: ["attention"],
		})
		.input(z.object({ ids: z.array(z.string()).max(500).optional() }))
		.output(z.object({ marked: z.number().int() })),

	/** GET /attention/away */
	away: oc
		.route({
			method: "GET",
			path: "/attention/away",
			summary: "What changed since the operator was last here",
			tags: ["attention"],
		})
		.input(z.object({}))
		.output(AwayViewSchema),

	/** GET /threads/:id/read — the read position, before this visit advances it */
	threadRead: oc
		.route({
			method: "GET",
			path: "/threads/{id}/read",
			summary: "Where the operator has read a thread to",
			tags: ["attention"],
		})
		.input(z.object({ id: z.string().uuid() }))
		.output(ThreadReadSchema),

	/** POST /threads/:id/read — advance the read position; never moves back */
	markThreadRead: oc
		.route({
			method: "POST",
			path: "/threads/{id}/read",
			summary: "Advance a thread's read position",
			tags: ["attention"],
		})
		.input(MarkThreadReadInputSchema)
		.output(z.object({ advanced: z.boolean() })),

	/** POST /attention/presence — hold, renew or drop this device's foreground lease */
	presence: oc
		.route({
			method: "POST",
			path: "/attention/presence",
			summary: "Hold this device's foreground lease",
			tags: ["attention"],
		})
		.input(PresenceInputSchema)
		.output(PresenceSchema),

	/** GET /attention/prefs */
	prefs: oc
		.route({
			method: "GET",
			path: "/attention/prefs",
			summary: "Read the notification choices",
			tags: ["attention"],
		})
		.input(z.object({}))
		.output(NotifyPrefsSchema),

	/** PUT /attention/prefs */
	setPrefs: oc
		.route({
			method: "PUT",
			path: "/attention/prefs",
			summary: "Change the notification choices",
			tags: ["attention"],
		})
		.input(NotifyPrefsSchema)
		.output(NotifyPrefsSchema),

	/** PUT /threads/:id/follow — notify when it finishes, or mute it */
	follow: oc
		.route({
			method: "PUT",
			path: "/threads/{id}/follow",
			summary: "Watch or mute a thread",
			tags: ["attention"],
		})
		.input(FollowInputSchema)
		.output(z.object({ follow: z.enum(["watch", "mute"]).nullable() })),
};
