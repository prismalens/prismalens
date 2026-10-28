// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { IncomingHttpHeaders } from "node:http";
import { isIP } from "node:net";

/**
 * Whether a request reached the API straight from the host, not through a
 * proxy, a rebound name or another localhost origin (#931). Loopback alone
 * is not enough: `tailscale serve` also connects from 127.0.0.1, so the Host,
 * Origin and forwarding headers decide. A tunnel the operator built (ssh -L)
 * passes, by the operator's ruling: it already needs a shell on the host.
 */
export type LocalRefusal =
	| "peer-not-loopback"
	| "host-not-loopback"
	| "origin-mismatch"
	| "forwarded";

export interface LocalRequestFacts {
	remoteAddress: string | undefined;
	headers: IncomingHttpHeaders | Record<string, string | string[] | undefined>;
	listeningPort: number;
	/** The Vite dev server's origin, passed only when NODE_ENV is development. */
	devOrigin?: string;
}

const LOOPBACK_NAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);
const FORWARDING_HEADERS = [
	"forwarded",
	"x-forwarded-for",
	"x-forwarded-host",
	"x-forwarded-proto",
	"x-real-ip",
	"tailscale-user-login",
];

export function localRequestRefusal(
	facts: LocalRequestFacts,
): LocalRefusal | null {
	if (!isLoopbackPeer(facts.remoteAddress)) return "peer-not-loopback";
	const host = header(facts.headers, "host");
	const origin = header(facts.headers, "origin");
	if (
		facts.devOrigin &&
		origin === facts.devOrigin &&
		isLocalHost(host, facts.listeningPort)
	)
		return null;
	if (
		FORWARDING_HEADERS.some((name) => header(facts.headers, name) !== undefined)
	)
		return "forwarded";
	if (!isLocalHost(host, facts.listeningPort)) return "host-not-loopback";
	if (!origin || !sameAuthority(origin, host)) return "origin-mismatch";
	return null;
}

export function isLoopbackPeer(address: string | undefined): boolean {
	if (!address) return false;
	const plain = address.startsWith("::ffff:") ? address.slice(7) : address;
	if (isIP(plain) === 4) return plain.startsWith("127.");
	return plain === "::1";
}

function isLocalHost(host: string | undefined, port: number): boolean {
	if (!host) return false;
	try {
		const url = new URL(`http://${host}`);
		return LOOPBACK_NAMES.has(url.hostname) && url.port === String(port);
	} catch {
		return false;
	}
}

/** The page's origin names exactly the authority the request was sent to. */
function sameAuthority(origin: string, host: string | undefined): boolean {
	try {
		const url = new URL(origin);
		return (
			(url.protocol === "http:" || url.protocol === "https:") &&
			url.host === host
		);
	} catch {
		return false;
	}
}

function header(
	headers: LocalRequestFacts["headers"],
	name: string,
): string | undefined {
	const value = headers[name];
	return Array.isArray(value) ? value[0] : value;
}
