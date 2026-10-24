// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * One MCP client per vendor connection per run (#848, 06). `toolFetch` reaches only the
 * server's origin and counts every byte before the SDK parses it (OBJ-016, OBJ-019).
 */
import {
	type AuthProvider,
	Client,
	type FetchLike,
	StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import type { SourceCredential } from "@prismalens/contracts/schemas";
import { type CredentialKind, credentialKind } from "@prismalens/integrations";
import type { SourceConnection } from "../../integrations/source-request.js";
import { bearerOf } from "../../integrations/stored-credential.js";

export interface McpConnection {
	id: string;
	/** `CONNECTION_NAME`; it prefixes the tools this connection offers. */
	name: string;
	description: string;
	url: string;
	credential: SourceCredential;
	connection: SourceConnection;
}

export class OffTargetError extends Error {}
export class TooLargeError extends Error {}

const MAX_REDIRECTS = 3;

export interface Meter {
	/** Discovery's budget; calls after the snapshot are not counted (OBJ-027). */
	active: boolean;
	/** Bytes received so far on this connection. */
	received: number;
	maxResponse: number;
	maxTotal: number;
}

/** Records the bearer a request carried, per response, for `onUnauthorized` (OBJ-007). */
export type UsedTokens = WeakMap<Response, string>;

function counted(res: Response, meter: Meter): Response {
	if (!res.body || !meter.active) return res;
	let mine = 0;
	const body = res.body.pipeThrough(
		new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, ctl) {
				mine += chunk.byteLength;
				meter.received += chunk.byteLength;
				if (mine > meter.maxResponse || meter.received > meter.maxTotal)
					ctl.error(new TooLargeError("tool list too large"));
				else ctl.enqueue(chunk);
			},
		}),
	);
	return new Response(body, {
		status: res.status,
		statusText: res.statusText,
		headers: res.headers,
	});
}

/** The transport's fetch: the server's origin only, for the first request and every redirect. */
export function toolFetch(
	serverUrl: string,
	meter: Meter,
	usedToken: UsedTokens,
	base: typeof fetch = fetch,
	held?: Set<string>,
): FetchLike {
	const origin = new URL(serverUrl).origin;
	return async (input, init) => {
		let url = new URL(String(input instanceof Request ? input.url : input));
		if (url.origin !== origin)
			throw new OffTargetError("the MCP server's request leaves its origin");
		const bearer = bearerOf(
			Object.fromEntries(new Headers(init?.headers).entries()),
		);
		if (bearer) held?.add(bearer);
		for (let hop = 0; ; hop++) {
			const res = await base(url.href, { ...init, redirect: "manual" });
			const location =
				res.status >= 300 && res.status < 400 && res.headers.get("location");
			if (!location) {
				const out = counted(res, meter);
				if (bearer) usedToken.set(out, bearer);
				return out;
			}
			await res.body?.cancel();
			const next = new URL(location, url);
			if (next.origin !== origin || hop >= MAX_REDIRECTS)
				throw new OffTargetError("the MCP server redirected off its origin");
			url = next;
		}
	};
}

export interface Upstream {
	client: Client;
	meter: Meter;
	/** Every token this client sent or its refresh saved; a result is scrubbed of all (OBJ-023). */
	held: Set<string>;
	close(): Promise<void>;
}

export interface OpenOptions {
	meter: Meter;
	held: Set<string>;
	fetch?: typeof fetch;
	/** The `mcp-oauth` kind's lock-wrapped provider; built by the proxy. */
	authProvider?: (usedToken: UsedTokens, fetchFn: FetchLike) => AuthProvider;
	signal?: AbortSignal;
}

export async function openUpstream(
	c: McpConnection,
	opts: OpenOptions,
): Promise<Upstream> {
	const usedToken: UsedTokens = new WeakMap();
	const fetchFn = toolFetch(
		c.url,
		opts.meter,
		usedToken,
		opts.fetch,
		opts.held,
	);
	let headers: Record<string, string> = {};
	if (c.credential.kind === "bearer" || c.credential.kind === "header")
		headers = (
			await (credentialKind(c.credential.kind) as CredentialKind).authorize(
				c.credential as never,
				{
					connectionId: c.id,
					origin: new URL(c.url).origin,
					fetch: opts.fetch ?? fetch,
					load: c.connection.load,
					save: c.connection.save,
				},
			)
		).headers;
	const transport = new StreamableHTTPClientTransport(new URL(c.url), {
		fetch: fetchFn,
		requestInit: { headers },
		...(c.credential.kind === "mcp-oauth" && opts.authProvider
			? {
					authProvider: opts.authProvider(usedToken, fetchFn),
					onInsufficientScope: "throw" as const,
				}
			: {}),
	});
	const client = new Client({ name: "prismalens", version: "1" });
	await client.connect(transport, { signal: opts.signal });
	return {
		client,
		meter: opts.meter,
		held: opts.held,
		close: () => client.close().catch(() => undefined),
	};
}
