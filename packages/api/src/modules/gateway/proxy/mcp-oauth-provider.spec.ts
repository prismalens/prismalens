// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createHash } from "node:crypto";
import { createMcpHandler, Server } from "@modelcontextprotocol/server";
import type { SourceCredential } from "@prismalens/contracts/schemas";
import { describe, expect, it } from "vitest";
import { SignIns } from "../sign-in.js";
import type { McpOAuthCredential } from "./mcp-oauth-provider.js";
import { McpProxy } from "./proxy.service.js";
import type { McpConnection } from "./upstream.js";

const RS = "https://mcp.test";
const REDIRECT = "http://127.0.0.1:6474/callback";

/** A resource server and an authorization server with discovery, DCR and rotating refresh. */
function world(o: { challengeScope?: string } = {}) {
	const w = {
		issuer: "https://as.test",
		tokenEndpoint: "https://as.test/token",
		registered: [] as string[],
		authorizeUrls: [] as URL[],
		challenges: new Map<string, string>(),
		/** access token → valid */
		access: new Set<string>(),
		liveRefresh: new Set<string>(),
		refreshes: [] as { url: string; body: URLSearchParams }[],
		/** Every request any host saw, with its body. */
		seen: [] as { url: string; method: string; body: string }[],
		n: 0,
		/** Holds the n-th 401 (1-based) until the promise settles. */
		holdUnauthorized: null as null | { n: number; until: Promise<void> },
		unauthorized: 0,
		forbidScope: null as null | string,
		calls: 0,
	};
	const mcp = createMcpHandler(
		() => {
			const s = new Server({ name: "rs", version: "1" }, { capabilities: { tools: {} } });
			s.setRequestHandler("tools/list", async () => ({
				tools: [{ name: "whoami", inputSchema: { type: "object" } }],
			}) as never);
			s.setRequestHandler("tools/call", async () => {
				w.calls++;
				return { content: [{ type: "text", text: "you" }] } as never;
			});
			return s;
		},
		{ responseMode: "json" },
	);
	const json = (b: unknown, status = 200) =>
		new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
	const mint = () => {
		const a = `A${++w.n}`;
		const r = `R${w.n}`;
		w.access.add(a);
		w.liveRefresh.add(r);
		return json({ access_token: a, token_type: "Bearer", refresh_token: r, expires_in: 3600 });
	};
	const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const req = new Request(input, init);
		const body = req.method === "POST" ? await req.clone().text() : "";
		w.seen.push({ url: req.url, method: req.method, body });
		const url = new URL(req.url);
		if (url.origin === RS && url.pathname.startsWith("/.well-known/oauth-protected-resource"))
			return json({ resource: `${RS}/mcp`, authorization_servers: [w.issuer] });
		if (url.pathname.startsWith("/.well-known/oauth-authorization-server") || url.pathname.startsWith("/.well-known/openid-configuration")) {
			if (url.origin !== w.issuer) return new Response("no", { status: 404 });
			return json({
				issuer: w.issuer,
				authorization_endpoint: `${w.issuer}/authorize`,
				token_endpoint: w.tokenEndpoint,
				registration_endpoint: `${w.issuer}/register`,
				response_types_supported: ["code"],
				code_challenge_methods_supported: ["S256"],
				scopes_supported: ["a", "b", "c", "offline_access"],
			});
		}
		if (url.pathname === "/register") {
			const id = `dcr-${w.registered.length + 1}`;
			w.registered.push(id);
			return json({ ...JSON.parse(body), client_id: id }, 201);
		}
		if (req.method === "POST" && /grant_type=/.test(body)) {
			const p = new URLSearchParams(body);
			if (p.get("grant_type") === "authorization_code") {
				const sent = createHash("sha256").update(p.get("code_verifier") ?? "").digest("base64url");
				if (w.challenges.get(p.get("code") ?? "") !== sent) return json({ error: "invalid_grant" }, 400);
				return mint();
			}
			w.refreshes.push({ url: req.url, body: p });
			const r = p.get("refresh_token") ?? "";
			if (!w.liveRefresh.has(r)) return json({ error: "invalid_grant" }, 400);
			w.liveRefresh.delete(r);
			await new Promise((res) => setTimeout(res, 10));
			return mint();
		}
		if (url.origin === RS && url.pathname === "/mcp") {
			const token = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
			if (!w.access.has(token)) {
				w.unauthorized++;
				if (w.holdUnauthorized?.n === w.unauthorized) await w.holdUnauthorized.until;
				return new Response(null, {
					status: 401,
					headers: {
						"www-authenticate": `Bearer resource_metadata="${RS}/.well-known/oauth-protected-resource"${o.challengeScope ? `, scope="${o.challengeScope}"` : ""}`,
					},
				});
			}
			if (w.forbidScope && body.includes("tools/call"))
				return new Response(null, {
					status: 403,
					headers: { "www-authenticate": `Bearer error="insufficient_scope", scope="${w.forbidScope}"` },
				});
			return mcp.fetch(req);
		}
		return new Response("not found", { status: 404 });
	}) as typeof fetch;
	return { w, fetchFn };
}

