// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// The built module: it reads dist/adapters/bundled.json beside itself.
import { shippedAdapter, shippedVersion } from "../dist/index.js";

const pins = Object.entries(
	(
		JSON.parse(
			readFileSync(new URL("../package.json", import.meta.url), "utf8"),
		) as { devDependencies: Record<string, string> }
	).devDependencies,
).filter(([pkg]) => /^@agentclientprotocol\/.+-acp$/.test(pkg));

describe("shippedAdapter (#818, #906)", () => {
	it("Given the package's pins, Then at least one adapter is pinned", () => {
		expect(pins.length).toBeGreaterThan(0);
	});

	it.each(pins)(
		"Given the %s pin, Then its bundled script exists at the pinned version",
		(pkg, version) => {
			const script = shippedAdapter(pkg);
			expect(script?.replaceAll("\\", "/")).toMatch(/dist\/adapters\/[^/]+\.mjs$/);
			expect(existsSync(script as string)).toBe(true);
			expect(shippedVersion(pkg)).toBe(version);
		},
	);

	it("Given a package this install does not ship, Then both are null", () => {
		expect(shippedAdapter("@agentclientprotocol/not-shipped")).toBeNull();
		expect(shippedVersion("@agentclientprotocol/not-shipped")).toBeNull();
	});
});
