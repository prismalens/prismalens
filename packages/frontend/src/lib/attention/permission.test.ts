// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { permissionWords } from "./permission.js";

describe("permissionWords (#1101 category 4 item 1)", () => {
	it("returns word exactly Allowed, Not asked yet, Blocked, Needs HTTPS, Not supported for granted, default, denied, insecure, unsupported", () => {
		expect(permissionWords("granted").word).toBe("Allowed");
		expect(permissionWords("default").word).toBe("Not asked yet");
		expect(permissionWords("denied").word).toBe("Blocked");
		expect(permissionWords("insecure").word).toBe("Needs HTTPS");
		expect(permissionWords("unsupported").word).toBe("Not supported");
	});

	it("the denied hint contains site settings", () => {
		expect(permissionWords("denied").hint).toContain("site settings");
	});
});
