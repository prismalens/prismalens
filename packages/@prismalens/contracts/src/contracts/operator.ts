// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Operator route contracts
 *
 * Who the caller is to this instance. `via` is `loopback` for a request from
 * the host itself (ADR 0004 §8), `session` for a signed-in browser, and null
 * for anyone else. The frontend gate reads this instead of the session alone,
 * so a laptop operator never sees a login page.
 */

import { oc } from "@orpc/contract";
import { z } from "zod";

export const OperatorViaEnum = z.enum(["loopback", "session"]);
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
