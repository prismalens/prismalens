// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Integration coverage for the bootstrap's security middleware: a real HTTP
 * server, real requests, real response headers.
 *
 * `fetch` cannot be used here — undici forbids setting the `Host` header, which
 * is exactly the header under test. `node:http` sends what it is given.
 */

import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHelmetMiddleware } from "./helmet.middleware.js";
import {
	createHostAllowlistMiddleware,
	resolveAllowedHostnames,
} from "./host-allowlist.middleware.js";

interface Probe {
	status: number;
	headers: Record<string, string | string[] | undefined>;
	body: string;
}

let server: Server;
let port: number;

function probe(headers: Record<string, string>, path = "/api/health"): Promise<Probe> {
	return new Promise((resolve, reject) => {
		const req = httpRequest(
			{ host: "127.0.0.1", port, path, method: "GET", headers },
			(res) => {
				let body = "";
				res.setEncoding("utf8");
				res.on("data", (chunk) => {
					body += chunk;
				});
				res.on("end", () =>
					resolve({ status: res.statusCode ?? 0, headers: res.headers, body }),
				);
			},
		);
		req.on("error", reject);
		req.end();
	});
}

beforeAll(async () => {
	// The unconfigured default — exactly what `npx prismalens up` boots with.
	const { hostnames, disabled } = resolveAllowedHostnames({});

	// Same registration order as the bootstrap: helmet first so its headers
	// also land on the allowlist's rejections.
	const app = express();
	app.use(createHelmetMiddleware({ https: false }));
	app.use(
		createHostAllowlistMiddleware({ allowedHostnames: hostnames, disabled }),
	);
	app.use((_req, res) => {
		res.json({ ok: true });
	});

	server = createServer(app);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
	await new Promise<void>((resolve, reject) =>
		server.close((err) => (err ? reject(err) : resolve())),
	);
});

describe("host allowlist over real HTTP", () => {
	it("serves a request whose Host is the unconfigured default", async () => {
		const res = await probe({ host: `localhost:${port}` });
		expect(res.status).toBe(200);
		expect(JSON.parse(res.body)).toEqual({ ok: true });
	});

	it("serves a request whose Host is a raw IP (LAN bind, no configuration)", async () => {
		const res = await probe({ host: `192.168.1.5:${port}` });
		expect(res.status).toBe(200);
	});

	it("rejects a rebound hostname with 403", async () => {
		const res = await probe({ host: "rebound.attacker.test" });
		expect(res.status).toBe(403);
		expect(res.body).toContain("rebound.attacker.test");
		expect(res.body).toContain("PRISMALENS_ALLOWED_HOSTS");
	});

	it("rejects a request that only carries a hostile Origin", async () => {
		const res = await probe({
			host: `localhost:${port}`,
			origin: "https://evil.example",
		});
		expect(res.status).toBe(403);
		expect(res.body).toContain("Origin");
	});

	it("blocks a rebound request to the pre-setup route, not just /api", async () => {
		const res = await probe({ host: "rebound.attacker.test" }, "/api/setup");
		expect(res.status).toBe(403);
	});

	it("carries the security headers on the rejection too", async () => {
		const res = await probe({ host: "rebound.attacker.test" });
		expect(res.status).toBe(403);
		expect(res.headers["content-security-policy"]).toBeDefined();
		expect(res.headers["x-content-type-options"]).toBe("nosniff");
		expect(res.headers["x-powered-by"]).toBeUndefined();
	});
});

