// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { projectSlug, runBranch } from "./run-worktree.js";

describe("a run's branch name (#1020)", () => {
	it("is prismalens/<project>-<run> on a project thread", () => {
		expect(runBranch("r1", { incidentId: null, project: "shop-monorepo" })).toBe(
			"prismalens/shop-monorepo-r1",
		);
	});

	it("keeps the incident's form on an incident run, and the bare run on any other", () => {
		expect(runBranch("r1", { incidentId: "i1", project: "shop" })).toBe(
			"prismalens/i1-r1",
		);
		expect(runBranch("r1", { incidentId: null })).toBe("prismalens/r1");
		expect(runBranch("r1", { incidentId: null, project: "///" })).toBe(
			"prismalens/r1",
		);
	});

	it("lets only [a-z0-9-] from a project's name into the ref", () => {
		expect(projectSlug("Org/Shop API..lock")).toBe("org-shop-api-lock");
		expect(projectSlug(" ~^:?*[\\ ")).toBe("");
		expect(projectSlug(`${"a".repeat(39)}-b`)).toBe("a".repeat(39));
		expect(projectSlug("x".repeat(60))).toHaveLength(40);
	});
});
