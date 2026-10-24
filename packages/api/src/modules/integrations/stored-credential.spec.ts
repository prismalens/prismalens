// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { readStored, writeStored } from "./stored-credential.js";

describe("stored-credential (#848)", () => {
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
			state: "set",
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

	it("a git-host row of a kind that left reads invalid and keeps its baseUrl", () => {
		const res = readStored("gitlab-token", {
			kind: "oauth",
			refreshToken: "r1",
			baseUrl: "https://git.acme.io/api/v4",
		});
		expect(res.baseUrl).toBe("https://git.acme.io/api/v4");
		expect(res.credential).toMatchObject({ ok: false, reason: "invalid" });
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
});
