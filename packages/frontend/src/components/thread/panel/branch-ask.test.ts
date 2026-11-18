// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { branchAsk } from "./branch-ask";

describe("branchAsk (#1176)", () => {
	it("returns push command when pushable is true", () => {
		const text = branchAsk({ name: "prismalens/fix-query-a1b2c3", pushable: true });
		expect(text).toBe(
			"Create the branch `prismalens/fix-query-a1b2c3` at HEAD with `git switch -c prismalens/fix-query-a1b2c3`, commit anything uncommitted, then push it with `git push -u origin prismalens/fix-query-a1b2c3`.",
		);
	});

	it("returns stop message when pushable is false", () => {
		const text = branchAsk({ name: "prismalens/feat-sync-d4e5f6", pushable: false });
		expect(text).toBe(
			"Create the branch `prismalens/feat-sync-d4e5f6` at HEAD with `git switch -c prismalens/feat-sync-d4e5f6`, commit anything uncommitted, and stop: this worktree can't push to the project's remote.",
		);
	});

	it("formats branch name from thread title and id", () => {
		const title = "Fix the slow query";
		const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
		const branchName = `prismalens/${slug}-abc123`;
		expect(branchAsk({ name: branchName, pushable: true })).toContain(`\`${branchName}\``);
		expect(branchAsk({ name: branchName, pushable: false })).toContain(`\`${branchName}\``);
	});
});
