// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Operator route contracts
 *
 * Who the caller is to this instance. `via` is `loopback` for a request from
 * the host itself (ADR 0004 §8), `device` for a paired device, and null for
 * anyone else. There is no account (ADR 0001 §2): the frontend gate reads this.
 */

import { oc } from "@orpc/contract";
import { z } from "zod";

export const OperatorViaEnum = z.enum(["loopback", "device"]);
export type OperatorVia = z.infer<typeof OperatorViaEnum>;

const WhoamiSchema = z.object({
	/** Why the caller counts as the operator, or null when they do not. */
	via: OperatorViaEnum.nullable(),
});
export type Whoami = z.infer<typeof WhoamiSchema>;

export const operatorContract = {
	/**
	 * GET /operator/whoami
	 */
	whoami: oc
		.route({
			method: "GET",
			path: "/operator/whoami",
			summary: "Whether the caller is this instance's operator, and why",
			tags: ["operator"],
		})
		.input(z.object({}))
		.output(WhoamiSchema),
};
