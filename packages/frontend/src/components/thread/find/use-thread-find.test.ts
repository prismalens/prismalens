// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { firstFrom, locate } from "./use-thread-find";

describe("use-thread-find", () => {
	it("locate([[\"a:1\",2],[\"a:5\",3]], 3) returns {key:\"a:5\", occurrence:1}, and an index past the total returns null.", () => {
		const hits: [string, number][] = [
			["a:1", 2],
			["a:5", 3],
		];

		expect(locate(hits, 3)).toEqual({ key: "a:5", occurrence: 1 });
		expect(locate(hits, 5)).toBeNull();
		expect(locate(hits, 10)).toBeNull();
	});

	it("firstFrom([[\"main:1\",2],[\"main:5\",3]], \"main:4\") returns 2. A key past every hit returns 0, and null returns 0.", () => {
		const hits: [string, number][] = [
			["main:1", 2],
			["main:5", 3],
		];

		expect(firstFrom(hits, "main:4")).toBe(2);
		expect(firstFrom(hits, "main:9")).toBe(0);
		expect(firstFrom(hits, null)).toBe(0);
	});
});
