// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { inlinePlain, lastPlainLine } from "./plain-text.js";

describe("inlinePlain", () => {
	it.each([
		["Looking at **recent commits** first", "Looking at recent commits first"],
		["Run `pnpm test` in _api_", "Run pnpm test in api"],
		["See [the log](https://x.test/l) now", "See the log now"],
		["## Root cause", "Root cause"],
		["- ~~old~~ new", "old new"],
		["keep snake_case_name and 2*3*4", "keep snake_case_name and 2*3*4"],
	])("%s → %s", (raw, plain) => {
		expect(inlinePlain(raw)).toBe(plain);
	});
});

describe("lastPlainLine", () => {
	it("skips a trailing code fence and JSON to the last sentence", () => {
		const text = [
			"Raised the **timeout** to 30.",
			"```json",
			'{ "timeout": 30 }',
			"```",
		].join("\n");
		expect(lastPlainLine(text)).toBe("Raised the timeout to 30.");
	});

	it("skips bare JSON lines with no fence", () => {
		expect(lastPlainLine('Done in `app.txt`.\n{\n  "ok": true\n}')).toBe(
			"Done in app.txt.",
		);
	});

	it("is null for code alone, or no text", () => {
		expect(lastPlainLine("```\nls -la\n```")).toBeNull();
		expect(lastPlainLine(null)).toBeNull();
	});
});
