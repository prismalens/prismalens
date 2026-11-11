// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { attachRefusal, needsDownscale } from "./attachments";

const MB = 1024 * 1024;

describe("attachRefusal and needsDownscale (#1024)", () => {
	it("attachRefusal returns exact refusal messages at limits and null under limits", () => {
		expect(
			attachRefusal(
				{ name: "f11.txt", type: "text/plain", size: 100 },
				{ count: 10, bytes: 1000 },
			),
		).toBe("11th file: 10 per message");

		expect(
			attachRefusal(
				{ name: "large.bin", type: "application/octet-stream", size: 26 * MB },
				{ count: 0, bytes: 0 },
			),
		).toBe("Over 25 MB");

		expect(
			attachRefusal(
				{ name: "next.bin", type: "application/octet-stream", size: 10 * MB },
				{ count: 1, bytes: 195 * MB },
			),
		).toBe("Over 200 MB in all");

		expect(
			attachRefusal(
				{ name: "heap.hprof", type: "application/octet-stream", size: 5 * MB },
				{ count: 1, bytes: 10 * MB },
			),
		).toBeNull();
	});

	it("needsDownscale is true for a 5 MB png, false for a 5 MB gif and a 3 MB png", () => {
		expect(needsDownscale({ type: "image/png", size: 5 * MB })).toBe(true);
		expect(needsDownscale({ type: "image/gif", size: 5 * MB })).toBe(false);
		expect(needsDownscale({ type: "image/png", size: 3 * MB })).toBe(false);
	});
});
