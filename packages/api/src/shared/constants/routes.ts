// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Route constants shared between `main.ts` (global prefix), middleware
 * registration (`app.module.ts`) and guards.
 *
 * Guards see the *runtime* path, which includes the global prefix, so anything
 * that compares `request.path` must build it from these constants rather than
 * hardcoding the unprefixed contract path.
 */

/** Global prefix applied to every controller route (see `main.ts`). */
export const API_GLOBAL_PREFIX = "api";

/** Routes excluded from the global prefix. */
export const API_GLOBAL_PREFIX_EXCLUDE = ["health", "/"];

/** Webhook routes as declared in the contracts, without the global prefix. */
export const WEBHOOK_ROUTES = {
	generic: "webhooks/generic",
	prometheus: "webhooks/prometheus",
	render: "webhooks/render",
} as const;

/** Express-5 wildcard matching every webhook route, without the global prefix. */
export const WEBHOOK_ROUTE_WILDCARD = "webhooks/*path";

/** Runtime path of the Render webhook, i.e. what `request.path` reports. */
export const RENDER_WEBHOOK_PATH = `/${API_GLOBAL_PREFIX}/${WEBHOOK_ROUTES.render}`;
