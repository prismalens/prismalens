// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { invalidateTopics, reconnectAsOf } from "./live-refresh";
import { orpc } from "./orpc-client";

describe("invalidateTopics (walk f27)", () => {
	it("re-reads the incident lists when an alert or a run changes, once each", () => {
		const queryClient = new QueryClient();
		const invalidate = vi.spyOn(queryClient, "invalidateQueries");

		invalidateTopics(queryClient, ["alerts", "investigations"]);

		const keys = invalidate.mock.calls.map(([f]) => JSON.stringify(f?.queryKey));
		expect(keys).toEqual([
			JSON.stringify(orpc.alerts.key()),
			JSON.stringify(orpc.incidents.key()),
			JSON.stringify(orpc.investigations.key()),
		]);
	});
});

describe("reconnectAsOf", () => {
	it("says nothing while connected or for the first ten seconds down", () => {
		expect(reconnectAsOf({ connected: true, lostAt: 0 }, 60_000)).toBeNull();
		expect(reconnectAsOf({ connected: false, lostAt: 1_000 }, 10_999)).toBeNull();
	});

	it("names when the screen was last live once the stream has been down ten seconds", () => {
		expect(reconnectAsOf({ connected: false, lostAt: 1_000 }, 11_000)).toBe(1_000);
	});
});
