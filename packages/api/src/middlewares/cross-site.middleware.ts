// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Refuses a state-changing request that rides the device cookie from another
 * site. `SameSite=Lax` does not stop it: a page on another port of the same
 * host is same-site, so the browser attaches the cookie anyway. The browser's
 * `Sec-Fetch-Site` tells the two apart; a Bearer client is not a browser and
 * is not checked. A client that sends no `Sec-Fetch-Site` (a script, an older
 * browser) is held to its `Origin`, when it sends one: it must name this port.
 *
 * Form-encoded and plain-text bodies are refused outright: the app sends JSON
 * and multipart uploads only, and those two are what a cross-site form can
 * send without a preflight.
 */

import type { NextFunction, Request, Response } from "express";
import { readCookie } from "../core/auth/device-cookie.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const ALLOWED_FETCH_SITES = new Set(["same-origin", "none"]);
const REFUSED_CONTENT_TYPES = [
	"application/x-www-form-urlencoded",
	"text/plain",
];

export interface CrossSiteOptions {
	/** This instance's device cookie name; read per request, it is lazy. */
	cookieName: () => string;
	/** Path prefixes that take signed, credential-free posts (webhooks). */
	exemptPathPrefixes?: string[];
}

export function createCrossSiteMiddleware(options: CrossSiteOptions) {
	const exempt = options.exemptPathPrefixes ?? [];
	return function crossSite(
		req: Request,
		res: Response,
		next: NextFunction,
	): void {
		if (SAFE_METHODS.has(req.method)) {
			next();
			return;
		}
		const path = req.path ?? "";
		if (exempt.some((prefix) => path.startsWith(prefix))) {
			next();
			return;
		}

		const contentType = (req.headers["content-type"] ?? "")
			.split(";")[0]
			.trim()
			.toLowerCase();
		if (REFUSED_CONTENT_TYPES.includes(contentType)) {
			res.status(415).json({
				statusCode: 415,
				error: "Unsupported Media Type",
				message: `PrismaLens accepts JSON request bodies, not ${contentType}.`,
			});
			return;
		}

		const auth = req.headers.authorization;
		const bearer = typeof auth === "string" && /^bearer\s+/i.test(auth);
		if (bearer || !readCookie(req.headers.cookie, options.cookieName())) {
			next();
			return;
		}
		const site = req.headers["sec-fetch-site"];
		const value = Array.isArray(site) ? site[0] : site;
		if (
			value
				? ALLOWED_FETCH_SITES.has(value.toLowerCase())
				: originOnThisPort(req)
		) {
			next();
			return;
		}
		res.status(403).json({
			statusCode: 403,
			error: "Forbidden",
			message: "Blocked a cross-site request that carried the device cookie.",
		});
	};
}

const DEFAULT_PORT: Record<string, string> = { "http:": "80", "https:": "443" };

/** No Origin, or one on the port this request reached; the host allowlist vets its hostname. */
function originOnThisPort(req: Request): boolean {
	const origin = req.headers.origin;
	if (!origin) return true;
	let url: URL;
	try {
		url = new URL(origin);
	} catch {
		return false;
	}
	const host = req.headers.host ?? "";
	const hostPort =
		/:(\d+)$/.exec(host)?.[1] ?? DEFAULT_PORT[`${req.protocol}:`];
	return (url.port || DEFAULT_PORT[url.protocol]) === hostPort;
}
