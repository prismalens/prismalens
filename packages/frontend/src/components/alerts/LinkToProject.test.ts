// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { needsFind } from "@/lib/needs-find";
import { linkName, linkPlan } from "./LinkToProject";

describe("linkPlan (#1020)", () => {
	const services = [
		{ id: "s1", name: "cart-api" },
		{ id: "s2", name: "checkout" },
	];

	it("links to the service of that exact name", () => {
		expect(linkPlan("cart-api", services)).toEqual({ serviceId: "s1" });
	});

	it("makes a new service when none has that name, case included", () => {
		expect(linkPlan("Cart-API", services)).toEqual({ create: "Cart-API" });
		expect(linkPlan("billing", [])).toEqual({ create: "billing" });
	});
});

describe("linkName (#1020, review of #1031)", () => {
	it("is the alert's service label, trimmed; an alert without one has no link", () => {
		expect(linkName({ service: " cart-api " })).toBe("cart-api");
		expect(linkName({ service: "" })).toBeNull();
		expect(linkName({ team: "pay" })).toBeNull();
		expect(linkName(null)).toBeNull();
	});
});

describe("needsFind (#1020, review of #1031)", () => {
	it("offers a search once the list holds less than the whole catalog, or a search is typed", () => {
		expect(needsFind({ data: [{}, {}], total: 2 }, "")).toBe(false);
		expect(needsFind({ data: [{}, {}], total: 140 }, "")).toBe(true);
		expect(needsFind({ data: [], total: 0 }, "cart")).toBe(true);
		expect(needsFind(undefined, "")).toBe(false);
	});
});
