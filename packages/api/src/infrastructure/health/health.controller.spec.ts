// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { HealthController } from "./health.controller.js";

/**
 * #628: the payload used to claim "edition":"community" and
 * "services":{"queue":true} — neither is true of this single-process,
 * single-tenant build, and the queue flag was never checked against anything.
 * `version` used to be a hardcoded "0.1.0" regardless of what shipped.
 */
describe("HealthController", () => {
	it("never claims an edition or a queue service", () => {
		const controller = new HealthController(undefined as never);
		const body = controller.health();

		expect(body).not.toHaveProperty("edition");
		expect(body.services).not.toHaveProperty("queue");
		expect(body.services).toEqual({ api: true });
	});

	it("reports a real, non-hardcoded version", () => {
		const controller = new HealthController(undefined as never);
		const body = controller.health();

		expect(body.version).not.toBe("0.1.0");
		expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
	});
});
