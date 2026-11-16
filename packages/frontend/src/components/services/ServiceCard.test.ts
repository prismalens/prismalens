// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { healthOf, SILENT_AFTER_MS } from "./ServiceCard";

const NOW = Date.parse("2026-11-13T12:00:00Z");
const before = (ms: number) => new Date(NOW - ms).toISOString();

describe("healthOf", () => {
	it("is silent once the last report is older than 24 hours", () => {
		expect(SILENT_AFTER_MS).toBe(86_400_000);
		expect(healthOf([], before(3 * 86_400_000), NOW)).toBe("silent");
		expect(healthOf([], before(SILENT_AFTER_MS + 1), NOW)).toBe("silent");
	});

	it("is ok when the last report is within 24 hours", () => {
		expect(healthOf([], before(SILENT_AFTER_MS), NOW)).toBe("ok");
		expect(healthOf([], before(60_000), NOW)).toBe("ok");
	});

	it("is ok for a service that never reported", () => {
		expect(healthOf([], null, NOW)).toBe("ok");
		expect(healthOf([], undefined, NOW)).toBe("ok");
	});

	it("is ok until the clock is known, so server and client render alike", () => {
		expect(healthOf([], before(3 * 86_400_000), null)).toBe("ok");
	});

	it("lets an open incident's severity outrank silence", () => {
		const old = before(3 * 86_400_000);
		expect(healthOf(["critical"], old, NOW)).toBe("down");
		expect(healthOf(["high", "low"], old, NOW)).toBe("down");
		expect(healthOf(["medium"], old, NOW)).toBe("degraded");
	});
});
