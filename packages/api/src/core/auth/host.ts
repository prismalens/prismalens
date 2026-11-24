// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ORPCError } from "@orpc/nest";
import type { Request } from "express";
import { localRequestRefusal } from "../../modules/terminal/local-request.js";
import { devOrigin } from "../../modules/terminal/terminal-key-issue.js";
import { isOwner } from "./owner.js";

export const HOST_ONLY = "This only works on the computer running PrismaLens.";

/**
 * The owner asking straight from the host's own browser (#931, #1216): an action that opens a
 * window on the host's screen must not run for a paired device or through a proxy.
 */
export function isHostOwner(request: unknown): boolean {
	const req = request as Request | undefined;
	if (!req || !isOwner(req)) return false;
	return (
		localRequestRefusal({
			remoteAddress: req.socket?.remoteAddress,
			headers: req.headers,
			listeningPort: req.socket?.localPort ?? -1,
			devOrigin: devOrigin(),
		}) === null
	);
}

export function requireHostOwner(request: unknown): void {
	if (!isHostOwner(request))
		throw new ORPCError("FORBIDDEN", { message: HOST_ONLY });
}
