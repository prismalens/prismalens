// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { pairingQr, resolveOrigin } from "./pair.js";

describe("resolveOrigin", () => {
	it("no address → http://localhost:<port>, loopback true", () => {
		const result = resolveOrigin(undefined, 6473);
		expect(result).toEqual({
			origin: "http://localhost:6473",
			loopback: true,
		});
	});

	it('"192.168.1.5" → http://192.168.1.5:<port>, loopback false (scheme and port added)', () => {
		const result = resolveOrigin("192.168.1.5", 6473);
		expect(result).toEqual({
			origin: "http://192.168.1.5:6473",
			loopback: false,
		});
	});

	it('"https://machine.tailnet.ts.net" → unchanged origin, no port added, loopback false', () => {
		const result = resolveOrigin("https://machine.tailnet.ts.net", 6473);
		expect(result).toEqual({
			origin: "https://machine.tailnet.ts.net",
			loopback: false,
		});
	});

	it('"http://127.0.0.1:4000" → port kept, loopback true', () => {
		const result = resolveOrigin("http://127.0.0.1:4000", 6473);
		expect(result).toEqual({
			origin: "http://127.0.0.1:4000",
			loopback: true,
		});
	});
});

describe("pairingQr", () => {
	it("draws the link as a block QR code a phone camera can scan (#859)", async () => {
		const qr = await pairingQr("https://box.tail1234.ts.net/pair#t=abc");
		const rows = qr.trim().split("\n");
		expect(rows.length).toBeGreaterThan(10);
		expect(qr).toMatch(/[▀▄█]/);
		expect(qr).not.toContain("abc");
	});
});
