// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { stripInlineMarkdown } from "./strip-inline-markdown";

describe("stripInlineMarkdown", () => {
	it("drops code-span backticks and keeps the code", () => {
		expect(
			stripInlineMarkdown("Checkout calls the provider with no `timeout`."),
		).toBe("Checkout calls the provider with no timeout.");
	});

	it("drops emphasis and link marks", () => {
		expect(
			stripInlineMarkdown("**Pool** is *full*, see [the PR](https://x/1)"),
		).toBe("Pool is full, see the PR");
	});

	it("leaves identifiers with underscores and stars alone", () => {
		expect(stripInlineMarkdown("max_pool_size is 2*n")).toBe(
			"max_pool_size is 2*n",
		);
	});

	it("leaves plain text as it is", () => {
		expect(stripInlineMarkdown("No cause found.")).toBe("No cause found.");
	});
});
