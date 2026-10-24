// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { AuthenticatedRequestFn } from "./types.js";

export interface FakeReply {
	status?: number;
	body: unknown;
	headers?: Record<string, string>;
}

export interface FakeApi {
	origin: string;
	requests: Array<{ method: string; url: string; authorization?: string }>;
	/** Adds the bearer token the way template-request does, so adapters never hold it. */
	request: (token: string, prefix?: string) => AuthenticatedRequestFn;
	close: () => Promise<void>;
}

/** A local HTTP server answering GETs from a route function. */
export async function startFakeApi(
	routes: (url: URL) => FakeReply | undefined,
): Promise<FakeApi> {
	const requests: FakeApi["requests"] = [];
	const server: Server = createServer((req, res) => {
		const url = new URL(req.url ?? "/", "http://fake");
		requests.push({
			method: req.method ?? "",
			url: `${url.pathname}${url.search}`,
			authorization: req.headers.authorization,
		});
		const reply = req.method === "GET" ? routes(url) : undefined;
		if (!reply) {
			res.writeHead(404).end();
			return;
		}
		const raw = typeof reply.body === "string";
		res.writeHead(reply.status ?? 200, {
			"content-type": raw ? "text/plain" : "application/json",
			...reply.headers,
		});
		res.end(raw ? (reply.body as string) : JSON.stringify(reply.body));
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	return {
		origin,
		requests,
		request:
			(token, prefix = "") =>
			(method, path) =>
				fetch(`${origin}${prefix}${path}`, {
					method,
					headers: { authorization: `Bearer ${token}` },
				}),
		close: () => new Promise((r) => server.close(() => r())),
	};
}
