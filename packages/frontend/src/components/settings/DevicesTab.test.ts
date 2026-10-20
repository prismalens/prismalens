// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PairedDevice } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { deviceLine, pushLine } from "./DevicesTab";

const device = (userAgent: string | null): PairedDevice => ({
	id: "d1",
	name: "walk6-curl",
	userAgent,
	current: false,
	createdAt: "2026-10-12T10:00:00Z",
	lastSeenAt: null,
	push: null,
});

describe("deviceLine (#831 w6-1)", () => {
	it("names the browser a device paired from", () => {
		expect(
			deviceLine(
				device(
					"Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36",
				),
			),
		).toMatch(/^Chrome on Android\. Paired /);
	});

	it("names a client that is no browser by its own first word", () => {
		expect(deviceLine(device("curl/8.5.0"))).toMatch(/^curl\/8\.5\.0\. Paired /);
	});

	it("keeps the client's own word when the user agent names only a system (#834 review)", () => {
		expect(deviceLine(device("curl/8.5.0 (Android 14)"))).toMatch(/^curl\/8\.5\.0\. Paired /);
	});

	it("says only when it paired with no user agent at all", () => {
		expect(deviceLine(device(null))).toMatch(/^Paired /);
	});
});

describe("pushLine (#859)", () => {
	const since = "2026-10-01T00:00:00Z";
	it("says a dropped subscription must be turned on again on the device", () => {
		expect(
			pushLine({ state: "expired", since, lastDeliveryAt: null, lastError: "The push service answered 410" }),
		).toBe("Push expired. Turn it on again on that device.");
	});

	it("names the failure, or when it last delivered", () => {
		expect(pushLine({ state: "failing", since, lastDeliveryAt: null, lastError: "timeout" })).toBe(
			"Push failing: timeout.",
		);
		expect(pushLine({ state: "active", since, lastDeliveryAt: null, lastError: null })).toBe(
			"Push on, nothing delivered yet.",
		);
		expect(
			pushLine(
				{ state: "active", since, lastDeliveryAt: "2026-10-02T09:30:00Z", lastError: null },
				new Date("2026-10-05T00:00:00Z"),
			),
		).toMatch(/^Push on, last delivered /);
	});
});
