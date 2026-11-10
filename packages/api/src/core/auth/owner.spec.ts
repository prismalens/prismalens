// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ORPCError } from "@orpc/nest";
import { ACCESS_SCOPE } from "@prismalens/auth";
import { describe, expect, it } from "vitest";
import { isOwner, OWNER_ONLY, requireOwner } from "./owner.js";

const device = (scopes: string[], id = "dev-1") => ({
	operator: { device: { id, scopes } },
});

describe("owner guard (#1066)", () => {
	it("isOwner is true only when the device holds admin:access", () => {
		expect(isOwner(undefined)).toBe(false);
		expect(isOwner({})).toBe(false);
		expect(isOwner({ operator: null })).toBe(false);
		expect(isOwner(device([]))).toBe(false);
		expect(isOwner(device(["investigate:read", "investigate:operate"]))).toBe(false);
		expect(isOwner(device([ACCESS_SCOPE]))).toBe(true);
	});

	it("requireOwner throws FORBIDDEN for requests with no operator", () => {
		expect(() => requireOwner(undefined)).toThrowError(
			expect.objectContaining({ code: "FORBIDDEN", message: OWNER_ONLY }),
		);
		expect(() => requireOwner({})).toThrowError(
			expect.objectContaining({ code: "FORBIDDEN", message: OWNER_ONLY }),
		);
		expect(() => requireOwner({ operator: null })).toThrowError(
			expect.objectContaining({ code: "FORBIDDEN", message: OWNER_ONLY }),
		);
	});

	it("requireOwner throws FORBIDDEN with default message when scopes lack admin:access", () => {
		const req = device(["investigate:read", "investigate:operate"]);
		expect(() => requireOwner(req)).toThrowError(
			expect.objectContaining({ code: "FORBIDDEN", message: OWNER_ONLY }),
		);
	});

	it("requireOwner throws FORBIDDEN with a custom message when provided", () => {
		const req = device(["investigate:read", "investigate:operate"]);
		const custom = "Only the owner can change this.";
		expect(() => requireOwner(req, custom)).toThrowError(
			expect.objectContaining({ code: "FORBIDDEN", message: custom }),
		);
	});

	it("requireOwner returns the device id for an owner request", () => {
		const req = device([ACCESS_SCOPE], "owner-dev-99");
		expect(requireOwner(req)).toBe("owner-dev-99");
	});

	it("requireOwner returns null when owner request has no device id", () => {
		const req = { operator: { device: { scopes: [ACCESS_SCOPE] } } };
		expect(requireOwner(req)).toBeNull();
	});
});
