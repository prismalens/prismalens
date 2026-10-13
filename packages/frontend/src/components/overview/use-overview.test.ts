// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	type RunRef,
	reportedRun,
} from "@/components/incidents/record-context";

const run = (
	id: string,
	over: Partial<Pick<RunRef, "kind" | "hasReport" | "rootCause" | "status">>,
) =>
	({
		id,
		kind: "investigation",
		status: "completed",
		rootCause: null,
		...over,
	}) as RunRef;

describe("reportedRun: the finding that stands (#673 w7-7)", () => {
	const found = run("run-1", { hasReport: true, rootCause: "pool exhausted" });

	it("Given a later run that concluded with no cause, Then the earlier named cause stands", () => {
		const later = run("run-2", { hasReport: true });
		expect(reportedRun([later, found])?.id).toBe("run-1");
	});

	it("Given a later run that names a cause, Then it replaces the earlier one", () => {
		const later = run("run-2", { hasReport: true, rootCause: "bad deploy" });
		expect(reportedRun([later, found])?.id).toBe("run-2");
	});

	it("Given no run named a cause, Then the newest report stands", () => {
		const a = run("run-2", { hasReport: true });
		const b = run("run-1", { hasReport: true });
		expect(reportedRun([a, b])?.id).toBe("run-2");
	});

	it("Given a later Ask or a failed run, Then neither is the finding", () => {
		const ask = run("ask", { kind: "chat", hasReport: true, rootCause: "x" });
		const failed = run("run-3", { status: "failed", hasReport: false });
		expect(reportedRun([ask, failed, found])?.id).toBe("run-1");
	});
});
