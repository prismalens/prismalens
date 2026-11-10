// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The owner is the device holding `admin:access`: the host's own session.
 * Everything instance-wide (settings, credentials, resets, what agents may
 * run) is the owner's to change; a paired device uses the instance.
 */

import { ORPCError } from "@orpc/nest";
import { ACCESS_SCOPE } from "@prismalens/auth";
import type { Request } from "express";

export const OWNER_ONLY = "Only the owner can do this.";

export function isOwner(request: unknown): boolean {
	return !!(request as Request | undefined)?.operator?.device.scopes.includes(
		ACCESS_SCOPE,
	);
}

/** Refuses anyone but the owner; answers the owner's device id. */
export function requireOwner(
	request: unknown,
	message = OWNER_ONLY,
): string | null {
	if (!isOwner(request)) throw new ORPCError("FORBIDDEN", { message });
	return (request as Request).operator?.device.id ?? null;
}
