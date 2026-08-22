// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	AlertQuerySchema,
	isUnassignedAlert,
	UNASSIGNED_ALERT_STATUSES,
} from "./alert.js";

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

describe("isUnassignedAlert predicate and UNASSIGNED_ALERT_STATUSES", () => {
	it("defines UNASSIGNED_ALERT_STATUSES as triggered and acknowledged", () => {
		expect(UNASSIGNED_ALERT_STATUSES).toEqual(["triggered", "acknowledged"]);
	});

	it("returns true for unassigned alerts with status triggered or acknowledged", () => {
		expect(isUnassignedAlert({ incidentId: null, status: "triggered" })).toBe(
			true,
		);
		expect(
			isUnassignedAlert({ incidentId: null, status: "acknowledged" }),
		).toBe(true);
	});

	it("returns false for alerts with status resolved, suppressed, or correlated even if incidentId is null", () => {
		expect(isUnassignedAlert({ incidentId: null, status: "resolved" })).toBe(
			false,
		);
		expect(isUnassignedAlert({ incidentId: null, status: "suppressed" })).toBe(
			false,
		);
		expect(isUnassignedAlert({ incidentId: null, status: "correlated" })).toBe(
			false,
		);
	});

	it("returns false for alerts assigned to an incident regardless of status", () => {
		expect(
			isUnassignedAlert({
				incidentId: "11111111-1111-4111-8111-111111111111",
				status: "triggered",
			}),
		).toBe(false);
		expect(
			isUnassignedAlert({
				incidentId: "11111111-1111-4111-8111-111111111111",
				status: "acknowledged",
			}),
		).toBe(false);
	});
});
