// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** A recorded host answer (trimmed to the fields PrismaLens reads), from `hosts/`. */
export function hostFixture(name: string): unknown {
	return JSON.parse(
		readFileSync(join(import.meta.dirname, "hosts", `${name}.json`), "utf8"),
	);
}

export interface FakeRoute {
	body?: unknown;
	status?: number;
	headers?: Record<string, string>;
	/** Answers 304 when the request carries this ETag. */
	etag?: string;
}

/** A fetch that serves routes by URL path and query, and records each request. */
export function fakeHost(routes: Record<string, FakeRoute>) {
	const calls: { url: string; headers: Record<string, string> }[] = [];
	const impl = (async (input: string | URL, init?: RequestInit) => {
		const url = new URL(String(input));
		const headers = Object.fromEntries(
			Object.entries((init?.headers ?? {}) as Record<string, string>).map(
				([k, v]) => [k.toLowerCase(), v],
			),
		);
		calls.push({ url: url.href, headers });
		const route = routes[url.pathname + url.search] ?? routes[url.pathname];
		if (!route) return new Response("not found", { status: 404 });
		if (route.etag && headers["if-none-match"] === route.etag)
			return new Response(null, { status: 304 });
		return new Response(
			route.body === undefined ? null : JSON.stringify(route.body),
			{
				status: route.status ?? 200,
				headers: {
					"content-type": "application/json",
					...(route.etag ? { etag: route.etag } : {}),
					...route.headers,
				},
			},
		);
	}) as typeof fetch;
	return { impl, calls };
}
