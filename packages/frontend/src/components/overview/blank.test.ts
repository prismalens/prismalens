// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { isBlankIncident } from "./blank";

describe("isBlankIncident (#1020)", () => {
	const none = { alerts: 0, runs: 0, changes: 0, deploy: false, entries: 0 };

	it("is blank with no alert, run or change", () => {
		expect(isBlankIncident(none)).toBe(true);
	});

	it("earns its cards once anything lands", () => {
		expect(isBlankIncident({ ...none, alerts: 1 })).toBe(false);
		expect(isBlankIncident({ ...none, runs: 1 })).toBe(false);
		expect(isBlankIncident({ ...none, changes: 2 })).toBe(false);
		expect(isBlankIncident({ ...none, deploy: true })).toBe(false);
		expect(isBlankIncident({ ...none, entries: 1 })).toBe(false);
	});
});
