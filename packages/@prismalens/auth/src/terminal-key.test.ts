// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { terminalKeyFor, terminalKeyMatches } from "./terminal-key.js";

const SECRET = "a".repeat(64);

describe("terminal key", () => {
	it("is stable per device and secret, and differs across devices", () => {
		expect(terminalKeyFor("dev-1", SECRET)).toBe(
			terminalKeyFor("dev-1", SECRET),
		);
		expect(terminalKeyFor("dev-1", SECRET)).not.toBe(
			terminalKeyFor("dev-2", SECRET),
		);
		expect(terminalKeyFor("dev-1", SECRET)).not.toBe(
			terminalKeyFor("dev-1", "b".repeat(64)),
		);
	});

	it("matches only the key minted for that device", () => {
		const key = terminalKeyFor("dev-1", SECRET);
		expect(terminalKeyMatches(key, "dev-1", SECRET)).toBe(true);
		expect(terminalKeyMatches(key, "dev-2", SECRET)).toBe(false);
		expect(terminalKeyMatches(`${key}x`, "dev-1", SECRET)).toBe(false);
		expect(terminalKeyMatches("", "dev-1", SECRET)).toBe(false);
		expect(terminalKeyMatches(undefined, "dev-1", SECRET)).toBe(false);
	});

	it("refuses to derive a key from an empty secret", () => {
		expect(() => terminalKeyFor("dev-1", "")).toThrow();
	});
});
