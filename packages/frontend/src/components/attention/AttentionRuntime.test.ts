// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { threadOnScreen } from "./AttentionRuntime.js";

describe("threadOnScreen (#1101 category 4)", () => {
	it("threadOnScreen(\"/threads/00000000-0000-4000-8000-000000000001\") returns that id", () => {
		expect(
			threadOnScreen("/threads/00000000-0000-4000-8000-000000000001"),
		).toBe("00000000-0000-4000-8000-000000000001");
	});

	it("/threads/<id>/x returns that id too", () => {
		expect(
			threadOnScreen("/threads/00000000-0000-4000-8000-000000000001/x"),
		).toBe("00000000-0000-4000-8000-000000000001");
	});

	it("\"/threads\" and \"/settings\" return null", () => {
		expect(threadOnScreen("/threads")).toBe(null);
		expect(threadOnScreen("/settings")).toBe(null);
	});
});
