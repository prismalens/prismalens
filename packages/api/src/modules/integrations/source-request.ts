// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { request as httpsRequest } from "node:https";
import type {
	ParsedSourceCredential,
	SourceCredential,
} from "@prismalens/contracts/schemas";
import type { AuthenticatedRequestFn } from "@prismalens/integrations";

/** A redirect would carry the credential to a host it was not saved for (#848). */
export class OffHostRedirectError extends Error {
	constructor(origin: string) {
		super(`the source redirected away from ${origin}; not followed`);
	}
}

/** The saved credential cannot be used; the message is PrismaLens's own, never upstream text. */
export class SourceConfigError extends Error {}

export interface SourceRequestOptions {
	timeoutMs?: number;
	/** Stop reading the body past this many bytes; the response then carries `x-prismalens-truncated`. */
	maxBytes?: number;
	maxRedirects?: number;
	fetchImpl?: typeof fetch;
}

export const TRUNCATED_HEADER = "x-prismalens-truncated";

export function credentialHeaders(c: SourceCredential): Record<string, string> {
	switch (c.kind) {
		case "bearer":
			return { Authorization: `Bearer ${c.token}` };
		case "basic":
			return {
				Authorization: `Basic ${Buffer.from(`${c.username}:${c.password}`).toString("base64")}`,
			};
		case "header":
			return { [c.name]: c.value };
		default:
			return {};
	}
}

/** Every secret string a credential holds, for scrubbing anything that leaves the api. */
export function credentialSecrets(c: SourceCredential): string[] {
	switch (c.kind) {
		case "bearer":
			return [c.token];
		case "basic":
			return [
				c.password,
				Buffer.from(`${c.username}:${c.password}`).toString("base64"),
			];
		case "header":
			return [c.value];
		case "mtls":
			return [c.key];
		default:
			return [];
	}
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
		const headers = { ...options?.headers, ...credentialHeaders(credential) };
		// Relative to the base path, so a reverse-proxy prefix (http://host/prometheus) survives.
		let url = new URL(path.replace(/^\/+/, ""), baseUrl.replace(/\/?$/, "/"));
		for (let hop = 0; ; hop++) {
			const res =
				credential.kind === "mtls"
					? await mtlsFetch(
							url,
							method,
							headers,
							credential,
							signal,
							options?.body,
						)
					: await (opts.fetchImpl ?? fetch)(url.href, {
							method,
							headers,
							body: options?.body,
							signal,
							redirect: "manual",
						});
			const location =
				res.status >= 300 && res.status < 400 && res.headers.get("location");
			if (!location) return opts.maxBytes ? capped(res, opts.maxBytes) : res;
			await res.body?.cancel();
			const next = new URL(location, url);
			if (next.origin !== origin) throw new OffHostRedirectError(origin);
			if (hop >= maxRedirects) throw new Error("too many redirects");
			url = next;
		}
	};
}

function mtlsFetch(
	url: URL,
	method: string,
	headers: Record<string, string>,
	c: Extract<SourceCredential, { kind: "mtls" }>,
	signal: AbortSignal,
	body?: string,
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
				res.on("data", (d: Buffer) => chunks.push(d));
				res.on("error", reject);
				res.on("end", () => {
					const h = new Headers();
					for (const [k, v] of Object.entries(res.headers))
						if (v !== undefined) h.set(k, Array.isArray(v) ? v.join(", ") : v);
					const status = res.statusCode ?? 502;
					const empty = status === 204 || status === 304;
					resolve(
						new Response(empty ? null : Buffer.concat(chunks), {
							status,
							statusText: res.statusMessage ?? "",
							headers: h,
						}),
					);
				});
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
