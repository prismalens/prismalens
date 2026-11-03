// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { hasWildcard, likePattern } from "./literal-like.js";

describe("literal LIKE patterns (#1020)", () => {
	it("escapes %, _ and the escape character itself", () => {
		expect(likePattern("80%_x" + "\\")).toBe("%80\\%\\_x\\\\%");
	});

	it("says whether a search needs the escaped path", () => {
		expect(hasWildcard("snake_case")).toBe(true);
		expect(hasWildcard("100%")).toBe(true);
		expect(hasWildcard("plain")).toBe(false);
	});
});
