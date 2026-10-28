// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { runScope, runScopeKey } from "./run-scope.js";

describe("runScope (#979)", () => {
	it("scopes by incident when one is set, even if a schedule is too", () => {
		expect(runScope({ incidentId: "inc-1", scheduleId: "sch-1" })).toEqual({ incidentId: "inc-1" });
	});

	it("scopes an unlinked run by its schedule, never by incidentId null", () => {
		expect(runScope({ incidentId: null, scheduleId: "sch-1" })).toEqual({ scheduleId: "sch-1" });
	});

	it("refuses a run that has neither, instead of matching every unlinked run", () => {
		expect(() => runScope({ incidentId: null })).toThrow();
		expect(() => runScope({ incidentId: null, scheduleId: null })).toThrow();
	});

	it("keys two schedules apart and an incident by its id", () => {
		expect(runScopeKey({ incidentId: null, scheduleId: "a" })).not.toBe(runScopeKey({ incidentId: null, scheduleId: "b" }));
		expect(runScopeKey({ incidentId: "inc-1", scheduleId: "a" })).toBe("inc-1");
	});
});
