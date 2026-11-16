// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { titleWithCount } from "./needs-count.js";

describe("titleWithCount (#1101 category 3)", () => {
	it("titleWithCount(\"Home\", 0) = \"Home – PrismaLens\"", () => {
		expect(titleWithCount("Home", 0)).toBe("Home – PrismaLens");
	});

	it("titleWithCount(\"Home\", 3) = \"(3) Home – PrismaLens\"", () => {
		expect(titleWithCount("Home", 3)).toBe("(3) Home – PrismaLens");
	});

	it("titleWithCount(null, 2) = \"(2) PrismaLens\"", () => {
		expect(titleWithCount(null, 2)).toBe("(2) PrismaLens");
	});
});
