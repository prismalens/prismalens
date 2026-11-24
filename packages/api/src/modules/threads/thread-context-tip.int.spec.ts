// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ThreadContextSchema } from "@prismalens/contracts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	newBranchName,
	ThreadContextService,
	worktreeTip,
} from "./thread-context.service.js";

vi.setConfig({ testTimeout: 5_000 }); // slowest test 816 ms; 3x, rounded up to the second, at least 5 s (#1154)

const RUN_A = "11111111-2222-3333-4444-555555555555";
const RUN_B = "66666666-7777-8888-9999-000000000000";

const tempBase = mkdtempSync(join(tmpdir(), "pl-tip-test-"));
const mainRepo = join(tempBase, "main-repo");
const linkedWorktree = join(tempBase, "linked-worktree");
const plainClone = join(tempBase, "plain-clone");

function git(dir: string, args: string[]): string {
	return execFileSync("git", args, {
		cwd: dir,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}

beforeAll(() => {
	execFileSync("git", ["init", "-b", "main", mainRepo]);
	git(mainRepo, ["config", "user.name", "Test"]);
	git(mainRepo, ["config", "user.email", "test@example.com"]);
	git(mainRepo, ["config", "commit.gpgsign", "false"]);
	writeFileSync(join(mainRepo, "README.md"), "# Main\n");
	git(mainRepo, ["add", "."]);
	git(mainRepo, ["commit", "-m", "Initial commit"]);

	// Configure remote for pushable checks
	git(mainRepo, ["remote", "add", "origin", "https://github.com/prismalens/prismalens.git"]);

	// Create linked worktree and detach it
	execFileSync("git", ["worktree", "add", "--detach", linkedWorktree, "HEAD"], {
		cwd: mainRepo,
	});

	// Create plain clone
	execFileSync("git", ["clone", mainRepo, plainClone]);
});

afterAll(() => {
	rmSync(tempBase, { recursive: true, force: true });
});

describe("worktreeTip and newBranchName (#1176 F2)", () => {
	it("probes tip and detached state accurately for detached worktree vs branch", async () => {
		const headCommit = git(mainRepo, ["rev-parse", "HEAD"]);

		// Linked worktree is detached
		const detachedProbe = await worktreeTip(linkedWorktree, false);
		expect(detachedProbe.tip).toBe(headCommit);
		expect(detachedProbe.detached).toBe(true);

		// Main repo is on branch "main"
		const branchProbe = await worktreeTip(mainRepo, false);
		expect(branchProbe.tip).toBe(headCommit);
		expect(branchProbe.detached).toBe(false);
	});

	it("computes pushable: true for own linked worktree with 1 matching push URL, false for clone", async () => {
		// Linked worktree inherits origin from mainRepo (gitDir is in mainRepo/.git/worktrees)
		const worktreePushable = await worktreeTip(linkedWorktree, true);
		expect(worktreePushable.pushable).toBe(true);

		// Clone has gitDir === join(plainClone, ".git"), so pushable is false
		const clonePushable = await worktreeTip(plainClone, true);
		expect(clonePushable.pushable).toBe(false);

		// When own is false, pushable is not populated
		const unowned = await worktreeTip(linkedWorktree, false);
		expect("pushable" in unowned).toBe(false);
	});

	it("reports the live branch of an own worktree that left detached HEAD, and none while detached", async () => {
		const made = join(tempBase, "made-branch-worktree");
		execFileSync("git", ["worktree", "add", "--detach", made, "HEAD"], {
			cwd: mainRepo,
		});
		expect((await worktreeTip(made, true)).branch).toBeUndefined();

		git(made, ["switch", "-c", "prismalens/made-here"]);
		const probe = await worktreeTip(made, true);
		expect(probe.branch).toBe("prismalens/made-here");
		expect(probe.detached).toBe(false);
		// Not an own layout: the recorded branch is the only one.
		expect("branch" in (await worktreeTip(made, false))).toBe(false);
	});

	it("generates newBranchName from title slug and run id prefix", async () => {
		const branch = await newBranchName(mainRepo, RUN_A, "Fix Shopping Cart Dropoff");
		expect(branch).toBe("prismalens/fix-shopping-cart-dropoff-111111");
	});

	it("falls back to thread slug when title is null or empty", async () => {
		const branchNull = await newBranchName(mainRepo, RUN_B, null);
		expect(branchNull).toBe("prismalens/thread-666666");

		const branchEmpty = await newBranchName(mainRepo, RUN_B, "   ");
		expect(branchEmpty).toBe("prismalens/thread-666666");
	});

	it("returns null when check-ref-format fails or directory does not exist", async () => {
		// When directory does not exist
		const branchNoGit = await newBranchName("/no/such/git/dir", RUN_A, "feature");
		expect(branchNoGit).toBeNull();
	});

	it("integrates tip, detached, pushable, and suggestedBranch into ThreadContext workspace", async () => {
		const headCommit = git(mainRepo, ["rev-parse", "HEAD"]);
		const prisma = {
			investigation: {
				findUnique: vi.fn(async () => ({
					id: RUN_A,
					title: "Payment timeout",
					status: "running",
					kind: "chat",
					harness: "claude-code",
					model: "opus",
					effort: "high",
					report: null,
					agentPlan: null,
					workspace: JSON.stringify({
						layout: "single",
						cwd: linkedWorktree,
						repos: [
							{
								name: "repo",
								dir: linkedWorktree,
								sourceKind: "url",
								url: "https://github.com/prismalens/prismalens.git",
								subPath: null,
								connectionId: null,
								head: headCommit,
								branch: "HEAD",
								services: [],
							},
						],
					}),
					incidentId: null,
					scheduleId: null,
					repositoryId: null,
					serviceId: null,
					helperPlace: null,
					incident: null,
					repository: null,
					service: null,
					usage: null,
				})),
				findMany: vi.fn(async () => []),
			},
			schedule: { findUnique: vi.fn(async () => null) },
			investigationEvent: {
				findFirst: vi.fn(async () => null),
				findMany: vi.fn(async () => []),
			},
		};
		const pullRequests = {
			stored: vi.fn(async () => []),
			ownPrIds: vi.fn(async () => []),
		};
		const workspaces = {
			listForRun: vi.fn(async () => [{ dir: linkedWorktree }]),
		};

		const svc = new ThreadContextService(prisma as never, pullRequests as never, workspaces as never);
		const rawCtx = await svc.context(RUN_A, true);
		const ctx = ThreadContextSchema.parse(rawCtx);

		expect(ctx.machine.isOwner).toBe(true);
		expect(ctx.machine.isHost).toBe(true);
		expect(ctx.workspace?.suggestedBranch).toBe("prismalens/payment-timeout-111111");
		expect(ctx.workspace?.repos[0].tip).toBe(headCommit);
		expect(ctx.workspace?.repos[0].detached).toBe(true);
		expect(ctx.workspace?.repos[0].pushable).toBe(true);
	});
});
