// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { parseSearchWith } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { parseServicesSearch } from "./services-search";

/** What the router's default parser hands validateSearch for a typed URL. */
const typed = (query: string) => parseSearchWith(JSON.parse)(query);

describe("parseServicesSearch", () => {
	it("opens Add for /services?add=1 typed by hand", () => {
		expect(typed("?add=1")).toEqual({ add: 1 });
		expect(parseServicesSearch(typed("?add=1")).add).toBe("1");
	});

	it("opens Add for a link that passes the string", () => {
		expect(parseServicesSearch({ add: "1" }).add).toBe("1");
	});

	it("ignores any other add value and keeps the rest", () => {
		expect(parseServicesSearch(typed("?add=yes&team=core&page=2"))).toEqual({
			add: undefined,
			team: "core",
			search: undefined,
			page: 2,
		});
	});
});
