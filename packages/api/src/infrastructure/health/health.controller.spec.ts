// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import type { TelemetrySettings } from "@prismalens/contracts";
import type { TelemetryService } from "../../core/telemetry/telemetry.service.js";
import { HealthController } from "./health.controller.js";

const telemetry = (settings: Partial<TelemetrySettings>): TelemetryService =>
	({
		getSettings: vi.fn(async () => ({
			enabled: false,
			decided: true,
			forcedOff: false,
			recentlySent: [],
			...settings,
		})),
	}) as unknown as TelemetryService;

/**
 * #628: the payload used to claim "edition":"community" and
 * "services":{"queue":true} — neither is true of this single-process,
 * single-tenant build, and the queue flag was never checked against anything.
 * `version` used to be a hardcoded "0.1.0" regardless of what shipped.
 */
describe("HealthController", () => {
	it("never claims an edition or a queue service", async () => {
		const controller = new HealthController(
			undefined as never,
			telemetry({}),
		);
		const body = await controller.health();

		expect(body).not.toHaveProperty("edition");
		expect(body.services).not.toHaveProperty("queue");
		expect(body.services).toEqual({ api: true });
	});

	it("reports a real, non-hardcoded version", async () => {
		const controller = new HealthController(
			undefined as never,
			telemetry({}),
		);
		const body = await controller.health();

		expect(body.version).not.toBe("0.1.0");
		expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
	});

	/**
	 * `pl up` reads this to decide whether to print its one pointer at Settings
	 * (#602). It is a preference, never an install id or anything that
	 * identifies the machine.
	 */
	describe("the usage-data consent state", () => {
		it.each([
			[{ decided: false }, "undecided"],
			[{ decided: true, enabled: true }, "on"],
			[{ decided: true, enabled: false }, "off"],
		])("%o reads as %s", async (settings, expected) => {
			const controller = new HealthController(
				undefined as never,
				telemetry(settings),
			);
			expect((await controller.health()).telemetry).toBe(expected);
		});

		it("carries no identifier", async () => {
			const controller = new HealthController(
				undefined as never,
				telemetry({ decided: false }),
			);
			const body = JSON.stringify(await controller.health());
			expect(body).not.toMatch(/install/i);
			expect(body).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
		});

		it("still answers when the settings read fails", async () => {
			const broken = {
				getSettings: vi.fn(async () => {
					throw new Error("database is locked");
				}),
			} as unknown as TelemetryService;
			const body = await new HealthController(
				undefined as never,
				broken,
			).health();
			expect(body.status).toBe("ok");
			expect(body.telemetry).toBe("off");
		});
	});
});
