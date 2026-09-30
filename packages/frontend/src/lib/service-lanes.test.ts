// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	AlertWithRelations,
	IncidentWithRelations,
} from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import {
	alertLanes,
	alsoIn,
	incidentLanes,
	NO_SERVICE_LANE,
} from "./service-lanes";

const svc = (id: string, name: string) => ({ id, name, displayName: null });
const inc = (
	id: string,
	services: { id: string; name: string; displayName: string | null }[],
): IncidentWithRelations =>
	({ id, services, service: null }) as unknown as IncidentWithRelations;

describe("incidentLanes", () => {
	it("puts an incident in each service it touches, No service last", () => {
		const lanes = incidentLanes([
			inc("a", [svc("s2", "search"), svc("s1", "payments")]),
			inc("b", []),
			inc("c", [svc("s1", "payments")]),
		]);
		expect(lanes.map((l) => l.name)).toEqual([
			"payments",
			"search",
			"No service",
		]);
		expect(lanes[0]?.items.map((i) => i.id)).toEqual(["a", "c"]);
		expect(lanes[1]?.items.map((i) => i.id)).toEqual(["a"]);
		expect(lanes[2]?.id).toBe(NO_SERVICE_LANE);
	});

	it("falls back to the incident's own service when the list carries none", () => {
		const one = {
			id: "x",
			service: { id: "s9", name: "api", displayName: "API Gateway" },
		} as unknown as IncidentWithRelations;
		expect(incidentLanes([one]).map((l) => l.name)).toEqual(["API Gateway"]);
	});

	it("shows a service's display name when it has one", () => {
		const a = inc("a", [{ id: "s1", name: "api-gateway", displayName: "API Gateway" }]);
		expect(incidentLanes([a]).map((l) => l.name)).toEqual(["API Gateway"]);
	});

	it("names the other lanes an incident also sits in", () => {
		const a = inc("a", [svc("s1", "checkout"), svc("s2", "payments"), svc("s3", "search")]);
		expect(alsoIn(a, "s1")).toEqual(["payments", "search"]);
	});
});

describe("alertLanes", () => {
	it("groups alerts by their own service", () => {
		const alert = (id: string, s?: { id: string; name: string; displayName: string | null }) =>
			({ id, service: s ? { ...s, displayName: null } : null }) as unknown as AlertWithRelations;
		const lanes = alertLanes([alert("1", svc("s1", "api")), alert("2"), alert("3", svc("s1", "api"))]);
		expect(lanes.map((l) => [l.name, l.items.length])).toEqual([
			["api", 2],
			["No service", 1],
		]);
	});
});
