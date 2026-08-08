// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Host/Origin allowlist middleware — DNS-rebinding defence.
 *
 * Collapsing the app to one process (ADR-0029) removed the unauthenticated
 * frontend origin, but it did not remove the DNS-rebinding *class*: `@Public()`
 * routes (login, session, setup) stay reachable, and during the pre-setup
 * window a rebound page could drive owner creation. CORS does not help here —
 * a rebound page is *same-origin* from the browser's point of view, so no
 * preflight happens and no `Access-Control-*` header is consulted.
 *
 * What does catch it is the `Host` header: the browser sends the attacker's
 * hostname (`evil.example`) even after that name has been rebound to
 * `127.0.0.1`. Rejecting hostnames we never expected to be reached by closes
 * the gap.
 *
 * Matching rules:
 * - **Hostname only, port ignored.** DNS controls names, not ports, so the port
 *   carries no security signal, and ignoring it keeps the dev Vite proxy
 *   (`:3000` → `:3001`) and any `--port` override working unconfigured.
 * - **IP literals are always allowed.** DNS rebinding cannot make a browser
 *   send a raw IP as `Host` — the browser sends the *name* it was asked to
 *   visit. Allowing IP literals is therefore free of rebinding risk and is what
 *   makes a LAN bind (`--host 0.0.0.0`, reached at `http://192.168.1.5:3001`)
 *   work without configuration. Same rule Vite's `server.allowedHosts` uses.
 * - **`Origin` is held to the same allowlist** when present, so a rebound page
 *   that somehow presents an acceptable `Host` still fails on its own origin.
 */

import { isIP } from "node:net";
import type { NextFunction, Request, Response } from "express";

/** Hostnames that always resolve to the local machine. */
const LOOPBACK_HOSTNAMES = ["localhost"] as const;

/** Sentinel that disables the check entirely (explicit operator opt-out). */
export const ALLOWED_HOSTS_WILDCARD = "*";

export interface HostAllowlistOptions {
	/**
	 * Allowed hostnames. Entries may be bare hostnames (`prismalens.example`),
	 * authorities (`prismalens.example:8443`) or URLs
	 * (`https://prismalens.example`) — everything but the hostname is discarded.
	 */
	allowedHostnames: string[];
	/** When true the middleware is a no-op (`PRISMALENS_ALLOWED_HOSTS=*`). */
	disabled?: boolean;
	/**
	 * Runtime path prefixes exempt from the **Origin** check only. The `Host`
	 * check always applies. Used for webhook routes, which are deliberately
	 * cross-origin-reachable (`PRISMALENS_CORS_WEBHOOK_OPEN`) and authenticate
	 * with signatures rather than cookies.
	 */
	originExemptPathPrefixes?: string[];
}

/**
 * Reduce an allowlist entry to a bare, comparable hostname.
 *
 * Accepts `example.com`, `example.com:8443`, `http://example.com/`, and
 * bracketed IPv6 (`[::1]:3001`). Returns `undefined` for entries that cannot be
 * read as a host, so a typo drops that entry rather than silently widening the
 * allowlist.
 */
export function normalizeHostname(value: string): string | undefined {
	const trimmed = value.trim();
	if (!trimmed) return undefined;

	// A URL-shaped entry: let the URL parser strip scheme/path/port for us.
	if (trimmed.includes("://")) {
		try {
			return stripTrailingDot(
				stripBrackets(new URL(trimmed).hostname).toLowerCase(),
			);
		} catch {
			return undefined;
		}
	}

	// Bracketed IPv6 literal, optionally with a port: `[::1]` / `[::1]:3001`.
	const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(trimmed);
	if (bracketed) return bracketed[1].toLowerCase();

	// A bare IPv6 literal carries colons but no port.
	if (isIP(trimmed) !== 0) return trimmed.toLowerCase();

	// Anything else: strip a trailing `:port` if present.
	const host = trimmed.split(":")[0];
	if (!host) return undefined;
	return stripTrailingDot(host.toLowerCase());
}

/**
 * Drop the root-label dot from a fully qualified name. `localhost.` and
 * `localhost` are the same host, and a browser sends whichever the user typed.
 * Stripping it cannot widen the allowlist — `evil.example.` still reduces to
 * `evil.example`, which is still not on it.
 */
function stripTrailingDot(host: string): string {
	return host.length > 1 && host.endsWith(".") ? host.slice(0, -1) : host;
}

