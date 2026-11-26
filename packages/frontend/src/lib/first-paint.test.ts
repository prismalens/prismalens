// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { beforeEach, describe, expect, it, vi } from "vitest";

const ID = "6d3af3a6-04c7-4c05-a689-9fc400329c9d";

// The hold is module state: each test lands afresh.
let fp: typeof import("./first-paint");
beforeEach(async () => {
	vi.resetModules();
	fp = await import("./first-paint");
});

describe("a thread landing's first paint (#1193)", () => {
	it("starts the window's earlier page at once, not behind the calls held for the first paint", () => {
		fp.holdForFirstPaint(`/threads/${ID}`);
		const run = vi.fn(async () => "page");

		void fp.afterFirstPaint(
			`/api/investigations/${ID}/window/page?gen=0&before=run%3A51&fold=true`,
			run,
		);

		expect(run).toHaveBeenCalledTimes(1);
	});

	it("still holds a call the transcript does not draw", () => {
		fp.holdForFirstPaint(`/threads/${ID}`);
		const run = vi.fn(async () => "about");

		void fp.afterFirstPaint("/api/settings/about", run);

		expect(run).toHaveBeenCalledTimes(0);
	});
});
