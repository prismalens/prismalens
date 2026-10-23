// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import { createServer as createTlsServer, request as httpsRequest } from "node:https";
import type { AddressInfo } from "node:net";
import type { TLSSocket } from "node:tls";
import {
	parseSourceCredential,
	type SourceCredential,
} from "@prismalens/contracts/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	CA_CERT,
	CLIENT_CERT,
	CLIENT_KEY,
	SERVER_CERT,
	SERVER_KEY,
} from "./__fixtures__/mtls.js";
import {
	OffOriginError,
	SourceConfigError,
	sourceRequestFn,
	TRUNCATED_HEADER,
} from "./source-request.js";

type Handler = (req: IncomingMessage, res: ServerResponse) => void;
const servers: Server[] = [];

async function listen(server: Server, scheme: "http" | "https") {
	servers.push(server);
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	return `${scheme}://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
const fake = (handler: Handler) => listen(createServer(handler), "http");

afterEach(async () => {
	await Promise.all(
		servers.splice(0).map((s) => new Promise((r) => s.close(r))),
	);
});

const ok = (c: SourceCredential) => ({ ok: true as const, credential: c });

describe("sourceRequestFn: each credential kind reaches the upstream (#848)", () => {
	const cases: [SourceCredential, string, string | undefined][] = [
		[{ kind: "none" }, "authorization", undefined],
		[{ kind: "bearer", token: "tok-123" }, "authorization", "Bearer tok-123"],
		[
			{ kind: "basic", username: "amy", password: "pw-456" },
			"authorization",
			`Basic ${Buffer.from("amy:pw-456").toString("base64")}`,
		],
		[
			{ kind: "header", name: "CF-Access-Client-Secret", value: "cf-789" },
			"cf-access-client-secret",
			"cf-789",
		],
	];
	for (const [credential, header, expected] of cases)
		it(`${credential.kind}`, async () => {
			let seen: string | undefined;
			let path = "";
			const base = await fake((req, res) => {
				seen = req.headers[header] as string | undefined;
				path = req.url ?? "";
				res.end("{}");
			});
			const res = await sourceRequestFn(`${base}/prom`, ok(credential))(
				"GET",
				"/api/v1/query?query=up",
			);
			expect(res.status).toBe(200);
			expect(seen).toBe(expected);
			expect(path).toBe("/prom/api/v1/query?query=up");
		});

	it("mtls presents the client certificate", async () => {
		const server = createTlsServer(
			{
				cert: SERVER_CERT,
				key: SERVER_KEY,
				ca: CA_CERT,
				requestCert: true,
				rejectUnauthorized: true,
			},
			(req, res) => {
				const peer = (req.socket as TLSSocket).getPeerCertificate();
				res.end(JSON.stringify({ cn: peer.subject?.CN }));
			},
		);
		const base = await listen(server, "https");
		const mtls = ok({
			kind: "mtls",
			cert: CLIENT_CERT,
			key: CLIENT_KEY,
			ca: CA_CERT,
		});
		const res = await sourceRequestFn(base, mtls)("GET", "/-/ready");
		expect(await res.json()).toEqual({ cn: "client" });
		// Without the client certificate the same server refuses the handshake.
		await expect(
			new Promise((resolve, reject) => {
				const r = httpsRequest(`${base}/-/ready`, { ca: CA_CERT }, resolve);
				r.on("error", reject);
				r.end();
			}),
		).rejects.toThrow();
	});

	it("mtls stops reading at maxBytes and marks the response truncated", async () => {
		const server = createTlsServer(
			{
				cert: SERVER_CERT,
				key: SERVER_KEY,
				ca: CA_CERT,
				requestCert: true,
				rejectUnauthorized: true,
			},
			(_req, res) => {
				res.write("a".repeat(600));
				res.end("b".repeat(600));
			},
		);
		const base = await listen(server, "https");
		const mtls = ok({
			kind: "mtls",
			cert: CLIENT_CERT,
			key: CLIENT_KEY,
			ca: CA_CERT,
		});
		const res = await sourceRequestFn(base, mtls, { maxBytes: 100 })("GET", "/x");
		expect(res.headers.get(TRUNCATED_HEADER)).toBe("1");
		expect((await res.text()).length).toBe(100);
	});

	it("mtls refuses a plain http URL", async () => {
		const fn = sourceRequestFn(
			"http://127.0.0.1:1",
			ok({ kind: "mtls", cert: CLIENT_CERT, key: CLIENT_KEY }),
		);
		await expect(fn("GET", "/")).rejects.toBeInstanceOf(SourceConfigError);
	});
});

describe("sourceRequestFn: redirects", () => {
	it("follows a redirect on the same origin, with the credential", async () => {
		const auth: (string | undefined)[] = [];
		const base = await fake((req, res) => {
			auth.push(req.headers.authorization);
			if (req.url === "/old") {
				res.writeHead(302, { location: "/new" });
				return res.end();
			}
			res.end("here");
		});
		const res = await sourceRequestFn(base, ok({ kind: "bearer", token: "t1" }))(
			"GET",
			"/old",
		);
		expect(await res.text()).toBe("here");
		expect(auth).toEqual(["Bearer t1", "Bearer t1"]);
	});

	it("fails a redirect to another host and never sends it the credential", async () => {
		let otherHit = false;
		const other = await fake((_req, res) => {
			otherHit = true;
			res.end();
		});
		const base = await fake((_req, res) => {
			res.writeHead(307, { location: `${other}/steal` });
			res.end();
		});
		await expect(
			sourceRequestFn(base, ok({ kind: "bearer", token: "t2" }))("GET", "/"),
		).rejects.toBeInstanceOf(OffOriginError);
		expect(otherHit).toBe(false);
	});
});

describe("sourceRequestFn: limits and unsupported kinds", () => {
	it("stops reading past maxBytes and marks the response", async () => {
		const base = await fake((_req, res) => res.end("x".repeat(10_000)));
		const res = await sourceRequestFn(base, ok({ kind: "none" }), {
			maxBytes: 1_000,
		})("GET", "/");
		expect(res.headers.get(TRUNCATED_HEADER)).toBe("1");
		expect((await res.text()).length).toBe(1_000);
	});

	it("an unsupported kind rejects with its name, and no request is made", async () => {
		let hit = false;
		const base = await fake((_req, res) => {
			hit = true;
			res.end();
		});
		const parsed = parseSourceCredential({ kind: "aws-sigv4", region: "x" });
		expect(parsed).toMatchObject({ ok: false, reason: "unsupported" });
		await expect(sourceRequestFn(base, parsed)("GET", "/")).rejects.toThrow(
			"AWS SigV4 / assume-role credentials are not supported yet.",
		);
		expect(hit).toBe(false);
	});
});

describe("sourceRequestFn: the first request stays on the origin (#848, OBJ-003)", () => {
	const counting = () => {
		const calls: string[] = [];
		const fetchImpl = (async (url: string) => {
			calls.push(url);
			return new Response("{}");
		}) as unknown as typeof fetch;
		return { calls, fetchImpl };
	};

	for (const path of ["https://other.example/x", "//other.example/x", "HTTP://other.example/x"])
		it(`refuses ${path} before any fetch`, async () => {
			const { calls, fetchImpl } = counting();
			const fn = sourceRequestFn(
				"https://prom.example/prom",
				ok({ kind: "bearer", token: "t3" }),
				{ fetchImpl },
			);
			await expect(fn("GET", path)).rejects.toBeInstanceOf(OffOriginError);
			expect(calls).toEqual([]);
		});

	it("refuses an absolute path on the mTLS path before connecting", async () => {
		let otherHit = false;
		const other = await listen(
			createTlsServer({ cert: SERVER_CERT, key: SERVER_KEY }, (_req, res) => {
				otherHit = true;
				res.end();
			}),
			"https",
		);
		const fn = sourceRequestFn(
			"https://127.0.0.1:1",
			ok({ kind: "mtls", cert: CLIENT_CERT, key: CLIENT_KEY, ca: CA_CERT }),
		);
		await expect(fn("GET", `${other}/x`)).rejects.toBeInstanceOf(OffOriginError);
		expect(otherHit).toBe(false);
	});
});

describe("sourceRequestFn: OAuth renewal and scope refusals (#848, 04)", () => {
	const TOKEN_URL = "https://as.test/token";
	function mockTokenEndpoint(tokens: string[]) {
		const real = globalThis.fetch;
		const calls: URLSearchParams[] = [];
		const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			const url = String(input instanceof Request ? input.url : input);
			if (url !== TOKEN_URL) return real(input, init);
			calls.push(new URLSearchParams(String(init?.body ?? "")));
			return new Response(
				JSON.stringify({
					access_token: tokens.shift(),
					token_type: "Bearer",
					expires_in: 3600,
				}),
				{ headers: { "content-type": "application/json" } },
			);
		});
		return { calls, restore: () => spy.mockRestore() };
	}
	const oauthCred = (refreshToken: string): SourceCredential => ({
		kind: "oauth",
		authorizationUrl: "https://as.test/authorize",
		tokenUrl: TOKEN_URL,
		redirectUri: "http://127.0.0.1:6474/callback",
		clientId: "c",
		scopes: [],
		refreshToken,
	});
	const conn = (c: SourceCredential, problems: string[] = []) => ({
		id: `conn-${Math.random()}`,
		load: async () => c,
		save: async () => {},
		report: async (p: { message: string }) => {
			problems.push(p.message);
		},
	});

	it("a 401 then a 200 retries once with a renewed token, for OAuth only", async () => {
		const seen: string[] = [];
		const base = await fake((req, res) => {
			seen.push(String(req.headers.authorization));
			res.statusCode = seen.length === 1 ? 401 : 200;
			res.end("{}");
		});
		const token = mockTokenEndpoint(["A1", "A2"]);
		try {
			const c = oauthCred("R0");
			const res = await sourceRequestFn(base, ok(c), { connection: conn(c) })(
				"GET",
				"/x",
			);
			expect(res.status).toBe(200);
			expect(seen).toEqual(["Bearer A1", "Bearer A2"]);
			expect(token.calls).toHaveLength(2);
		} finally {
			token.restore();
		}
	});

	it("a bearer token's 401 is not retried", async () => {
		let hits = 0;
		const base = await fake((_req, res) => {
			hits++;
			res.statusCode = 401;
			res.end();
		});
		const res = await sourceRequestFn(base, ok({ kind: "bearer", token: "t" }))(
			"GET",
			"/x",
		);
		expect(res.status).toBe(401);
		expect(hits).toBe(1);
	});

	const refusal = async (headers: Record<string, string>) => {
		const base = await fake((_req, res) => {
			res.writeHead(403, headers);
			res.end("{}");
		});
		const problems: string[] = [];
		const c: SourceCredential = { kind: "bearer", token: "t" };
		await sourceRequestFn(base, ok(c), { connection: conn(c, problems) })(
			"GET",
			"/x",
		);
		return problems;
	};

	it("a 403 insufficient_scope challenge sets needs permission with its scope", async () => {
		expect(
			await refusal({
				"www-authenticate":
					'Bearer error="insufficient_scope", scope="read_repository"',
			}),
		).toEqual(["needs permission: read_repository"]);
	});

	it("reads an unquoted scope token too", async () => {
		expect(
			await refusal({
				"www-authenticate": "Bearer error=insufficient_scope, scope=read_api",
			}),
		).toEqual(["needs permission: read_api"]);
	});

	it("GitHub's X-Accepted-OAuth-Scopes on a 403 names the scope", async () => {
		expect(
			await refusal({ "x-accepted-oauth-scopes": "repo", "x-oauth-scopes": "" }),
		).toEqual(["needs permission: repo"]);
	});

	it("a rate-limit 403 or a grant that holds the scope is not a scope refusal", async () => {
		expect(
			await refusal({
				"x-accepted-oauth-scopes": "repo",
				"x-ratelimit-remaining": "0",
			}),
		).toEqual([]);
		expect(
			await refusal({ "x-accepted-oauth-scopes": "repo", "x-oauth-scopes": "repo" }),
		).toEqual([]);
	});

	it("a challenge whose scope names the bearer token stores no token (OBJ-035)", async () => {
		const token = "glpat-secret-token-1234";
		const base = await fake((_req, res) => {
			res.writeHead(403, {
				"www-authenticate": `Bearer error="insufficient_scope", scope="${token}"`,
			});
			res.end("{}");
		});
		const problems: string[] = [];
		const c: SourceCredential = { kind: "bearer", token };
		await sourceRequestFn(base, ok(c), { connection: conn(c, problems) })("GET", "/x");
		expect(problems).toHaveLength(1);
		expect(problems.join()).not.toContain(token);
	});

	it("cuts an upstream scope to safe characters and 80 characters", async () => {
		const [msg] = await refusal({
			"www-authenticate": `Bearer error="insufficient_scope", scope="<b>${"a".repeat(200)}"`,
		});
		expect(msg).toMatch(/^needs permission: ba+$/);
		expect(msg?.length).toBeLessThanOrEqual("needs permission: ".length + 80);
	});
});
