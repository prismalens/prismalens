// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts/schemas";
import { describe, expect, it } from "vitest";
import { checkRow, type RowObservation } from "./acp-scenarios.js";

const cancelled = {
	kind: "error",
	message: "investigation cancelled",
} as unknown as CanonicalEvent;

const seen = (orphan: boolean): RowObservation => ({
	events: [cancelled],
	elapsedMs: 5000,
	agentSpoke: true,
	files: {},
	neverRan: false,
	orphan,
});

describe("checkRow cancelled-orphaned (#914)", () => {
	it("passes while the cancelled tool's process outlives the run", () => {
		expect(checkRow("deepagents", "cancelled-orphaned", seen(true))).toBeNull();
	});

	it("fails once the agent stops the process, so the fix is noticed", () => {
		expect(checkRow("deepagents", "cancelled-orphaned", seen(false))).toMatch(
			/known failure is fixed/,
		);
	});

	it("leaves `cancelled` failing on an orphan", () => {
		expect(checkRow("deepagents", "cancelled", seen(true))).toMatch(
			/outlived the run/,
		);
	});
});
