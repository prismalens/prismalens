// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { isEaddrinuseError } from "./listen-error.js";

describe("isEaddrinuseError", () => {
	it("returns true for error objects with code EADDRINUSE", () => {
		const err = new Error(
			"listen EADDRINUSE: address already in use 127.0.0.1:3001",
		);
		(err as { code?: string }).code = "EADDRINUSE";
		expect(isEaddrinuseError(err)).toBe(true);
	});

	it("returns true for generic objects with code EADDRINUSE", () => {
		expect(isEaddrinuseError({ code: "EADDRINUSE" })).toBe(true);
	});

	it("returns true for error objects whose message contains EADDRINUSE", () => {
		expect(
			isEaddrinuseError(new Error("listen EADDRINUSE 127.0.0.1:3001")),
		).toBe(true);
	});

	it("returns false for non-EADDRINUSE errors", () => {
		expect(isEaddrinuseError(new Error("EACCES permission denied"))).toBe(
			false,
		);
		expect(isEaddrinuseError(new Error("Generic failure"))).toBe(false);
	});

	it("returns false for null, undefined, or non-object values", () => {
		expect(isEaddrinuseError(null)).toBe(false);
		expect(isEaddrinuseError(undefined)).toBe(false);
		expect(isEaddrinuseError("EADDRINUSE")).toBe(false);
		expect(isEaddrinuseError(123)).toBe(false);
	});
});
