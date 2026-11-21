// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prefetchWindow, takeWindow } from "./prefetch";

const answers: Array<(v: unknown) => void> = [];
vi.mock("@/lib/api/orpc-client", () => ({
	client: {
		investigations: {
			openWindow: () =>
				new Promise((done) => {
					answers.push(done);
				}),
		},
	},
}));

describe("prefetchWindow", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => {
		vi.useRealTimers();
		answers.length = 0;
	});

	// Over Slow 3G the page outlived its freshness in flight and was asked for twice (#1154).
	it("hands over a page still on its way, however long it has taken", () => {
		prefetchWindow("t1", {});
		vi.advanceTimersByTime(45_000);
		expect(takeWindow("t1", {})).not.toBeNull();
	});

	it("drops a page that arrived long before the view asked", async () => {
		prefetchWindow("t2", {});
		answers[0]?.({});
		await vi.advanceTimersByTimeAsync(31_000);
		expect(takeWindow("t2", {})).toBeNull();
	});
});
