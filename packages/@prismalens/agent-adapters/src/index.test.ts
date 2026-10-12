// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { shippedAdapter, shippedVersion } from "./index.js";

const pins = (
	JSON.parse(
		readFileSync(new URL("../package.json", import.meta.url), "utf8"),
	) as { dependencies: Record<string, string> }
).dependencies;

describe("shippedAdapter (#818)", () => {
	it.each(Object.entries(pins))(
		"Given the %s pin, Then its bin script exists at the pinned version",
		(pkg, version) => {
			const script = shippedAdapter(pkg);
			expect(script).toMatch(/dist[\\/]index\.js$/);
			expect(existsSync(script as string)).toBe(true);
			expect(shippedVersion(pkg)).toBe(version);
		},
	);

	it("Given a package this install does not ship, Then both are null", () => {
		expect(shippedAdapter("@agentclientprotocol/not-shipped")).toBeNull();
		expect(shippedVersion("@agentclientprotocol/not-shipped")).toBeNull();
	});
});
