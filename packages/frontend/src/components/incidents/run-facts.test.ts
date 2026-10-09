// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import type { RunRef } from "./record-context";
import { newerRunOf } from "./run-facts";

const makeRun = (id: string, createdAt: string): RunRef =>
	({
		id,
		createdAt,
		incidentId: "inc-1",
		status: "completed",
		kind: "investigation",
	}) as unknown as RunRef;

describe("newerRunOf", () => {
	it("returns the newest when an older one is selected", () => {
		const newest = makeRun("run-2", "2026-10-09T14:00:00.000Z");
		const older = makeRun("run-1", "2026-10-09T12:00:00.000Z");
		const runs = [newest, older];

		expect(newerRunOf(runs, "run-1")).toBe(newest);
	});

	it("returns null when the newest is selected", () => {
		const newest = makeRun("run-2", "2026-10-09T14:00:00.000Z");
		const older = makeRun("run-1", "2026-10-09T12:00:00.000Z");
		const runs = [newest, older];

		expect(newerRunOf(runs, "run-2")).toBeNull();
	});

	it("returns null when the selected id is unknown", () => {
		const newest = makeRun("run-2", "2026-10-09T14:00:00.000Z");
		const older = makeRun("run-1", "2026-10-09T12:00:00.000Z");
		const runs = [newest, older];

		expect(newerRunOf(runs, "unknown-run")).toBeNull();
	});
});
