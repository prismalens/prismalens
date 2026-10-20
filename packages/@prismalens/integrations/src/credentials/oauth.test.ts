// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createHash } from "node:crypto";
import type { SourceCredential } from "@prismalens/contracts/schemas";
import { beforeEach, describe, expect, it } from "vitest";
import type { CredentialContext } from "../port/credential-kind.js";
import { SignInExpired } from "./errors.js";
import {
	beginSignIn,
	completeSignIn,
	forgetOAuthCache,
	type OAuthCredential,
	oauthKind,
} from "./oauth.js";

const AUTH = "https://as.example/authorize";
const TOKEN = "https://as.example/token";
const REDIRECT = "http://127.0.0.1:6474/callback";

/** A mock authorization server: PKCE-checked codes and rotating refresh tokens. */
function mockServer(opts: { rotate?: boolean; refresh?: boolean; github?: boolean } = {}) {
	const challenges = new Map<string, string>();
	let generation = 0;
	const s = {
		refreshes: [] as URLSearchParams[],
		exchanges: [] as URLSearchParams[],
		/** The refresh token the server currently honours. */
		live: "R0",
		authorize(url: string) {
			const u = new URL(url);
			const code = `code-${challenges.size}`;
			challenges.set(code, u.searchParams.get("code_challenge") ?? "");
			return { code, state: u.searchParams.get("state") ?? "" };
		},
		fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input instanceof Request ? input.url : input);
			if (url !== TOKEN) return new Response("no", { status: 404 });
			const body = new URLSearchParams(String(init?.body ?? ""));
			const json = (status: number, b: unknown) =>
				new Response(JSON.stringify(b), {
					status,
					headers: { "content-type": "application/json" },
				});
			const err = (e: string) =>
				opts.github ? json(200, { error: e }) : json(400, { error: e });
			if (body.get("grant_type") === "authorization_code") {
				s.exchanges.push(body);
				const challenge = challenges.get(body.get("code") ?? "");
				const sent = createHash("sha256")
					.update(body.get("code_verifier") ?? "")
					.digest("base64url");
				if (!challenge || challenge !== sent) return err("invalid_grant");
				return json(200, {
					access_token: "A0",
					token_type: opts.github ? "bearer" : "Bearer",
					...(opts.refresh === false
						? {}
						: { refresh_token: s.live, expires_in: 3600 }),
					scope: opts.github ? "repo" : "read_api read_repository",
				});
			}
			if (body.get("grant_type") === "refresh_token") {
				s.refreshes.push(body);
				if (body.get("refresh_token") !== s.live)
					return err(opts.github ? "bad_refresh_token" : "invalid_grant");
				generation++;
				if (opts.rotate !== false) s.live = `R${generation}`;
				await new Promise((r) => setTimeout(r, 5));
				return json(200, {
					access_token: `A${generation}`,
					token_type: "Bearer",
					refresh_token: s.live,
					expires_in: 3600,
				});
			}
			return err("unsupported_grant_type");
		}) as typeof fetch,
	};
	return s;
}

function store(initial: OAuthCredential) {
	const st = { current: initial as SourceCredential, saves: 0 };
	const ctx = (id = "conn-1"): CredentialContext => ({
		connectionId: id,
		origin: "https://gitlab.example",
		fetch,
		load: async () => st.current,
		save: async (next) => {
			st.saves++;
			st.current = next;
		},
	});
	return { st, ctx };
}

const base: OAuthCredential = {
	kind: "oauth",
	authorizationUrl: AUTH,
	tokenUrl: TOKEN,
	redirectUri: REDIRECT,
	clientId: "client",
	scopes: ["read_api"],
	refreshToken: "R0",
};

async function signIn(server: ReturnType<typeof mockServer>, verifierOverride?: string) {
	const start = await beginSignIn({
		authorizationUrl: AUTH,
		clientId: "client",
		redirectUri: REDIRECT,
		scopes: ["read_api", "read_repository"],
	});
	const { code, state } = server.authorize(start.authorizationUrl);
	return completeSignIn(
		{
			authorizationUrl: AUTH,
			tokenUrl: TOKEN,
			redirectUri: REDIRECT,
			clientId: "client",
			scopes: ["read_api", "read_repository"],
			verifier: verifierOverride ?? start.verifier,
			state: start.state,
			callback: new URLSearchParams({ code, state }),
		},
		{ fetch: server.fetch },
	);
}

beforeEach(() => forgetOAuthCache());

describe("sign-in", () => {
	it("exchanges a code with the stored verifier and keeps the redirect URI", async () => {
		const server = mockServer();
		const r = await signIn(server);
		expect(r.credential).toMatchObject({ refreshToken: "R0", redirectUri: REDIRECT });
		expect(r.grantedScopes).toEqual(["read_api", "read_repository"]);
		expect(server.exchanges[0]?.get("redirect_uri")).toBe(REDIRECT);
	});

	it("rejects a PKCE mismatch", async () => {
		const server = mockServer();
		await expect(signIn(server, "x".repeat(43))).rejects.toThrow();
	});

	it("refuses a callback whose state is not the pending one", async () => {
		const start = await beginSignIn({
			authorizationUrl: AUTH,
			clientId: "client",
			redirectUri: REDIRECT,
			scopes: [],
		});
		await expect(
			completeSignIn({
				authorizationUrl: AUTH,
				tokenUrl: TOKEN,
				redirectUri: REDIRECT,
				clientId: "client",
				scopes: [],
				verifier: start.verifier,
				state: start.state,
				callback: new URLSearchParams({ code: "c", state: "forged" }),
			}),
		).rejects.toThrow();
	});
});

