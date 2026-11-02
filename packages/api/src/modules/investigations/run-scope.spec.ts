// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	runScope,
	runScopeKey,
	sharesAdmission,
	threadSubject,
} from "./run-scope.js";

describe("a thread's subject is apart from its admission lock (#1020)", () => {
	const incident = { id: "r1", incidentId: "i1", scheduleId: "s1" };
	const schedule = { id: "r2", incidentId: null, scheduleId: "s1", serviceId: "svc" };
	const project = { id: "r3", incidentId: null, repositoryId: "repo" };
	const service = { id: "r4", incidentId: null, serviceId: "svc" };
	const none = { id: "r5", incidentId: null };

	it("names the subject from the ids, the incident first", () => {
		expect(threadSubject(incident)).toBe("incident");
		expect(threadSubject(schedule)).toBe("schedule");
		expect(threadSubject(project)).toBe("project");
		expect(threadSubject(service)).toBe("service");
		expect(threadSubject(none)).toBe("none");
	});

	it("keeps one live run per incident or schedule; every other thread is its own unit", () => {
		expect(sharesAdmission(incident)).toBe(true);
		expect(sharesAdmission(schedule)).toBe(true);
		expect(sharesAdmission(project)).toBe(false);
		expect(sharesAdmission(service)).toBe(false);
		expect(sharesAdmission(none)).toBe(false);
		expect(runScope(incident)).toEqual({ incidentId: "i1" });
		expect(runScope(schedule)).toEqual({ scheduleId: "s1" });
		expect(runScope(project)).toEqual({ id: "r3" });
		expect(runScope(none)).toEqual({ id: "r5" });
	});

	it("never scopes an unlinked run by a null incident", () => {
		expect(() => runScope({ incidentId: null })).toThrow(/own id/);
	});

	it("gives two project threads on one project two keys", () => {
		expect(runScopeKey(incident)).toBe("i1");
		expect(runScopeKey(schedule)).toBe("schedule:s1");
		expect(runScopeKey(project)).toBe("run:r3");
		expect(runScopeKey({ ...project, id: "r9" })).toBe("run:r9");
		expect(runScopeKey({ incidentId: null })).toBe("run:");
	});
});