function stripBrackets(host: string): string {
	return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

/**
 * The allowlist that applies when the operator configured nothing — loopback
 * names only. `npx prismalens up` must work with zero configuration, and its
 * default bind is loopback.
 */
export function defaultAllowedHostnames(): string[] {
	return [...LOOPBACK_HOSTNAMES];
}

/**
 * Build the effective allowlist from configuration.
 *
 * Loopback names are always present: dropping them would break the local
 * operator, who is the only user in the `pl up` case, and they carry no
 * rebinding risk (a rebound page presents the *attacker's* hostname, never
 * `localhost`).
 */
export function resolveAllowedHostnames(input: {
	allowedHosts?: string | undefined;
	publicUrl?: string | undefined;
	domain?: string | undefined;
	corsOrigins?: string | undefined;
}): { hostnames: string[]; disabled: boolean } {
	if (input.allowedHosts?.trim() === ALLOWED_HOSTS_WILDCARD) {
		return { hostnames: [], disabled: true };
	}

	const hostnames = new Set(defaultAllowedHostnames());

	for (const entry of [
		...(input.allowedHosts?.split(",") ?? []),
		input.publicUrl ?? "",
		input.domain ?? "",
		// A configured CORS origin is an origin the operator has already
		// authorized to talk to this server. Leaving it out would let the
		// allowlist 403 the very requests `PRISMALENS_CORS_ORIGIN` exists to
		// permit — a grant dead on arrival. `*` never reaches here: the
		// bootstrap exits on it.
		...(input.corsOrigins?.split(",") ?? []),
	]) {
		const hostname = normalizeHostname(entry);
		if (hostname) hostnames.add(hostname);
	}

	return { hostnames: [...hostnames], disabled: false };
}

/**
 * True when the bind address only accepts connections from this machine.
 *
 * Anything else — `0.0.0.0`, `::`, a LAN address — puts the app on the network
 * and is an explicit opt-in the bootstrap warns about.
 */
export function isLoopbackBindAddress(address: string): boolean {
	const host = stripBrackets(address.trim()).toLowerCase();
	if (
		LOOPBACK_HOSTNAMES.includes(host as (typeof LOOPBACK_HOSTNAMES)[number])
	) {
		return true;
	}
	if (isIP(host) === 4) return host.startsWith("127.");
	if (isIP(host) === 6) return host === "::1";
	return false;
}

/** True when `hostname` is acceptable under `allowed`. */
export function isHostnameAllowed(
	hostname: string | undefined,
	allowed: readonly string[],
): boolean {
	if (!hostname) return false;
	const normalized = normalizeHostname(hostname);
	if (!normalized) return false;
	// IP literals cannot be produced by DNS rebinding — see the module comment.
	if (isIP(normalized) !== 0) return true;
	return allowed.includes(normalized);
}

/**
 * Express middleware rejecting requests whose `Host` (or `Origin`) names a
 * hostname outside the allowlist.
 */
export function createHostAllowlistMiddleware(options: HostAllowlistOptions) {
	const allowed = options.allowedHostnames.map((h) => h.toLowerCase());
	const originExempt = options.originExemptPathPrefixes ?? [];

	return function hostAllowlist(
		req: Request,
		res: Response,
		next: NextFunction,
	): void {
		if (options.disabled) {
			next();
			return;
		}

		const hostHeader = headerValue(req.headers.host);
		if (!isHostnameAllowed(hostHeader, allowed)) {
			reject(res, "Host", hostHeader);
			return;
		}

		// Every supplied Origin is validated, including the opaque `null` that a
		// sandboxed iframe or a `file://` page sends. Nothing legitimate in a
		// single-origin app produces it, and exempting it would hand a rebound
		// page a way around this half of the check.
		const originHeader = headerValue(req.headers.origin);
		if (originHeader) {
			const path = req.path ?? "";
			const exempt = originExempt.some((prefix) => path.startsWith(prefix));
			if (!exempt) {
				const originHostname = safeUrlHostname(originHeader);
				if (!isHostnameAllowed(originHostname, allowed)) {
					reject(res, "Origin", originHeader);
					return;
				}
			}
		}

		next();
	};
}

function headerValue(value: string | string[] | undefined): string | undefined {
	if (Array.isArray(value)) return value[0];
	return value;
}

function safeUrlHostname(origin: string): string | undefined {
	try {
		return stripBrackets(new URL(origin).hostname);
	} catch {
		return undefined;
	}
}

function reject(
	res: Response,
	header: string,
	value: string | undefined,
): void {
	res.status(403).json({
		statusCode: 403,
		error: "Forbidden",
		message:
			`Blocked request: ${header} header ${value ? `"${value}"` : "is missing"} is not allowlisted. ` +
			"If this hostname is how you reach PrismaLens, add it to PRISMALENS_ALLOWED_HOSTS " +
			"(comma-separated).",
	});
}
