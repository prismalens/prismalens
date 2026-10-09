// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import { dependencyImpact } from "./DeleteServiceDialog";

vi.mock("@/lib/api/hooks", () => ({
	useDeleteService: () => ({
		mutateAsync: vi.fn(),
		isPending: false,
	}),
}));

describe("dependencyImpact (#673 walk 4, QA-11)", () => {
	it("returns null with no links", () => {
		expect(dependencyImpact([], [])).toBeNull();
	});

	it("formats one downstream link", () => {
		expect(dependencyImpact([], ["b"])).toBe(
			"Its dependency link goes too: b depends on it.",
		);
	});

	it("formats singular upstream link only", () => {
		expect(dependencyImpact(["c"], [])).toBe(
			"Its dependency link goes too: It depends on c.",
		);
	});

	it("formats two downstream links and one upstream link", () => {
		expect(dependencyImpact(["c"], ["a", "b"])).toBe(
			"Its 3 dependency links go too: a and b depend on it. It depends on c.",
		);
	});

	it("formats more than 3 names using first two and N more", () => {
		expect(
			dependencyImpact([], ["alpha", "beta", "gamma", "delta"]),
		).toBe(
			"Its 4 dependency links go too: alpha, beta and 2 more depend on it.",
		);
	});
});
