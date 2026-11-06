// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	LinkTargetSchema,
	ResolveLinksSchema,
	RESOLVE_LINKS_MAX,
	ThreadContextSchema,
} from "./thread-context.js";

const base = {
	threadId: "t1",
	title: "Why is cart slow",
	machine: { hostName: "box", os: "linux", isHost: true },
	agent: { harness: "claude-code", model: null, effort: null },
	workspace: null,
	lineage: [],
	plan: [{ content: "Read logs", status: "in_progress" }],
	pullRequests: [],
};

describe("ThreadContextSchema (#1024)", () => {
	it.each([
		["project", { project: { id: "r", name: "acme/cart" }, scripts: [] }],
		[
			"incident",
			{
				incident: {
					id: "i",
					number: 4,
					title: "500s",
					severity: "high",
					status: "investigating",
					alertCount: 2,
					impact: null,
				},
				suspects: [{ id: "h", statement: "deploy", status: "supported" }],
				report: "running",
			},
		],
		[
			"service",
			{
				service: {
					id: "s",
					name: "cart",
					tier: "tier_1",
					owner: null,
					dependencies: [],
				},
			},
		],
		[
			"schedule",
			{
				schedule: {
					id: "c",
					name: "Daily",
					recurrence: null,
					nextRunAt: null,
					lastRuns: [],
				},
			},
		],
		["none", { helperPlace: "alerts" }],
	])("parses a %s thread", (kind, extra) => {
		expect(ThreadContextSchema.safeParse({ kind, ...base, ...extra }).success).toBe(
			true,
		);
	});

	it("refuses a kind's payload under another kind", () => {
		expect(
			ThreadContextSchema.safeParse({ kind: "service", ...base, helperPlace: null })
				.success,
		).toBe(false);
	});

	it("bounds the candidates a resolve takes", () => {
		const c = { kind: "path", text: "a.ts" };
		const id = "11111111-1111-4111-8111-111111111111";
		expect(
			ResolveLinksSchema.safeParse({ id, candidates: Array(RESOLVE_LINKS_MAX).fill(c) })
				.success,
		).toBe(true);
		expect(
			ResolveLinksSchema.safeParse({
				id,
				candidates: Array(RESOLVE_LINKS_MAX + 1).fill(c),
			}).success,
		).toBe(false);
	});

	it("types each link target", () => {
		expect(
			LinkTargetSchema.safeParse({ type: "file", repo: "cart", sha: "abc", path: "a.ts", line: 3 })
				.success,
		).toBe(true);
		expect(LinkTargetSchema.safeParse({ type: "url", href: "not a url" }).success).toBe(
			false,
		);
	});
});
