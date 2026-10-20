// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PairedDevice } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { deviceLine } from "./DevicesTab";

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
