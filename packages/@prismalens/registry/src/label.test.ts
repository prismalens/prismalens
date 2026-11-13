// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { labelProblems } from "./label.ts";

const base = {
	protectedPaths: ["packages/@prismalens/registry/", "biome.json"],
	ratchet: "packages/frontend/registry.ratchet.tsv",
	baseTsv: "a.ts\tL3\t2\nb.ts\tas-never\t1\n",
	labels: [] as string[],
	label: "registry-approved",
};

describe("the operator's label check", () => {
	it("passes a PR that only lowers counts and touches no guard path", () => {
		expect(
			labelProblems({
				...base,
				changed: ["packages/frontend/registry.ratchet.tsv", "packages/frontend/src/x.tsx"],
				headTsv: "a.ts\tL3\t1\n",
			}),
		).toEqual([]);
	});

	it("names each guard path touched and each count raised", () => {
		expect(
			labelProblems({
				...base,
				changed: ["biome.json", "packages/@prismalens/registry/src/kind.ts", "packages/@prismalens/registry-other/x.ts"],
				headTsv: "a.ts\tL3\t3\nb.ts\tas-never\t1\nc.ts\tL5\t1\n",
			}),
		).toEqual([
			'biome.json is a registry guard path. Fix: undo it, or ask the operator to add the "registry-approved" label.',
			'packages/@prismalens/registry/src/kind.ts is a registry guard path. Fix: undo it, or ask the operator to add the "registry-approved" label.',
			'a.ts L3 rose from 2 to 3 in packages/frontend/registry.ratchet.tsv. Fix: undo it, or ask the operator to add the "registry-approved" label.',
			'c.ts L5 rose from 0 to 1 in packages/frontend/registry.ratchet.tsv. Fix: undo it, or ask the operator to add the "registry-approved" label.',
		]);
	});

	it("passes anything once the operator's label is on", () => {
		expect(
			labelProblems({ ...base, labels: ["registry-approved"], changed: ["biome.json"], headTsv: "z.ts\tL1\t9\n" }),
		).toEqual([]);
	});
});