describe("helmet headers", () => {
	it("sets the hardening headers on an allowed response", async () => {
		const res = await probe({ host: `localhost:${port}` });

		expect(res.headers["x-content-type-options"]).toBe("nosniff");
		// DENY, not helmet's SAMEORIGIN default — it must agree with the CSP's
		// `frame-ancestors 'none'` for browsers on the legacy header.
		expect(res.headers["x-frame-options"]).toBe("DENY");
		expect(res.headers["referrer-policy"]).toBe("no-referrer");
		expect(res.headers["cross-origin-opener-policy"]).toBe("same-origin");
		expect(res.headers["x-dns-prefetch-control"]).toBe("off");
		expect(res.headers["x-powered-by"]).toBeUndefined();
	});

	it("ships a CSP that locks every fetch directive to 'self'", async () => {
		const res = await probe({ host: `localhost:${port}` });
		const csp = res.headers["content-security-policy"];
		expect(typeof csp).toBe("string");
		const directives = String(csp);

		expect(directives).toContain("default-src 'self'");
		expect(directives).toContain("frame-ancestors 'none'");
		expect(directives).toContain("object-src 'none'");
		expect(directives).toContain("base-uri 'self'");
		expect(directives).toContain("form-action 'self'");
		expect(directives).toContain("connect-src 'self'");
	});

	it("keeps the two documented SPA relaxations and nothing more", async () => {
		const res = await probe({ host: `localhost:${port}` });
		const directives = String(res.headers["content-security-policy"]);

		// Relaxation 1: TanStack's inline hydration scripts, no nonce possible
		// for statically served files.
		expect(directives).toContain("script-src 'self' 'unsafe-inline'");
		expect(directives).toContain("style-src 'self' 'unsafe-inline'");
		// Relaxation 2: would rewrite same-origin subresources to https on the
		// plain-HTTP localhost origin.
		expect(directives).not.toContain("upgrade-insecure-requests");
		// No third relaxation crept in: nothing external may be loaded.
		expect(directives).not.toContain("*");
		expect(directives).not.toContain("unsafe-eval");
	});

	it("omits HSTS when the process is not serving TLS", async () => {
		const res = await probe({ host: `localhost:${port}` });
		expect(res.headers["strict-transport-security"]).toBeUndefined();
	});
});

describe("a configured CORS origin survives the allowlist", () => {
	// The contradiction this guards: PRISMALENS_CORS_ORIGIN grants an origin
	// permission to call the API, and the Origin half of the allowlist would
	// reject that very request before the grant was ever consulted.
	it("passes the granted origin and still refuses every other one", async () => {
		const { hostnames } = resolveAllowedHostnames({
			corsOrigins: "https://dash.example.com",
		});

		const app = express();
		app.use(createHostAllowlistMiddleware({ allowedHostnames: hostnames }));
		app.use((_req, res) => {
			res.json({ ok: true });
		});

		const srv = createServer(app);
		await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
		const p = (srv.address() as AddressInfo).port;

		const send = (headers: Record<string, string>, method: string) =>
			new Promise<number>((resolve, reject) => {
				const req = httpRequest(
					{ host: "127.0.0.1", port: p, path: "/api/health", method, headers },
					(r) => {
						r.resume();
						r.on("end", () => resolve(r.statusCode ?? 0));
					},
				);
				req.on("error", reject);
				req.end();
			});

		const preflightHeaders = {
			host: `localhost:${p}`,
			origin: "https://dash.example.com",
			"access-control-request-method": "POST",
		};
		expect(await send(preflightHeaders, "OPTIONS")).toBe(200);
		expect(
			await send(
				{ host: `localhost:${p}`, origin: "https://dash.example.com" },
				"GET",
			),
		).toBe(200);
		expect(
			await send(
				{ host: `localhost:${p}`, origin: "https://other.example.com" },
				"GET",
			),
		).toBe(403);

		await new Promise<void>((resolve, reject) =>
			srv.close((err) => (err ? reject(err) : resolve())),
		);
	});
});

describe("helmet over TLS-terminating configuration", () => {
	it("adds HSTS when the process serves https", async () => {
		const app = express();
		app.use(createHelmetMiddleware({ https: true }));
		app.use((_req, res) => {
			res.json({ ok: true });
		});

		const tlsServer = createServer(app);
		await new Promise<void>((resolve) =>
			tlsServer.listen(0, "127.0.0.1", resolve),
		);
		const tlsPort = (tlsServer.address() as AddressInfo).port;

		const res = await new Promise<Probe>((resolve, reject) => {
			const req = httpRequest(
				{ host: "127.0.0.1", port: tlsPort, path: "/", method: "GET" },
				(r) => {
					r.resume();
					r.on("end", () =>
						resolve({ status: r.statusCode ?? 0, headers: r.headers, body: "" }),
					);
				},
			);
			req.on("error", reject);
			req.end();
		});

		expect(res.headers["strict-transport-security"]).toContain("max-age=15552000");

		await new Promise<void>((resolve, reject) =>
			tlsServer.close((err) => (err ? reject(err) : resolve())),
		);
	});
});
