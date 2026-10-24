// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { request as httpsRequest } from "node:https";
import type {
	ParsedSourceCredential,
	SourceCredential,
} from "@prismalens/contracts/schemas";
import {
	type AuthenticatedRequestFn,
	type Authorization,
	type CredentialKind,
	credentialKind,
	credentialSecrets as kindSecrets,
	SignInExpired,
} from "@prismalens/integrations";
import { bearerOf } from "./stored-credential.js";

/** A request or redirect would carry the credential off the origin it was saved for (#848). */
export class OffOriginError extends Error {
	constructor(origin: string, redirect = true) {
		super(
			redirect
				? `the source redirected away from ${origin}; not followed`
				: `the request leaves ${origin}; not sent`,
		);
	}
}

const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:/i;

/** The saved credential cannot be used; the message is PrismaLens's own, never upstream text. */
export class SourceConfigError extends Error {}

export interface SourceRequestOptions {
	timeoutMs?: number;
	/** Stop reading the body past this many bytes; the response then carries `x-prismalens-truncated`. */
	maxBytes?: number;
	maxRedirects?: number;
	fetchImpl?: typeof fetch;
	/** A saved connection: refresh reads and writes its row, and problems land on it. */
	connection?: SourceConnection;
}

/** What a request learned about the credential; the connection's row shows it (#848). */
export type CredentialProblem =
	| { kind: "needs-permission"; message: string }
	| { kind: "sign-in-expired"; message: string };

export interface SourceConnection {
	id: string;
	load(): Promise<SourceCredential>;
	save(next: SourceCredential): Promise<void>;
	report?(problem: CredentialProblem): Promise<void>;
}

const REFRESHING = new Set<SourceCredential["kind"]>(["oauth", "oauth-client"]);

/** `needs permission: <scope>` from a 403, or null when the 403 is about something else. */
export function insufficientScope(res: Response): string | null {
	if (res.status !== 403) return null;
	const challenge = res.headers.get("www-authenticate") ?? "";
	let scope: string | undefined;
	if (/error="?insufficient_scope"?/i.test(challenge)) {
		// RFC 9110 auth-params may be a quoted string or a bare token.
		const m = /\bscope\s*=\s*(?:"([^"]*)"|([!#$%&'*+.^_`|~0-9A-Za-z-]+))/i.exec(
			challenge,
		);
		scope = m?.[1] ?? m?.[2] ?? "";
	}
	const accepted = res.headers.get("x-accepted-oauth-scopes");
	// A challenge that refuses without naming a scope takes the scope GitHub says it accepts.
	if (scope?.trim() === "" && accepted?.trim())
		scope = accepted
			.split(/[\s,]+/)
			.filter(Boolean)
			.join(" ");
	if (scope === undefined && accepted?.trim()) {
		// GitHub sends these on every answer; only a grant lacking all of them is a scope refusal.
		const held = (res.headers.get("x-oauth-scopes") ?? "")
			.split(/[\s,]+/)
			.filter(Boolean);
		const wants = accepted.split(/[\s,]+/).filter(Boolean);
		if (
			res.headers.get("x-ratelimit-remaining") !== "0" &&
			!wants.some((w) => held.includes(w))
		)
			scope = wants.join(" ");
	}
	if (scope === undefined) return null;
	const clean = scope
		.replace(/[^A-Za-z0-9:._ -]/g, "")
		.slice(0, 80)
		.trim();
	return `needs permission: ${clean || "unknown"}`;
}

export const TRUNCATED_HEADER = "x-prismalens-truncated";

/** Every secret string a credential holds, for scrubbing anything that leaves the api. */
export function credentialSecrets(
	c: SourceCredential,
	connectionId?: string,
): string[] {
	return kindSecrets(c, connectionId);
}

export function scrubSecrets(text: string, secrets: string[]): string {
	let out = text;
	for (const s of secrets)
		if (s.length >= 4) out = out.split(s).join("[redacted]");
	return out;
}

/**
 * The request function for a source with a credential: the credential goes only to
 * `baseUrl`'s origin, a redirect is followed only within it, and an unusable
 * credential rejects every request with its reason.
 */
