// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { resolveOrigin } from "./pair.js";

describe("resolveOrigin", () => {
	it("no address → http://localhost:<port>, loopback true", () => {
		const result = resolveOrigin(undefined, 3001);
		expect(result).toEqual({
			origin: "http://localhost:3001",
			loopback: true,
		});
	});

	it('"192.168.1.5" → http://192.168.1.5:<port>, loopback false (scheme and port added)', () => {
		const result = resolveOrigin("192.168.1.5", 3001);
		expect(result).toEqual({
			origin: "http://192.168.1.5:3001",
			loopback: false,
		});
	});

	it('"https://machine.tailnet.ts.net" → unchanged origin, no port added, loopback false', () => {
		const result = resolveOrigin("https://machine.tailnet.ts.net", 3001);
		expect(result).toEqual({
			origin: "https://machine.tailnet.ts.net",
			loopback: false,
		});
	});

	it('"http://127.0.0.1:4000" → port kept, loopback true', () => {
		const result = resolveOrigin("http://127.0.0.1:4000", 3001);
		expect(result).toEqual({
			origin: "http://127.0.0.1:4000",
			loopback: true,
		});
	});
});
