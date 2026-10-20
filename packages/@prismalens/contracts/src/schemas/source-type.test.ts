// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	BUILTIN_SOURCES,
	CONNECT_STEP_BUDGET,
	connectSteps,
	SOURCE_CATEGORIES,
	SOURCE_TYPES,
	sourceType,
	sourceTypeBySlug,
	UNSUPPORTED_SCM_VENDORS,
} from "./source-type.js";

const stepsIn = (category: string) =>
	Math.max(
		...SOURCE_TYPES.filter((t) => t.category === category).map(
			(t) => connectSteps(t).length,
		),
	);

describe("connect step counts (#848)", () => {
	it("holds each shipped category to its count", () => {
		expect({
			metrics: stepsIn("metrics"),
			logs: stepsIn("logs"),
			scm: stepsIn("scm"),
			knowledge: Math.max(
				...BUILTIN_SOURCES.filter((b) => b.category === "knowledge").map(
					(b) => connectSteps(b).length,
				),
			),
		}).toEqual({ metrics: 3, logs: 4, scm: 3, knowledge: 2 });
	});

	it("keeps every descriptor within its category's budget", () => {
		for (const t of SOURCE_TYPES)
			expect(connectSteps(t).length).toBeLessThanOrEqual(
				CONNECT_STEP_BUDGET[t.category],
			);
	});

	it("keeps runbooks to a toggle and a confirm", () => {
		for (const b of BUILTIN_SOURCES)
			expect(connectSteps(b).length).toBeLessThanOrEqual(
				CONNECT_STEP_BUDGET[b.category],
			);
		expect(connectSteps(BUILTIN_SOURCES[0]!)).toEqual(["toggle", "confirm"]);
	});

	it("starts with pick and ends with confirm, one form in between", () => {
		for (const t of SOURCE_TYPES) {
			const steps = connectSteps(t);
			expect(steps[0]).toBe("pick");
			expect(steps.at(-1)).toBe("confirm");
			expect(steps.filter((s) => s === "auth")).toHaveLength(1);
		}
	});
});

describe("source type descriptors", () => {
	it("names a known category, a unique slug and at least one required probe", () => {
		const slugs = new Set<string>();
		for (const t of SOURCE_TYPES) {
			expect(SOURCE_CATEGORIES).toContain(t.category);
			expect(slugs.has(`${t.category}/${t.slug}`)).toBe(false);
			slugs.add(`${t.category}/${t.slug}`);
			expect(t.probes.some((p) => p.need === "required")).toBe(true);
			expect(t.credentialKinds.length).toBeGreaterThan(0);
		}
	});

	it("probes read only", () => {
		for (const t of SOURCE_TYPES)
			for (const p of t.probes) expect(p.path).not.toMatch(/delete|silence|create/i);
	});

	it("lists the scopes GitLab and Bitbucket ask for, each with why", () => {
		const scopes = (id: string) => sourceType(id)?.scopes?.map((s) => s.key);
		expect(scopes("gitlab-token")).toEqual(["read_api", "read_repository"]);
		expect(scopes("bitbucket-token")).toEqual(["repository:read"]);
		for (const id of ["gitlab-token", "bitbucket-token"])
			for (const s of sourceType(id)?.scopes ?? [])
				expect(s.why.length).toBeGreaterThan(10);
	});

	it("names the git hosts it cannot read yet", () => {
		expect(UNSUPPORTED_SCM_VENDORS).toEqual(["Gitea", "Forgejo", "Azure DevOps"]);
	});

	it("resolves `pl connect <category> <vendor>`", () => {
		expect(sourceTypeBySlug("scm", "gitlab")?.id).toBe("gitlab-token");
		expect(sourceTypeBySlug("scm", "bitbucket")?.id).toBe("bitbucket-token");
		expect(sourceTypeBySlug("logs", "loki")?.id).toBe("loki");
		expect(sourceTypeBySlug("scm", "github")?.id).toBe("github-token");
		expect(sourceTypeBySlug("logs", "prometheus")).toBeUndefined();
	});
});
