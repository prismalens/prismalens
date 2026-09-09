// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { dispatchSchema } from "./dispatch.js";

describe("dispatch schema", () => {
	it("defaults the concurrency cap to 3", () => {
		const result = dispatchSchema.safeParse({});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.PRISMALENS_DISPATCH_CONCURRENCY).toBe(3);
		}
	});

	it("rejects a concurrency below 1", () => {
		const result = dispatchSchema.safeParse({
			PRISMALENS_DISPATCH_CONCURRENCY: "0",
		});
		expect(result.success).toBe(false);
	});

	it("rejects a concurrency above 100", () => {
		const result = dispatchSchema.safeParse({
			PRISMALENS_DISPATCH_CONCURRENCY: "101",
		});
		expect(result.success).toBe(false);
	});
});
