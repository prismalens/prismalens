// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The owner is the device holding `admin:access`: the host's own session.
 * Everything instance-wide (settings, credentials, resets, what agents may
 * run) is the owner's to change; a paired device uses the instance.
 */

import { ORPCError } from "@orpc/nest";
import { ACCESS_SCOPE, OPERATE_SCOPE } from "@prismalens/auth";
import type { Request } from "express";

export const OWNER_ONLY = "Only the owner can do this.";

export function isOwner(request: unknown): boolean {
	return !!(request as Request | undefined)?.operator?.device.scopes.includes(
		ACCESS_SCOPE,
	);
}

export const VIEW_ONLY = "This device can view and answer, not start runs.";

/** Refuses a device paired to view and answer from starting, continuing or stopping a run. */
export function requireOperate(request: unknown): void {
	const scopes = (request as Request | undefined)?.operator?.device.scopes;
	if (!scopes?.includes(OPERATE_SCOPE))
		throw new ORPCError("FORBIDDEN", { message: VIEW_ONLY });
}

/** Refuses anyone but the owner; answers the owner's device id. */
export function requireOwner(
	request: unknown,
	message = OWNER_ONLY,
): string | null {
	if (!isOwner(request)) throw new ORPCError("FORBIDDEN", { message });
	return (request as Request).operator?.device.id ?? null;
}
