// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AlertStatus } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { alertSince, dayOrClock } from "./AlertListPane";
import { formatClock, formatDate } from "@/lib/format-time";

describe("alertSince", () => {
	it("returns resolvedAt when alert is resolved and resolvedAt is present (#673 walk 4)", () => {
		const alert = {
			status: "resolved" as AlertStatus,
			triggeredAt: "2026-10-01T12:00:00.000Z",
			resolvedAt: "2026-10-01T13:00:00.000Z",
		};
		expect(alertSince(alert)).toBe("2026-10-01T13:00:00.000Z");
	});

	it("returns triggeredAt when alert is triggered (#673 walk 4)", () => {
		const alert = {
			status: "triggered" as AlertStatus,
			triggeredAt: "2026-10-01T12:00:00.000Z",
			resolvedAt: null,
		};
		expect(alertSince(alert)).toBe("2026-10-01T12:00:00.000Z");
	});

	it("returns triggeredAt when alert is acknowledged (#673 walk 4)", () => {
		const alert = {
			status: "acknowledged" as AlertStatus,
			triggeredAt: "2026-10-01T12:00:00.000Z",
			resolvedAt: null,
		};
		expect(alertSince(alert)).toBe("2026-10-01T12:00:00.000Z");
	});

	it("returns triggeredAt when alert is resolved but resolvedAt is null (#673 walk 4)", () => {
		const alert = {
			status: "resolved" as AlertStatus,
			triggeredAt: "2026-10-01T12:00:00.000Z",
			resolvedAt: null,
		};
		expect(alertSince(alert)).toBe("2026-10-01T12:00:00.000Z");
	});
});

describe("dayOrClock", () => {
	it("returns the clock time matching formatClock for a time today (#673 walk 4)", () => {
		const now = new Date();
		const iso = now.toISOString();
		expect(dayOrClock(iso)).toBe(formatClock(now));
	});

	it("returns the date matching formatDate for a date 3 days ago (#673 walk 4)", () => {
		const past = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
		const iso = past.toISOString();
		expect(dayOrClock(iso)).toBe(formatDate(past));
	});
});
