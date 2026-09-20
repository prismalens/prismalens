// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	alertmanagerFingerprint,
	fnv1a64Bytes,
} from "./alertmanager-fingerprint.js";

describe("alertmanagerFingerprint (#605)", () => {
	it("hashes empty set to cbf29ce484222325", () => {
		expect(alertmanagerFingerprint({})).toBe("cbf29ce484222325");
	});

	it("hashes the single byte 0x61 ('a') to af63dc4c8601ec8c using the byte-hash helper", () => {
		const hash = fnv1a64Bytes(Buffer.from("a", "utf8"));
		expect(hash.toString(16)).toBe("af63dc4c8601ec8c");
	});

	it("is order-independent across label keys", () => {
		const fp1 = alertmanagerFingerprint({ a: "1", b: "2" });
		const fp2 = alertmanagerFingerprint({ b: "2", a: "1" });
		expect(fp1).toBe(fp2);
	});

	it("returns a 16-character lowercase hex string", () => {
		const fp = alertmanagerFingerprint({ alertname: "HighLatency", env: "production" });
		expect(fp).toMatch(/^[0-9a-f]{16}$/);
	});
});
