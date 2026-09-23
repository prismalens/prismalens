// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Operator route contracts
 *
 * Who the caller is to this instance. `via` names the credential that makes
 * the caller the operator, or is null for anyone else. Every caller presents
 * one, the host included (ADR 0004 §8).
 */

import { oc } from "@orpc/contract";
import { z } from "zod";

export const OperatorViaEnum = z.enum(["session"]);
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