export function sourceRequestFn(
	baseUrl: string,
	parsed: ParsedSourceCredential,
	opts: SourceRequestOptions = {},
): AuthenticatedRequestFn {
	const origin = new URL(baseUrl).origin;
	const maxRedirects = opts.maxRedirects ?? 3;
	return async (method, path, options) => {
		if (!parsed.ok) throw new SourceConfigError(parsed.message);
		const credential = parsed.credential;
		if (credential.kind === "mtls" && !baseUrl.startsWith("https:"))
			throw new SourceConfigError("a client certificate needs an https URL");
		const timeout = AbortSignal.timeout(opts.timeoutMs ?? 10_000);
		const signal = options?.signal
			? AbortSignal.any([timeout, options.signal])
			: timeout;
		if (ABSOLUTE_URL.test(path) || path.startsWith("//"))
			throw new OffOriginError(origin, false);
		const kind = credentialKind(credential.kind) as CredentialKind;
		const ctx = {
			connectionId: opts.connection?.id ?? `draft:${origin}`,
			origin,
			fetch: opts.fetchImpl ?? fetch,
			load: opts.connection?.load ?? (async () => credential),
			save: opts.connection?.save ?? (async () => {}),
			signal,
		};
		const authorize = async (renew?: { failedToken: string }) => {
			try {
				return await kind.authorize(
					credential as never,
					ctx,
					renew ? { renew } : undefined,
				);
			} catch (e) {
				if (e instanceof SignInExpired)
					await opts.connection?.report?.({
						kind: "sign-in-expired",
						message: e.message,
					});
				throw e;
			}
		};
		let auth: Authorization = await authorize();
		const headersOf = (a: Authorization) => ({
			...options?.headers,
			...a.headers,
		});
		let headers = headersOf(auth);
		// Relative to the base path, so a reverse-proxy prefix (http://host/prometheus) survives.
		let url = new URL(path.replace(/^\/+/, ""), baseUrl.replace(/\/?$/, "/"));
		if (url.origin !== origin) throw new OffOriginError(origin, false);
		let renewed = false;
		for (let hop = 0; ; hop++) {
			const res = auth.tls
				? await mtlsFetch(
						url,
						method,
						headers,
						auth.tls,
						signal,
						options?.body,
						opts.maxBytes,
					)
				: await (opts.fetchImpl ?? fetch)(url.href, {
						method,
						headers,
						body: options?.body,
						signal,
						redirect: "manual",
					});
			// OAuth only: one retry with a renewed token.
			if (res.status === 401 && !renewed && REFRESHING.has(credential.kind)) {
				renewed = true;
				await res.body?.cancel();
				auth = await authorize({ failedToken: bearerOf(auth.headers) ?? "" });
				headers = headersOf(auth);
				hop--;
				continue;
			}
			const needs = insufficientScope(res);
			if (needs)
				await opts.connection?.report?.({
					kind: "needs-permission",
					message: scrubSecrets(needs, [
						...kindSecrets(credential, ctx.connectionId),
						bearerOf(auth.headers) ?? "",
					]),
				});
			const location =
				res.status >= 300 && res.status < 400 && res.headers.get("location");
			if (!location) return opts.maxBytes ? capped(res, opts.maxBytes) : res;
			await res.body?.cancel();
			const next = new URL(location, url);
			if (next.origin !== origin) throw new OffOriginError(origin);
			if (hop >= maxRedirects) throw new Error("too many redirects");
			url = next;
		}
	};
}

function mtlsFetch(
	url: URL,
	method: string,
	headers: Record<string, string>,
	c: NonNullable<Authorization["tls"]>,
	signal: AbortSignal,
	body?: string,
	maxBytes?: number,
): Promise<Response> {
	return new Promise((resolve, reject) => {
		const req = httpsRequest(
			url,
			{
				method,
				headers,
				cert: c.cert,
				key: c.key,
				...(c.ca ? { ca: c.ca } : {}),
				signal,
			},
			(res) => {
				const chunks: Buffer[] = [];
				let size = 0;
				let settled = false;
				const finish = (truncated: boolean) => {
					if (settled) return;
					settled = true;
					const h = new Headers();
					for (const [k, v] of Object.entries(res.headers))
						if (v !== undefined) h.set(k, Array.isArray(v) ? v.join(", ") : v);
					if (truncated) h.set(TRUNCATED_HEADER, "1");
					const status = res.statusCode ?? 502;
					const empty = status === 204 || status === 304;
					resolve(
						new Response(empty ? null : Buffer.concat(chunks), {
							status,
							statusText: res.statusMessage ?? "",
							headers: h,
						}),
					);
				};
				res.on("data", (d: Buffer) => {
					if (settled) return;
					if (maxBytes !== undefined && size + d.length > maxBytes) {
						chunks.push(d.subarray(0, maxBytes - size));
						finish(true);
						res.destroy();
						return;
					}
					chunks.push(d);
					size += d.length;
				});
				res.on("error", reject);
				res.on("end", () => finish(false));
			},
		);
		req.on("error", reject);
		req.end(body);
	});
}

async function capped(res: Response, maxBytes: number): Promise<Response> {
	if (!res.body) return res;
	const reader = res.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	let truncated = false;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (size + value.length > maxBytes) {
			chunks.push(value.subarray(0, maxBytes - size));
			truncated = true;
			await reader.cancel();
			break;
		}
		chunks.push(value);
		size += value.length;
	}
	const headers = new Headers(res.headers);
	if (truncated) headers.set(TRUNCATED_HEADER, "1");
	return new Response(Buffer.concat(chunks), {
		status: res.status,
		statusText: res.statusText,
		headers,
	});
}