describe("refresh", () => {
	it("sends redirect_uri on refresh (OBJ-008)", async () => {
		const server = mockServer();
		const { st, ctx } = store(base);
		const kind = oauthKind({ fetch: server.fetch });
		await kind.authorize(st.current as OAuthCredential, ctx());
		expect(server.refreshes[0]?.get("redirect_uri")).toBe(REDIRECT);
	});

	it("makes one refresh per generation under concurrent callers (OBJ-007)", async () => {
		const server = mockServer();
		const { st, ctx } = store(base);
		const kind = oauthKind({ fetch: server.fetch });
		const stale = st.current as OAuthCredential;
		const out = await Promise.all(
			Array.from({ length: 5 }, () => kind.authorize(stale, ctx())),
		);
		expect(server.refreshes).toHaveLength(1);
		expect(new Set(out.map((a) => a.headers.Authorization))).toEqual(
			new Set(["Bearer A1"]),
		);
		// Rotated token written back before anyone used the new generation.
		expect(st.current).toMatchObject({ refreshToken: "R1" });
		expect(st.saves).toBe(1);
	});

	it("a renew for an already replaced token returns the cache, no second refresh", async () => {
		const server = mockServer();
		const { st, ctx } = store(base);
		const kind = oauthKind({ fetch: server.fetch });
		await kind.authorize(st.current as OAuthCredential, ctx());
		const again = await kind.authorize(base, ctx(), {
			renew: { failedToken: "A0-old" },
		});
		expect(again.headers.Authorization).toBe("Bearer A1");
		expect(server.refreshes).toHaveLength(1);
	});

	it("a stale caller after a rotation never sends the obsolete refresh token", async () => {
		const server = mockServer();
		const { st, ctx } = store(base);
		const kind = oauthKind({ fetch: server.fetch });
		await kind.authorize(base, ctx());
		await kind.authorize(base, ctx(), { renew: { failedToken: "A1" } });
		expect(server.refreshes.map((b) => b.get("refresh_token"))).toEqual(["R0", "R1"]);
		expect(st.current).toMatchObject({ refreshToken: "R2" });
	});

	it("invalid_grant with an unchanged stored token gives SignInExpired", async () => {
		const server = mockServer();
		server.live = "revoked";
		const { st, ctx } = store(base);
		const kind = oauthKind({ fetch: server.fetch });
		await expect(kind.authorize(st.current as OAuthCredential, ctx())).rejects.toBeInstanceOf(
			SignInExpired,
		);
	});

	it("invalid_grant after another process rotated retries with the stored token", async () => {
		const server = mockServer();
		server.live = "R9";
		const { st, ctx } = store(base);
		const c = ctx();
		const kind = oauthKind({ fetch: server.fetch });
		let first = true;
		c.load = async () => {
			if (first) {
				first = false;
				return base;
			}
			return { ...base, refreshToken: "R9" };
		};
		const a = await kind.authorize(base, c);
		expect(a.headers.Authorization).toMatch(/^Bearer A/);
		expect(server.refreshes.map((b) => b.get("refresh_token"))).toEqual(["R0", "R9"]);
		void st;
	});
});

describe("GitHub, both token shapes (OBJ-022)", () => {
	it("non-expiring: stores the access token, and a later 401 gives SignInExpired", async () => {
		const server = mockServer({ refresh: false, github: true });
		const r = await signIn(server);
		expect(r.credential.refreshToken).toBeUndefined();
		expect(r.credential.accessToken).toBe("A0");
		const { st, ctx } = store(r.credential);
		const kind = oauthKind({ fetch: server.fetch });
		const a = await kind.authorize(st.current as OAuthCredential, ctx());
		expect(a.headers.Authorization).toBe("Bearer A0");
		await expect(
			kind.authorize(st.current as OAuthCredential, ctx(), {
				renew: { failedToken: "A0" },
			}),
		).rejects.toBeInstanceOf(SignInExpired);
		expect(server.refreshes).toHaveLength(0);
	});

	it("expiring: stores the refresh token, survives a restart, refreshes once on a 401", async () => {
		const server = mockServer({ github: true });
		const r = await signIn(server);
		expect(r.credential.refreshToken).toBe("R0");
		const { st, ctx } = store(r.credential);
		forgetOAuthCache(); // a restart: only the stored row survives
		const kind = oauthKind({ fetch: server.fetch });
		const a = await kind.authorize(st.current as OAuthCredential, ctx());
		expect(a.headers.Authorization).toBe("Bearer A1");
		const b = await kind.authorize(st.current as OAuthCredential, ctx(), {
			renew: { failedToken: "A1" },
		});
		expect(b.headers.Authorization).toBe("Bearer A2");
		expect(server.refreshes).toHaveLength(2);
	});

	it("GitHub's HTTP 200 error body reads as an expired sign-in", async () => {
		const server = mockServer({ github: true });
		server.live = "revoked";
		const { st, ctx } = store(base);
		const kind = oauthKind({ fetch: server.fetch });
		await expect(kind.authorize(st.current as OAuthCredential, ctx())).rejects.toBeInstanceOf(
			SignInExpired,
		);
	});
});
