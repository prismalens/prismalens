// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { getErrorMessage, plainError } from "./get-error-message";

describe("plainError", () => {
	it("turns Failed to fetch into PrismaLens did not answer", () => {
		expect(plainError("Failed to fetch")).toBe(
			"PrismaLens did not answer. Check that it is still running, then try again.",
		);
	});

	it.each([
		"INTERNAL_SERVER_ERROR",
		"HTTP 503",
		"Internal Server Error",
	])("turns %s into PrismaLens could not finish that", (input) => {
		expect(plainError(input)).toBe(
			"PrismaLens could not finish that. Try again; if it keeps happening, restart it with pl up.",
		);
	});

	it("keeps other messages as is", () => {
		expect(plainError("The thread is running.")).toBe(
			"The thread is running.",
		);
	});
});

describe("getErrorMessage", () => {
	it("processes errors through plainError", () => {
		expect(getErrorMessage(new Error("Failed to fetch"))).toBe(
			"PrismaLens did not answer. Check that it is still running, then try again.",
		);
		expect(getErrorMessage({ message: "INTERNAL_SERVER_ERROR" })).toBe(
			"PrismaLens could not finish that. Try again; if it keeps happening, restart it with pl up.",
		);
		expect(getErrorMessage("The thread is running.")).toBe(
			"The thread is running.",
		);
	});
});
