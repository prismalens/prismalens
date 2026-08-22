// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { AlertQuerySchema, UNASSIGNED_ALERT_STATUSES } from "./alert.js";

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

describe("AlertQuerySchema.unassigned and UNASSIGNED_ALERT_STATUSES", () => {
	it("defines UNASSIGNED_ALERT_STATUSES as triggered and acknowledged", () => {
		expect(UNASSIGNED_ALERT_STATUSES).toEqual(["triggered", "acknowledged"]);
	});

	it("parses the HTTP query string 'true' as true", () => {
		expect(
			AlertQuerySchema.parse({ unassigned: "true", limit: 50, offset: 0 })
				.unassigned,
		).toBe(true);
	});

	it("parses the HTTP query string 'false' as false", () => {
		expect(
			AlertQuerySchema.parse({ unassigned: "false", limit: 50, offset: 0 })
				.unassigned,
		).toBe(false);
	});

	it("still accepts a real boolean from an in-process caller", () => {
		expect(
			AlertQuerySchema.parse({ unassigned: true, limit: 50, offset: 0 })
				.unassigned,
		).toBe(true);
	});

	it("leaves unassigned undefined when omitted, so existing callers are unaffected", () => {
		expect(
			AlertQuerySchema.parse({ limit: 50, offset: 0 }).unassigned,
		).toBeUndefined();
	});

	it("accepts unassigned alongside status, severity and limit", () => {
		const parsed = AlertQuerySchema.parse({
			unassigned: "true",
			status: "acknowledged",
			severity: "critical",
			limit: "100",
			offset: "0",
		});
		expect(parsed).toEqual({
			unassigned: true,
			status: "acknowledged",
			severity: "critical",
			limit: 100,
			offset: 0,
		});
	});
});
