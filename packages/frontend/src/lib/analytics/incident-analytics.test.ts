// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Incident } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { calculateMTTR, groupMTTRByDate } from "./incident-analytics";

function makeIncident(overrides: Partial<Incident>): Incident {
	return {
		id: "00000000-0000-4000-8000-000000000001",
		number: 1,
		title: "Test incident",
		description: null,
		severity: "high",
		status: "resolved",
		priority: "p2",
		serviceId: null,
		assignedToId: null,
		correlationReason: null,
		tags: null,
		customerImpact: null,
		actualCause: null,
		actualCauseCategory: null,
		affectedSystems: null,
		triggeredAt: new Date().toISOString(),
		acknowledgedAt: null,
		resolvedAt: new Date().toISOString(),
		alertCount: 1,
		timeToAcknowledge: null,
		timeToResolve: 120000, // 2 minutes in ms
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		...overrides,
	};
}

describe("calculateMTTR", () => {
	it("returns null when no incidents have timeToResolve", () => {
		const incidents = [
			makeIncident({ status: "resolved", timeToResolve: null }),
			makeIncident({ status: "triggered", timeToResolve: null }),
		];
		expect(calculateMTTR(incidents)).toBeNull();
	});

	it("calculates MTTR in minutes for resolved incidents", () => {
		const incidents = [
			makeIncident({ status: "resolved", timeToResolve: 120000 }), // 2m
			makeIncident({ status: "resolved", timeToResolve: 240000 }), // 4m
		];
		expect(calculateMTTR(incidents)).toBe(3);
	});

	it("counts a closed incident with timeToResolve", () => {
		const incidents = [
			makeIncident({ status: "resolved", timeToResolve: 120000 }), // 2m
			makeIncident({ status: "closed", timeToResolve: 360000 }), // 6m
		];
		expect(calculateMTTR(incidents)).toBe(4);
	});

	it("does not count open incidents towards MTTR", () => {
		const incidents = [
			makeIncident({ status: "triggered", timeToResolve: 120000 }),
			makeIncident({ status: "investigating", timeToResolve: 120000 }),
			makeIncident({ status: "closed", timeToResolve: 240000 }), // 4m
		];
		expect(calculateMTTR(incidents)).toBe(4);
	});
});

describe("groupMTTRByDate", () => {
	it("includes closed incidents with timeToResolve and resolvedAt", () => {
		const today = new Date().toISOString();
		const incidents = [
			makeIncident({
				status: "closed",
				resolvedAt: today,
				timeToResolve: 180000, // 3m
			}),
		];
		const result = groupMTTRByDate(incidents, "day", 7);
		const todayPoint = result.find((p) => p.count > 0);
		expect(todayPoint).toBeDefined();
		expect(todayPoint?.mttr).toBe(3);
		expect(todayPoint?.count).toBe(1);
	});
});
