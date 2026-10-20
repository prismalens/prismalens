// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { bearerOf, readStored, writeStored } from "./stored-credential.js";

describe("stored-credential (#848 lane B)", () => {
	it('Legacy gitlab-token row {apiKey:"glpat-1", baseUrl:"https://git.acme.io/api/v4"} reads as {ok:true, credential:{kind:"bearer", token:"glpat-1"}} with baseUrl "https://git.acme.io/api/v4"', () => {
		const legacy = {
			apiKey: "glpat-1",
			baseUrl: "https://git.acme.io/api/v4",
		};
		const res = readStored("gitlab-token", legacy);
		expect(res).toEqual({
			credential: {
				ok: true,
				credential: {
					kind: "bearer",
					token: "glpat-1",
				},
			},
			baseUrl: "https://git.acme.io/api/v4",
		});
	});

	it("Round trip byte-for-byte: JSON.stringify(writeStored('gitlab-token', readStored(...).credential.credential, readStored(...).baseUrl)) equals JSON.stringify of the original legacy row, for a row with baseUrl and one without", () => {
		const rowWithBaseUrl = {
			apiKey: "glpat-1",
			baseUrl: "https://git.acme.io/api/v4",
		};
		const read1 = readStored("gitlab-token", rowWithBaseUrl);
		if (!read1.credential.ok) throw new Error("Expected ok credential");
		const written1 = writeStored(
			"gitlab-token",
			read1.credential.credential,
			read1.baseUrl,
		);
		expect(JSON.stringify(written1)).toBe(JSON.stringify(rowWithBaseUrl));

		const rowWithoutBaseUrl = {
			apiKey: "glpat-2",
		};
		const read2 = readStored("gitlab-token", rowWithoutBaseUrl);
		if (!read2.credential.ok) throw new Error("Expected ok credential");
		const written2 = writeStored(
			"gitlab-token",
			read2.credential.credential,
			read2.baseUrl,
		);
		expect(JSON.stringify(written2)).toBe(JSON.stringify(rowWithoutBaseUrl));
	});

	it('An oauth row for gitlab-token {kind:"oauth", authorizationUrl:"https://git.acme.io/oauth/authorize", tokenUrl:"https://git.acme.io/oauth/token", redirectUri:"http://127.0.0.1:6474/callback", clientId:"c", scopes:["read_api"], refreshToken:"r1", baseUrl:"https://git.acme.io/api/v4"} reads as kind oauth WITHOUT baseUrl inside the credential, baseUrl returned beside it; writeStored of it with a rotated refreshToken "r2" keeps baseUrl and kind', () => {
		const oauthRow = {
			kind: "oauth" as const,
			authorizationUrl: "https://git.acme.io/oauth/authorize",
			tokenUrl: "https://git.acme.io/oauth/token",
			redirectUri: "http://127.0.0.1:6474/callback",
			clientId: "c",
			scopes: ["read_api"],
			refreshToken: "r1",
			baseUrl: "https://git.acme.io/api/v4",
		};

		const res = readStored("gitlab-token", oauthRow);
		expect(res.baseUrl).toBe("https://git.acme.io/api/v4");
		expect(res.credential.ok).toBe(true);
		if (!res.credential.ok) throw new Error("Expected ok credential");
		expect(res.credential.credential.kind).toBe("oauth");
		expect("baseUrl" in res.credential.credential).toBe(false);

		const rotated = {
			...res.credential.credential,
			refreshToken: "r2",
		};
		const written = writeStored("gitlab-token", rotated, res.baseUrl);
		expect(written.baseUrl).toBe("https://git.acme.io/api/v4");
		expect(written.kind).toBe("oauth");
		expect(written.refreshToken).toBe("r2");
	});

	it('A prometheus blob {kind:"basic", username:"u", password:"p"} reads as basic and writeStored("prometheus", c) has no baseUrl key', () => {
		const blob = {
			kind: "basic" as const,
			username: "u",
			password: "p",
		};
		const res = readStored("prometheus", blob);
		expect(res.baseUrl).toBeUndefined();
		expect(res.credential.ok).toBe(true);
		if (!res.credential.ok) throw new Error("Expected ok credential");
		expect(res.credential.credential.kind).toBe("basic");

		const written = writeStored("prometheus", res.credential.credential);
		expect("baseUrl" in written).toBe(false);
		expect(written).toEqual(blob);
	});

	it('A prometheus blob {} reads as kind "none"', () => {
		const res = readStored("prometheus", {});
		expect(res.credential.ok).toBe(true);
		if (!res.credential.ok) throw new Error("Expected ok credential");
		expect(res.credential.credential.kind).toBe("none");
	});

	it('bearerOf({Authorization:"Bearer abc"}) is "abc"; bearerOf({authorization:"Bearer x"}) is "x"; bearerOf({Authorization:"Basic y"}) is undefined', () => {
		expect(bearerOf({ Authorization: "Bearer abc" })).toBe("abc");
		expect(bearerOf({ authorization: "Bearer x" })).toBe("x");
		expect(bearerOf({ Authorization: "Basic y" })).toBeUndefined();
	});
});
