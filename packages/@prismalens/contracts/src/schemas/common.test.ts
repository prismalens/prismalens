// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { paginatedResponseSchema } from "./common.js";

describe("paginatedResponseSchema", () => {
	it("parses valid paginated envelope correctly", () => {
		const itemSchema = z.object({ id: z.string(), name: z.string() });
		const schema = paginatedResponseSchema(itemSchema);

		const validData = {
			data: [
				{ id: "1", name: "Item 1" },
				{ id: "2", name: "Item 2" },
			],
			pagination: {
				total: 10,
				limit: 2,
				offset: 0,
				hasMore: true,
			},
		};

		const result = schema.parse(validData);
		expect(result).toEqual(validData);
	});

	it("rejects invalid pagination envelope", () => {
		const itemSchema = z.object({ id: z.string() });
		const schema = paginatedResponseSchema(itemSchema);

		const invalidData = {
			data: [{ id: "1" }],
			pagination: {
				total: "not-a-number",
				limit: 2,
				offset: 0,
				hasMore: true,
			},
		};

		expect(() => schema.parse(invalidData)).toThrow();
	});
});
