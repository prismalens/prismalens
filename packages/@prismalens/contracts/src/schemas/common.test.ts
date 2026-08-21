// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AlertQuerySchema } from "./alert.js";
import { AlertMappingQuerySchema } from "./alert-mapping.js";
import { paginatedResponseSchema, QueryBooleanSchema } from "./common.js";
import { CorrelationRuleQuerySchema } from "./correlation.js";
import { EventQuerySchema } from "./event.js";

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

describe("QueryBooleanSchema", () => {
	it("parses string 'false' as boolean false (regression fix)", () => {
		expect(QueryBooleanSchema.parse("false")).toBe(false);
	});

	it("parses string 'true' as boolean true", () => {
		expect(QueryBooleanSchema.parse("true")).toBe(true);
	});

	it("parses native booleans unchanged", () => {
		expect(QueryBooleanSchema.parse(true)).toBe(true);
		expect(QueryBooleanSchema.parse(false)).toBe(false);
	});

	it("handles case-insensitive strings ('True', 'TRUE', 'False', 'FALSE')", () => {
		expect(QueryBooleanSchema.parse("True")).toBe(true);
		expect(QueryBooleanSchema.parse("TRUE")).toBe(true);
		expect(QueryBooleanSchema.parse("False")).toBe(false);
		expect(QueryBooleanSchema.parse("FALSE")).toBe(false);
	});

	it("rejects non-boolean strings and invalid types", () => {
		const invalidInputs = [
			"yes",
			"no",
			"1",
			"0",
			"",
			"undefined",
			"null",
			1,
			0,
			null,
			undefined,
			{},
		];
		for (const input of invalidInputs) {
			expect(QueryBooleanSchema.safeParse(input).success).toBe(false);
			expect(() => QueryBooleanSchema.parse(input)).toThrow();
		}
	});
});

describe("Query schemas boolean filter integration", () => {
	it("AlertQuerySchema parses 'false' string as boolean false for hasIncident", () => {
		const result = AlertQuerySchema.parse({ hasIncident: "false" });
		expect(result.hasIncident).toBe(false);
		expect(
			AlertQuerySchema.parse({ hasIncident: "true" }).hasIncident,
		).toBe(true);
		expect(
			AlertQuerySchema.safeParse({ hasIncident: "yes" }).success,
		).toBe(false);
	});

	it("AlertMappingQuerySchema parses 'false' string as boolean false for enabled", () => {
		const result = AlertMappingQuerySchema.parse({ enabled: "false" });
		expect(result.enabled).toBe(false);
		expect(
			AlertMappingQuerySchema.parse({ enabled: "true" }).enabled,
		).toBe(true);
		expect(
			AlertMappingQuerySchema.safeParse({ enabled: "yes" }).success,
		).toBe(false);
	});

	it("CorrelationRuleQuerySchema parses 'false' string as boolean false for enabled", () => {
		const result = CorrelationRuleQuerySchema.parse({ enabled: "false" });
		expect(result.enabled).toBe(false);
		expect(
			CorrelationRuleQuerySchema.parse({ enabled: "true" }).enabled,
		).toBe(true);
		expect(
			CorrelationRuleQuerySchema.safeParse({ enabled: "yes" }).success,
		).toBe(false);
	});

	it("EventQuerySchema parses 'false' string as boolean false for processed", () => {
		const result = EventQuerySchema.parse({ processed: "false" });
		expect(result.processed).toBe(false);
		expect(EventQuerySchema.parse({ processed: "true" }).processed).toBe(
			true,
		);
		expect(
			EventQuerySchema.safeParse({ processed: "yes" }).success,
		).toBe(false);
	});
});
