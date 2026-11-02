// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { IncomingMessage } from "node:http";
import { ACCESS_SCOPE, terminalKeyFor } from "@prismalens/auth";
import { getOrCreateAuthSecret } from "@prismalens/config";
import { localRequestRefusal } from "./local-request.js";

/** The Vite dev server's origin; production has no such branch. */
export function devOrigin(
	env: NodeJS.ProcessEnv = process.env,
): string | undefined {
	if (env.NODE_ENV !== "development") return undefined;
	return `http://localhost:${env.PRISMALENS_FRONTEND_PORT ?? "3000"}`;
}

/**
 * The terminal key for a device, or undefined unless it holds `admin:access`
 * and the request came straight from the host (#931). Redeem and claimKey use
 * it; a link redeemed over a tailnet or a proxy never yields one.
 */
export function issueTerminalKey(
	request: IncomingMessage,
	device: { id: string; scopes: readonly string[] },
): string | undefined {
	if (!device.scopes?.includes(ACCESS_SCOPE)) return undefined;
	const refusal = localRequestRefusal({
		remoteAddress: request.socket?.remoteAddress,
		headers: request.headers,
		listeningPort: request.socket?.localPort ?? -1,
		devOrigin: devOrigin(),
	});
	return refusal
		? undefined
		: terminalKeyFor(device.id, getOrCreateAuthSecret());
}
