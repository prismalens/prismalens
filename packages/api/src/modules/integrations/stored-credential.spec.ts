// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { bearerOf, readStored, writeStored } from "./stored-credential.js";

describe("stored-credential (#848 lane B)", () => {
	it("a legacy gitlab-token row reads as bearer with its baseUrl beside it", () => {
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

	it("a legacy row round-trips byte for byte, with and without baseUrl", () => {
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

	it("an oauth row keeps baseUrl beside the credential, and a rotated refresh token keeps both", () => {
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

	it("a prometheus basic row reads as basic and writes no baseUrl", () => {
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

	it("a prometheus row with no kind reads as none", () => {
		const res = readStored("prometheus", {});
		expect(res.credential.ok).toBe(true);
		if (!res.credential.ok) throw new Error("Expected ok credential");
		expect(res.credential.credential.kind).toBe("none");
	});

	it("bearerOf reads only a Bearer Authorization header", () => {
		expect(bearerOf({ Authorization: "Bearer abc" })).toBe("abc");
		expect(bearerOf({ authorization: "Bearer x" })).toBe("x");
		expect(bearerOf({ Authorization: "Basic y" })).toBeUndefined();
	});
});
