// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { linkPlan } from "./LinkToProject";

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
