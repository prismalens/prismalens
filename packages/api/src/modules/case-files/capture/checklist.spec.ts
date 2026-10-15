// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	CHECKLIST_VERSION,
	canonicalQuery,
	checklistArgv,
	hasForbiddenToken,
	logsArgv,
	logsCut,
} from "./checklist.js";

const target = { kubeContext: "kind-pl", cluster: "https://x", namespace: "shop" };

describe("checklist", () => {
	it("every argv is read-only and scoped to the target", () => {
		const all = [
			...checklistArgv(target),
			logsArgv(target, "checkout-7d9f", "app"),
		];
		expect(all.map((c) => c.purpose)).toEqual([
			"events",
			"deployments",
			"replicasets",
			"pods",
			"logs-previous",
		]);
		for (const { argv } of all) {
			expect(hasForbiddenToken(argv)).toBe(false);
			expect(argv).toContain("--context");
			expect(argv).toContain("--namespace");
		}
		expect(hasForbiddenToken(["get", "secrets"])).toBe(true);
	});

	it("refuses a non-Kubernetes name in logs argv", () => {
		expect(() => logsArgv(target, "--raw", "app")).toThrow();
	});

	it("puts the checklist version in the canonical query", () => {
		expect(canonicalQuery(target).checklistVersion).toBe(CHECKLIST_VERSION);
	});

	it("treats a log at the limit as cut", () => {
		expect(logsCut(1024 * 1024)).toBe(true);
		expect(logsCut(10)).toBe(false);
	});
});
