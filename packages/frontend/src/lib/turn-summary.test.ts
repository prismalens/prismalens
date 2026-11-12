// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { type TurnStep, turnSummary } from "./turn-summary";

const steps: TurnStep[] = [
	{ node: "read", path: "repo/a.ts" },
	{ node: "command" },
	{ node: "command" },
	{ edit: { path: "repo/b.ts", add: 3, del: 1 } },
];

describe("turnSummary never repeats what another line says (#1101 cat 9)", () => {
	it("with two tool groups, counts reads and commands and leaves changed files to their own line", () => {
		const s = turnSummary(steps, [], { groups: 2 });
		expect(s?.text).toBe("Read 1 file, ran 2 commands.");
		expect(s?.files).toEqual([{ path: "repo/b.ts", add: 3, del: 1 }]);
		expect([s?.add, s?.del]).toEqual([3, 1]);
	});

	it("with one tool group, drops the group's own counts and keeps the files and PrismaLens actions outside it", () => {
		const s = turnSummary(steps, ["pl_thread_start"], { groups: 1 });
		expect(s?.text).toBe("PrismaLens: started 1 thread.");
		expect(s?.files).toEqual([{ path: "repo/b.ts", add: 3, del: 1 }]);
	});

	it("with one group that only read and ran, has no text and no files, so the turn shows no end line", () => {
		expect(
			turnSummary([{ node: "read", path: "repo/a.ts" }, { node: "command" }], [], {
				groups: 1,
			}),
		).toBeNull();
	});
});
