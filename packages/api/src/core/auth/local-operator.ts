// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The loopback rule (ADR 0004 §8): a request from the host itself is the
 * operator and needs no credential.
 *
 * Decided per request, never per bind. A reverse proxy or `tailscale serve`
 * delivers remote traffic to a loopback bind, so the bind address says nothing
 * about who is on the other end. Four tests, all of which must hold:
 *
 * 1. The TCP peer is a loopback address.
 * 2. `Host` names loopback (`localhost` or a loopback IP literal), so a page
 *    reached through a proxy or a rebound hostname fails here.
 * 3. No `Forwarded` / `X-Forwarded-*` header: every proxy adds one, and a
 *    client cannot remove what a proxy in front of it appends.
 * 4. The placement is `laptop`. A server placement is reached over a route
 *    and pairs its clients; nothing on it is the operator by proximity.
 *
 * This decides whether a session is ISSUED, never whether one is checked:
 * state changes still carry the cookie, and the Host/Origin allowlist rejects
 * a foreign `Origin`, so a cross-site form POST to loopback does not pass.
 */

import type { IncomingHttpHeaders } from "node:http";
import { isIP } from "node:net";
import type { Placement } from "@prismalens/config/harness";

const LOOPBACK_NAMES = new Set(["localhost"]);

const FORWARDING_HEADERS = [
	"forwarded",
	"x-forwarded-for",
	"x-forwarded-host",
	"x-forwarded-proto",
	"x-real-ip",
] as const;

export interface LocalOperatorInput {
	/** `req.socket.remoteAddress`. */
	remoteAddress: string | undefined;
	/** `req.headers`, read for `host` and the forwarding headers. */
	headers: IncomingHttpHeaders;
	placement: Placement;
}

/** `127.0.0.0/8`, `::1`, and the IPv4-mapped forms Node reports on dual-stack sockets. */
export function isLoopbackAddress(address: string | undefined): boolean {
	if (!address) return false;
	const bare = address.startsWith("::ffff:") ? address.slice(7) : address;
	if (bare === "::1") return true;
	return isIP(bare) === 4 && bare.startsWith("127.");
}

/** The hostname part of a `Host` header: `localhost:3001`, `[::1]:3001`, `127.0.0.1`. */
export function hostHeaderName(host: string | undefined): string | undefined {
	if (!host) return undefined;
	const trimmed = host.trim().toLowerCase();
	const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(trimmed);
	if (bracketed) return bracketed[1];
	if (isIP(trimmed) !== 0) return trimmed;
	const name = trimmed.split(":")[0];
	return name?.replace(/\.$/, "") || undefined;
}

export function isLoopbackHost(host: string | undefined): boolean {
	const name = hostHeaderName(host);
	if (!name) return false;
	return LOOPBACK_NAMES.has(name) || isLoopbackAddress(name);
}

export function hasForwardingHeader(headers: IncomingHttpHeaders): boolean {
	return FORWARDING_HEADERS.some((name) => headers[name] !== undefined);
}

export function isLocalOperatorRequest(input: LocalOperatorInput): boolean {
	if (input.placement !== "laptop") return false;
	if (!isLoopbackAddress(input.remoteAddress)) return false;
	const host = input.headers.host;
	if (!isLoopbackHost(Array.isArray(host) ? host[0] : host)) return false;
	return !hasForwardingHeader(input.headers);
}
