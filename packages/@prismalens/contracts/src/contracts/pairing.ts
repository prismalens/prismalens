// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Device pairing route contracts (ADR 0004 §8)
 *
 * The operator mints a one-time link on the host; the device that opens it
 * redeems the link for a session it holds until revoked. Managing links and
 * devices is the operator's (a loopback or signed-in caller), never a paired
 * device's.
 */

import { oc } from "@orpc/contract";
import { z } from "zod";

const DeviceSchema = z.object({
	id: z.string(),
	name: z.string(),
	createdAt: z.string(),
	lastSeenAt: z.string().nullable(),
	/** The device making this request. */
	current: z.boolean(),
});
export type PairedDevice = z.infer<typeof DeviceSchema>;

const CreateLinkInputSchema = z.object({
	/** Shown on the device list once redeemed, when the device sends no name. */
	label: z.string().max(80).optional(),
	/**
	 * The address the other device will open, `http(s)://host[:port]`. Defaults
	 * to the address this request came in on, which is loopback on the host
	 * itself and reaches only this machine.
	 */
	origin: z.string().url().optional(),
});

const CreateLinkResponseSchema = z.object({
	/** Shown once. Treat it as a password. */
	url: z.string(),
	expiresAt: z.string(),
});

const RedeemInputSchema = z.object({
	token: z.string().min(1),
	name: z.string().max(80).optional(),
});

const RedeemResponseSchema = z.object({
	device: z.object({ id: z.string(), name: z.string() }),
});

/** The operator's half: a loopback or signed-in caller, never a paired device. */
const manageContract = {
	/** POST /pairing/links */
	createLink: oc
		.route({
			method: "POST",
			path: "/pairing/links",
			summary: "Mint a one-time pairing link for another device",
			tags: ["pairing"],
		})
		.input(CreateLinkInputSchema)
		.output(CreateLinkResponseSchema),

	/** GET /pairing/devices */
	listDevices: oc
		.route({
			method: "GET",
			path: "/pairing/devices",
			summary: "Paired devices that can reach this instance",
			tags: ["pairing"],
		})
		.input(z.object({}))
		.output(z.object({ devices: z.array(DeviceSchema) })),

	/** DELETE /pairing/devices/{id} */
	revokeDevice: oc
		.route({
			method: "DELETE",
			path: "/pairing/devices/{id}",
			summary: "Revoke a paired device; its next request is refused",
			tags: ["pairing"],
		})
		.input(z.object({ id: z.string() }))
		.output(z.object({ revoked: z.boolean() })),
};

export const pairingContract = {
	manage: manageContract,

	/** POST /pairing/redeem — public: a device arrives with nothing but the link. */
	redeem: oc
		.route({
			method: "POST",
			path: "/pairing/redeem",
			summary: "Exchange a pairing link for a device session",
			tags: ["pairing"],
		})
		.input(RedeemInputSchema)
		.output(RedeemResponseSchema),
};