/** Plays the user at the authorization endpoint: approves and returns the callback params. */
function approve(w: ReturnType<typeof world>["w"], authorizationUrl: string): URLSearchParams {
	const u = new URL(authorizationUrl);
	w.authorizeUrls.push(u);
	const code = `code-${w.challenges.size}`;
	w.challenges.set(code, u.searchParams.get("code_challenge") ?? "");
	return new URLSearchParams({ code, state: u.searchParams.get("state") ?? "" });
}

function setup(o: { challengeScope?: string } = {}) {
	const { w, fetchFn } = world(o);
	const store = new Map<string, McpOAuthCredential>();
	const problems: string[] = [];
	const proxy = new McpProxy(
		{ connection: { findUnique: async () => ({ status: "ACTIVE" }) } } as never,
		{} as never,
		{} as never,
	);
	proxy.fetchImpl = fetchFn;
	const conn = (id: string): McpConnection => {
		const c = store.get(id) as SourceCredential;
		return {
			id,
			name: id,
			description: id,
			url: `${RS}/mcp`,
			credential: c,
			connection: {
				id,
				load: async () => store.get(id) as SourceCredential,
				save: async (next) => {
					store.set(id, next as McpOAuthCredential);
				},
				report: async (p) => {
					problems.push(p.message);
				},
			},
		};
	};
	proxy.connections = async () => [...store.keys()].sort().map(conn);
	const signIns = new SignIns();
	async function signIn(id: string, scopeOverride?: string) {
		const flow = await proxy.startSignIn({
			serverUrl: `${RS}/mcp`,
			redirectUri: REDIRECT,
			scopeOverride,
			onSignedIn: async (credential) => {
				store.set(id, credential);
				return id;
			},
		});
		await signIns.register(flow.state, flow, false);
		return flow;
	}
	return { w, store, proxy, signIns, signIn, problems };
}

const signal = () => new AbortController().signal;

describe("MCP sign-in (#848, 06)", () => {
	it("round trip: the authorization URL carries the pending state and the callback exchanges with the stored verifier (OBJ-020)", async () => {
		const { w, store, signIns, signIn } = setup();
		const a = await signIn("one");
		const b = await signIn("two");
		expect(new URL(a.authorizationUrl).searchParams.get("state")).toBe(a.state);
		expect(a.state).not.toBe(b.state);
		// Finish them out of order; each lands on its own connection.
		expect(await signIns.complete(approve(w, b.authorizationUrl))).toEqual({ connectionId: "two" });
		expect(await signIns.complete(approve(w, a.authorizationUrl))).toEqual({ connectionId: "one" });
		expect(store.get("one")).toMatchObject({
			issuer: "https://as.test",
			tokenEndpoint: "https://as.test/token",
			client: { client_id: "dcr-1", registered: "dcr" },
		});
		expect(store.get("two")?.client?.client_id).toBe("dcr-2");
	});

	it("registers per connection and never sends a client_id URL while the metadata URL is empty", async () => {
		const { w, signIn } = setup();
		await signIn("one");
		await signIn("two");
		expect(w.registered).toEqual(["dcr-1", "dcr-2"]);
		expect(w.seen.some((s) => /client_id=https?%3A/.test(s.url + s.body))).toBe(false);
	});

	it("sends no scope catalogue: only offline_access when the server gave no challenge scope", async () => {
		const { signIn } = setup();
		const f = await signIn("one");
		expect(new URL(f.authorizationUrl).searchParams.get("scope")).toBe("offline_access");
	});

	it("uses the challenge's scope, and the form's override replaces it", async () => {
		const challenged = await setup({ challengeScope: "b" }).signIn("one");
		expect(new URL(challenged.authorizationUrl).searchParams.get("scope")).toBe("b offline_access");
		const overridden = await setup({ challengeScope: "b" }).signIn("one", "c");
		expect(new URL(overridden.authorizationUrl).searchParams.get("scope")).toBe("c offline_access");
	});
});

