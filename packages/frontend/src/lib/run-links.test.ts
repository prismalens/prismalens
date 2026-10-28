// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { runLinks } from "./run-links";

describe("runLinks", () => {
	it("gathers each http(s) page an alert or the report names, once", () => {
		const links = runLinks(
			[
				{
					title: "CheckoutLatencyHigh",
					sourceUrl: "https://grafana.internal/d/checkout",
					description: "See https://runbooks.example.com/checkout.",
					labels: { dashboard: "https://grafana.internal/d/checkout" },
				},
			],
			{
				summary: "The deploy at https://github.com/acme/api/releases/tag/v2 cut the timeout.",
			},
		);
		expect(links).toEqual([
			{
				url: "https://grafana.internal/d/checkout",
				label: "CheckoutLatencyHigh, in its source",
			},
			{
				url: "https://runbooks.example.com/checkout",
				label: "runbooks.example.com/checkout",
			},
			{
				url: "https://github.com/acme/api/releases/tag/v2",
				label: "github.com/acme/api/releases/tag/v2",
			},
		]);
	});

	it("ends a link at the end of its line in the report (#977 OBJ-015)", () => {
		const links = runLinks([], {
			summary: "Dashboard: https://g.example/d/abc\nRunbook: https://r.example/x",
		});
		expect(links.map((l) => l.url)).toEqual([
			"https://g.example/d/abc",
			"https://r.example/x",
		]);
	});

	it("takes nothing that is not http or https", () => {
		const links = runLinks(
			[
				{
					title: "x",
					sourceUrl: "javascript:alert(1)",
					description: "file:///etc/passwd and ftp://host/x",
					labels: null,
				},
			],
			null,
		);
		expect(links).toEqual([]);
	});
});
