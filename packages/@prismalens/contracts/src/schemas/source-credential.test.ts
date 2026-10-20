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