async function signedIn(o: { challengeScope?: string } = {}) {
	const s = setup(o);
	const f = await s.signIn("one");
	await s.signIns.complete(approve(s.w, f.authorizationUrl));
	return s;
}

/** Makes the stored access token stale at the resource server without touching the store. */
const expireAccess = (w: ReturnType<typeof world>["w"]) => w.access.clear();

describe("MCP refresh under the connection lock (OBJ-007)", () => {
	it("two runs' clients get simultaneous 401s: one refresh per generation, no false expiry", async () => {
		const { w, proxy, problems } = await signedIn();
		await proxy.snapshot("run-1", 5000);
		await proxy.snapshot("run-2", 5000);
		expireAccess(w);
		const [a, b] = await Promise.all([
			proxy.call("run-1", "one__whoami", {}, signal()),
			proxy.call("run-2", "one__whoami", {}, signal()),
		]);
		expect([a.isError, b.isError]).toEqual([undefined, undefined]);
		expect(w.refreshes).toHaveLength(1);
		expect(problems).toEqual([]);
	});

	it("one client, two calls with A0: the held second 401 does not refresh again", async () => {
		const { w, proxy } = await signedIn();
		await proxy.snapshot("run-1", 5000);
		expireAccess(w);
		let release = () => {};
		const until = new Promise<void>((r) => {
			release = r;
		});
		w.unauthorized = 0;
		w.holdUnauthorized = { n: 2, until };
		const first = proxy.call("run-1", "one__whoami", {}, signal());
		const second = proxy.call("run-1", "one__whoami", {}, signal());
		const a = await first;
		release();
		const b = await second;
		expect([a.isError, b.isError]).toEqual([undefined, undefined]);
		expect(w.refreshes).toHaveLength(1);
		expect(w.unauthorized).toBe(2);
	});
});

describe("MCP token endpoint pinning (OBJ-016)", () => {
	const cases: [string, (w: ReturnType<typeof world>["w"]) => void][] = [
		["the issuer changes", (w) => {
			w.issuer = "https://as2.test";
			w.tokenEndpoint = "https://as2.test/token";
		}],
		["only the token endpoint changes, same issuer", (w) => {
			w.tokenEndpoint = "https://as.test/token2";
		}],
		["the token endpoint moves onto the resource origin", (w) => {
			w.tokenEndpoint = `${RS}/token`;
		}],
	];
	for (const [name, change] of cases)
		it(`${name}: the new target never sees the refresh token, and the connection needs sign-in again`, async () => {
			const { w, proxy, store, problems } = await signedIn();
			const refresh = store.get("one")?.tokens?.refresh_token ?? "";
			expect(refresh).toBeTruthy();
			await proxy.snapshot("run-1", 5000);
			change(w);
			expireAccess(w);
			const r = await proxy.call("run-1", "one__whoami", {}, signal());
			expect(r.isError).toBe(true);
			const leaked = w.seen.filter(
				(s) => !s.url.startsWith("https://as.test/token") || s.url !== "https://as.test/token",
			).filter((s) => s.body.includes(refresh));
			expect(leaked).toEqual([]);
			expect(problems).toContain("needs sign-in again");
		});
});

describe("MCP insufficient scope", () => {
	it("a 403 insufficient_scope sets needs permission and tells the agent", async () => {
		const { w, proxy, problems } = await signedIn();
		await proxy.snapshot("run-1", 5000);
		w.forbidScope = "admin";
		const r = await proxy.call("run-1", "one__whoami", {}, signal());
		expect(r.isError).toBe(true);
		expect(JSON.stringify(r.content)).toContain("needs permission: admin");
		expect(problems).toContain("needs permission: admin");
	});
});
