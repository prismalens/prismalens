// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Phone push (#859): opt-in per device. A push carries ids only; the device
 * fetches the words from this instance, so the push service never sees them.
 */

import { oc } from "@orpc/contract";
import { z } from "zod";

export const PUSH_KINDS = [
	"finding_ready",
	"run_failed",
	"ask_waiting",
	"ask_refused",
] as const;
export type PushKind = (typeof PUSH_KINDS)[number];

/** All a push payload ever holds. */
export const PushPayloadSchema = z.object({
	id: z.string(),
	kind: z.enum([...PUSH_KINDS, "test"]),
	investigationId: z.string().optional(),
	askId: z.string().optional(),
});
export type PushPayload = z.infer<typeof PushPayloadSchema>;

export const PushHealthSchema = z.object({
	/** `expired`: the push service dropped it, the device must turn push on again. */
	state: z.enum(["active", "failing", "expired"]),
	since: z.string(),
	lastDeliveryAt: z.string().nullable(),
	lastError: z.string().nullable(),
});
export type PushHealth = z.infer<typeof PushHealthSchema>;

/** Where an ask a link names stands now, whatever ask is current. */
export const ASK_LINK_STATES = [
	"waiting",
	"answered",
	"timed_out",
	"run_ended",
	"needed_approval",
	"unknown",
] as const;
export type AskLinkState = (typeof ASK_LINK_STATES)[number];

const AskStateSchema = z.object({
	state: z.enum(ASK_LINK_STATES),
	/** What the agent asked to run, as the ask card names it. */
	title: z.string().nullable(),
	/** `approved` or `denied` when answered. */
	outcome: z.string().nullable(),
	incidentId: z.string().nullable(),
});
export type AskState = z.infer<typeof AskStateSchema>;

export const SubscribeInputSchema = z.object({
	endpoint: z.url({ protocol: /^https$/ }),
	keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

export const pushContract = {
	/** GET /push/public-key */
	publicKey: oc
		.route({
			method: "GET",
			path: "/push/public-key",
			summary: "The VAPID public key a device subscribes with",
			tags: ["push"],
		})
		.input(z.object({}))
		.output(z.object({ publicKey: z.string() })),

	/** PUT /push/subscription */
	subscribe: oc
		.route({
			method: "PUT",
			path: "/push/subscription",
			summary: "Turn push on for the device making this request",
			tags: ["push"],
		})
		.input(SubscribeInputSchema)
		.output(PushHealthSchema),

	/** DELETE /push/subscription */
	unsubscribe: oc
		.route({
			method: "DELETE",
			path: "/push/subscription",
			summary: "Turn push off for the device making this request",
			tags: ["push"],
		})
		.input(z.object({}))
		.output(z.object({ removed: z.boolean() })),

	/** POST /push/test */
	sendTest: oc
		.route({
			method: "POST",
			path: "/push/test",
			summary: "Send a test push to a device; this one when none is named",
			tags: ["push"],
		})
		.input(z.object({ deviceId: z.string().optional() }))
		.output(PushHealthSchema),

	/** GET /push/notifications/{id} */
	notification: oc
		.route({
			method: "GET",
			path: "/push/notifications/{id}",
			summary: "The words and link for a push the device received",
			tags: ["push"],
		})
		.input(z.object({ id: z.string() }))
		.output(z.object({ title: z.string(), body: z.string(), url: z.string() })),

	/** GET /push/asks/{investigationId}/{askId} */
	askState: oc
		.route({
			method: "GET",
			path: "/push/asks/{investigationId}/{askId}",
			summary: "Where the ask a link names stands now",
			tags: ["push"],
		})
		.input(z.object({ investigationId: z.string(), askId: z.string() }))
		.output(AskStateSchema),
};
