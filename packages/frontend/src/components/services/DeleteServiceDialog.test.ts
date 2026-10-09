// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DeleteServiceDialog, dependencyImpact } from "./DeleteServiceDialog";

vi.mock("@/components/shared/DestructiveConfirm", () => ({
	DestructiveConfirm: (p: { description: React.ReactNode; isLoading?: boolean }) =>
		React.createElement(
			"div",
			{ "data-confirm-disabled": String(!!p.isLoading) },
			p.description,
		),
}));

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

describe("DeleteServiceDialog waits for the dependency links (#805)", () => {
	const render = (links: "pending" | "error" | "success") =>
		renderToStaticMarkup(
			React.createElement(DeleteServiceDialog, {
				open: true,
				onOpenChange: () => {},
				serviceId: "s1",
				serviceName: "payments",
				downstream: ["checkout"],
				links,
				onRetryLinks: () => {},
			}),
		);

	it("disables Delete while the links load and says nothing of them", () => {
		const html = render("pending");
		expect(html).toContain('data-confirm-disabled="true"');
		expect(html).not.toContain("delete-service-links");
	});

	it("names a failed load with Retry and leaves Delete enabled", () => {
		const html = render("error");
		expect(html).toContain('data-confirm-disabled="false"');
		expect(html).toContain("load this service&#x27;s dependency links");
		expect(html).toContain("Retry");
	});

	it("lists the links once they load", () => {
		const html = render("success");
		expect(html).toContain('data-confirm-disabled="false"');
		expect(html).toContain("checkout depends on it.");
	});
});
