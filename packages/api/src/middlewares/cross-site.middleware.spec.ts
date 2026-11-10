// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCrossSiteMiddleware } from "./cross-site.middleware.js";

let server: Server;
let port: number;

function send(
	headers: Record<string, string>,
	method = "POST",
	path = "/api/rpc/x",
): Promise<number> {
	return new Promise((resolve, reject) => {
		const req = httpRequest(
			{ host: "127.0.0.1", port, path, method, headers, agent: false },
			(res) => {
				res.resume();
				res.on("end", () => resolve(res.statusCode ?? 0));
			},
		);
		req.on("error", reject);
		req.end("{}");
	});
}

beforeAll(async () => {
	const app = express();
	app.use(
		createCrossSiteMiddleware({
			cookieName: () => "pl_dev",
			exemptPathPrefixes: ["/api/webhooks/"],
		}),
	);
	app.use((_req, res) => {
		res.json({ ok: true });
	});
	server = createServer(app);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

const json = { "content-type": "application/json" };
const cookie = { ...json, cookie: "pl_dev=token" };

describe("cross-site middleware", () => {
	it("refuses a same-site post that carries the device cookie", async () => {
		expect(await send({ ...cookie, "sec-fetch-site": "same-site" })).toBe(403);
		expect(await send({ ...cookie, "sec-fetch-site": "cross-site" })).toBe(
			403,
		);
	});

	it("holds a client without Sec-Fetch-Site to an Origin on this port", async () => {
		expect(
			await send({ ...cookie, origin: `http://127.0.0.1:${port + 1}` }),
		).toBe(403);
		expect(await send({ ...cookie, origin: "null" })).toBe(403);
		expect(await send({ ...cookie, origin: `http://localhost:${port}` })).toBe(
			200,
		);
		expect(await send(cookie)).toBe(200);
	});

	it("reads the scheme a loopback TLS proxy reports when the Origin has no port", async () => {
		const proxied = { ...cookie, host: "box.tail1234.ts.net" };
		expect(
			await send({
				...proxied,
				origin: "https://box.tail1234.ts.net",
				"x-forwarded-proto": "https",
			}),
		).toBe(200);
		expect(
			await send({ ...proxied, origin: "https://box.tail1234.ts.net" }),
		).toBe(403);
	});

	it("lets the app's own requests through", async () => {
		expect(await send({ ...cookie, "sec-fetch-site": "same-origin" })).toBe(
			200,
		);
		expect(await send({ ...cookie, "sec-fetch-site": "none" })).toBe(200);
		expect(
			await send({ ...cookie, "sec-fetch-site": "same-site" }, "GET"),
		).toBe(200);
	});

	it("does not check a Bearer client or a request with no cookie", async () => {
		expect(await send({ ...json, authorization: "Bearer t" })).toBe(200);
		expect(await send({ ...json, cookie: "other=1" })).toBe(200);
	});

	it("refuses form-encoded and plain-text bodies", async () => {
		expect(
			await send({
				"content-type": "application/x-www-form-urlencoded",
				"sec-fetch-site": "same-origin",
			}),
		).toBe(415);
		expect(await send({ "content-type": "text/plain;charset=UTF-8" })).toBe(
			415,
		);
	});

	it("leaves signed webhook posts alone", async () => {
		expect(
			await send(
				{ "content-type": "text/plain", cookie: "pl_dev=t" },
				"POST",
				"/api/webhooks/abc",
			),
		).toBe(200);
	});
});
