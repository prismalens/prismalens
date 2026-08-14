// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { AlertQuerySchema } from "./alert.js";

describe("AlertQuerySchema.hasIncident", () => {
	// z.coerce.boolean() is `Boolean(value)` — the HTTP query string "false"
	// is a non-empty string, so it coerces to `true`. This is the #tab=unmapped
	// bug: the alerts route asks for hasIncient=false and gets hasIncient=true.
	it("parses the HTTP query string 'false' as false, not true", () => {
		expect(
			AlertQuerySchema.parse({ hasIncident: "false", limit: 50, offset: 0 })
				.hasIncident,
		).toBe(false);
	});

	it("parses the HTTP query string 'true' as true", () => {
		expect(
			AlertQuerySchema.parse({ hasIncident: "true", limit: 50, offset: 0 })
				.hasIncident,
		).toBe(true);
	});

	it("still accepts a real boolean from an in-process caller", () => {
		expect(
			AlertQuerySchema.parse({ hasIncident: false, limit: 50, offset: 0 })
				.hasIncident,
		).toBe(false);
		expect(
			AlertQuerySchema.parse({ hasIncident: true, limit: 50, offset: 0 })
				.hasIncident,
		).toBe(true);
	});

	it("leaves hasIncident undefined when omitted", () => {
		expect(
			AlertQuerySchema.parse({ limit: 50, offset: 0 }).hasIncident,
		).toBeUndefined();
	});
});
