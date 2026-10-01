// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Cookies are scoped by host, not port, so two instances on one machine would
 * overwrite each other's `prismalens.device`. Each instance names its own (#763).
 */

/** The 0.5.0 name, and the prefix of every per-instance name. */
export const DEVICE_COOKIE_PREFIX = "prismalens.device";

export function deviceCookieName(instanceId: string): string {
	return `${DEVICE_COOKIE_PREFIX}.${instanceId.replace(/-/g, "").slice(0, 12).toLowerCase()}`;
}
