// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	CREDENTIAL_KIND_FIELDS,
	parseSourceCredential,
	SOURCE_CREDENTIAL_KINDS,
	UNSUPPORTED_CREDENTIAL_KINDS,
} from "./source-credential.js";

describe("parseSourceCredential (#848)", () => {
	it("reads a row saved before kinds as none", () => {
		expect(parseSourceCredential({})).toEqual({ ok: true, credential: { kind: "none" } });
		expect(parseSourceCredential(undefined)).toEqual({ ok: true, credential: { kind: "none" } });
	});

	it("accepts each supported kind, dropping a blank optional field", () => {
		expect(parseSourceCredential({ kind: "bearer", token: "t" }).ok).toBe(true);
		expect(parseSourceCredential({ kind: "basic", username: "u", password: "p" }).ok).toBe(true);
		expect(parseSourceCredential({ kind: "header", name: "X-Scope-OrgID", value: "v" }).ok).toBe(true);
		expect(
			parseSourceCredential({
				kind: "mtls",
				cert: "-----BEGIN CERTIFICATE-----x",
				key: "-----BEGIN PRIVATE KEY-----y",
				ca: "",
			}),
		).toEqual({
			ok: true,
			credential: {
				kind: "mtls",
				cert: "-----BEGIN CERTIFICATE-----x",
				key: "-----BEGIN PRIVATE KEY-----y",
			},
		});
	});

	it("names every not-yet-supported kind instead of failing silently", () => {
		for (const [kind, label] of Object.entries(UNSUPPORTED_CREDENTIAL_KINDS))
			expect(parseSourceCredential({ kind })).toEqual({
				ok: false,
				reason: "unsupported",
				message: `${label} credentials are not supported yet.`,
			});
	});

	it("refuses a malformed credential without echoing its value", () => {
		const bad = parseSourceCredential({ kind: "header", name: "Bad Name", value: "sekrit" });
		expect(bad).toMatchObject({ ok: false, reason: "invalid" });
		expect(JSON.stringify(bad)).not.toContain("sekrit");
		expect(parseSourceCredential({ kind: "bearer", token: "a\r\nX-Evil: 1" }).ok).toBe(false);
		expect(parseSourceCredential({ kind: "basic", username: "a:b", password: "p" }).ok).toBe(false);
		expect(parseSourceCredential({ kind: "kerberos" })).toMatchObject({ ok: false, reason: "invalid" });
	});

	it("has one form shape per supported kind", () => {
		expect(Object.keys(CREDENTIAL_KIND_FIELDS)).toEqual([...SOURCE_CREDENTIAL_KINDS]);
	});
});

describe("OAuth credential kinds (#848)", () => {
	const oauth = {
		kind: "oauth",
		authorizationUrl: "https://gitlab.com/oauth/authorize",
		tokenUrl: "https://gitlab.com/oauth/token",
		redirectUri: "https://prismalens.example/api/sources/oauth/callback",
		clientId: "cid",
		scopes: ["read_api"],
		refreshToken: "r1",
	};

	it("accepts an oauth sign-in with a refresh token", () => {
		expect(parseSourceCredential(oauth).ok).toBe(true);
	});

	it("refuses oauth without redirectUri, or with neither token", () => {
		const { redirectUri: _, ...noRedirect } = oauth;
		expect(parseSourceCredential(noRedirect).ok).toBe(false);
		const { refreshToken: __, ...noToken } = oauth;
		expect(parseSourceCredential(noToken).ok).toBe(false);
		expect(parseSourceCredential({ ...noToken, accessToken: "a" }).ok).toBe(true);
	});

	it("refuses an http: token URL for oauth and oauth-client", () => {
		expect(parseSourceCredential({ ...oauth, tokenUrl: "http://gitlab.com/oauth/token" }).ok).toBe(false);
		const client = {
			kind: "oauth-client",
			tokenUrl: "https://bitbucket.org/site/oauth2/access_token",
			clientId: "key",
			clientSecret: "secret",
		};
		expect(parseSourceCredential(client).ok).toBe(true);
		expect(
			parseSourceCredential({ ...client, tokenUrl: "http://bitbucket.org/site/oauth2/access_token" }).ok,
		).toBe(false);
	});

	it("OBJ-017: http redirect only on a loopback IP literal", () => {
		const at = (redirectUri: string) => parseSourceCredential({ ...oauth, redirectUri }).ok;
		expect(at("http://127.0.0.1:6474/callback")).toBe(true);
		expect(at("http://[::1]:6474/callback")).toBe(true);
		expect(at("http://localhost:6474/callback")).toBe(false);
		expect(at("http://example.com/cb")).toBe(false);
	});

	it("mcp-oauth needs an https server and pins issuer and token endpoint as https", () => {
		const mcp = {
			kind: "mcp-oauth",
			serverUrl: "https://n8n.example.com/mcp",
			redirectUri: "http://127.0.0.1:6474/callback",
			issuer: "https://auth.example.com",
			tokenEndpoint: "https://auth.example.com/token",
			client: { client_id: "c", registered: "dcr" },
			tokens: { access_token: "a", refresh_token: "r" },
		};
		expect(parseSourceCredential(mcp).ok).toBe(true);
		expect(parseSourceCredential({ ...mcp, serverUrl: "http://n8n.example.com/mcp" }).ok).toBe(false);
		expect(parseSourceCredential({ ...mcp, tokenEndpoint: "http://auth.example.com/token" }).ok).toBe(false);
	});
});
