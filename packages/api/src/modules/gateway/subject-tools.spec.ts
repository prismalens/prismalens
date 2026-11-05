// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { type HarnessTool, runView } from "@prismalens/integrations/harness";
import { describe, expect, it } from "vitest";
import { GatewayService } from "./gateway.service.js";
import { INCIDENT_TOOLS, NO_SUBJECT_TOOLS, subjectTools } from "./subject-tools.js";

const tools = new GatewayService({} as never).tools;
const names = (list: readonly HarnessTool[]) => list.map((t) => t.name).sort();

describe("subjectTools (#1020): a thread is offered only what its subject can use", () => {
	it("gives a no-subject thread the title and publish tools only", () => {
		expect(names(subjectTools(tools, "none"))).toEqual([...NO_SUBJECT_TOOLS].sort());
	});

	it("drops every incident tool from a project or service thread, and keeps the rest", () => {
		for (const subject of ["project", "service"] as const) {
			const seen = names(subjectTools(tools, subject));
			expect(seen.filter((n) => INCIDENT_TOOLS.has(n))).toEqual([]);
			expect(seen).toContain("thread_title");
			expect(seen).toContain("service_get");
		}
	});

	it("keeps every tool for incident and schedule runs and an unknown subject", () => {
		for (const subject of ["incident", "schedule", undefined] as const)
			expect(subjectTools(tools, subject)).toEqual(tools);
	});

	it("names only tools the gateway serves, so a rename cannot silently widen a view", () => {
		const served = new Set(tools.map((t) => t.name));
		for (const n of [...INCIDENT_TOOLS, ...NO_SUBJECT_TOOLS]) expect(served.has(n)).toBe(true);
	});

	it("leaves a no-subject view with nothing deferred, so no search tool is offered", () => {
		const view = runView(subjectTools(tools, "none"), { search: true });
		expect(view.deferred).toEqual([]);
		expect(names(view.direct)).toEqual([...NO_SUBJECT_TOOLS].sort());
	});
});
