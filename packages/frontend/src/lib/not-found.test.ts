// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { isNotFound } from "./not-found";

const ID = "00000000-0000-4000-8000-000000000001";

describe("isNotFound (#831 w6-33)", () => {
	it("reads an address that is no id, or a 404, as not found", () => {
		expect(isNotFound(new Error("bad request"), "does-not-exist")).toBe(true);
		expect(isNotFound({ status: 404 }, ID)).toBe(true);
	});

	it("leaves any other failure to the error page", () => {
		expect(isNotFound({ status: 500 }, ID)).toBe(false);
		expect(isNotFound(new TypeError("Failed to fetch"), ID)).toBe(false);
	});
});
