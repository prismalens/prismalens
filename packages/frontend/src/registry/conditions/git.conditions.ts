// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const gitConflict = define.condition({
	id: "git.conflict",
	group: "real-life",
	said: {
		date: "2026-11-11",
		quote: "What other such real life behaviours should we consider?",
		where:
			"operator asked at 15:36Z and accepted the organizer's list at 15:41Z (organizer session); also #1101, Simulated conditions",
	},
	appliesTo: { walks: ["find-pr-checks"], categories: ["15", "16"] },
	simulator: "git.fixture",
	profile: {
		state: "conflict",
	},
	stage: {
		run: "node scripts/fakes/conditions/git-fixture.mjs git.conflict --url {url}",
		live: "the project thread whose worktree has src/app.txt unmerged",
	},
	measure: [
		{ state: "a thread in a merge conflict says so and offers the next step" },
	],
	verdict: "both",
	ci: { debt: "climb" },
	status: "active",
});

export const gitForcePush = define.condition({
	id: "git.force-push",
	group: "real-life",
	said: {
		date: "2026-11-11",
		quote: "What other such real life behaviours should we consider?",
		where:
			"operator asked at 15:36Z and accepted the organizer's list at 15:41Z (organizer session); also #1101, Simulated conditions",
	},
	appliesTo: { walks: ["find-pr-checks"], categories: ["15", "16"] },
	simulator: "git.fixture",
	profile: {
		state: "force-push",
	},
	stage: {
		run: "node scripts/fakes/conditions/git-fixture.mjs git.force-push --url {url}",
		live: "the project thread whose pushed branch was rewritten elsewhere",
	},
	measure: [
		{
			state:
				"a force-pushed branch is shown as rewritten, with the diff and the checks re-read",
		},
	],
	verdict: "both",
	ci: { debt: "climb" },
	status: "active",
});

export const gitBranchDeleted = define.condition({
	id: "git.branch-deleted",
	group: "real-life",
	said: {
		date: "2026-11-11",
		quote: "What other such real life behaviours should we consider?",
		where:
			"operator asked at 15:36Z and accepted the organizer's list at 15:41Z (organizer session); also #1101, Simulated conditions",
	},
	appliesTo: { walks: ["find-pr-checks"], categories: ["15", "16"] },
	simulator: "git.fixture",
	profile: {
		state: "branch-deleted",
	},
	stage: {
		run: "node scripts/fakes/conditions/git-fixture.mjs git.branch-deleted --url {url}",
		live: "the project thread whose branch was deleted on the remote",
	},
	measure: [
		{ state: "a deleted branch is named and the thread stays readable" },
	],
	verdict: "both",
	ci: { debt: "climb" },
	status: "active",
});

export const gitWorktreeDisk = define.condition({
	id: "git.worktree-disk",
	group: "real-life",
	said: {
		date: "2026-11-11",
		quote: "What other such real life behaviours should we consider?",
		where:
			"operator asked at 15:36Z and accepted the organizer's list at 15:41Z (organizer session); also #1101, Simulated conditions",
	},
	appliesTo: { walks: ["agent-starts-thread"], categories: ["23"] },
	simulator: "api.low-disk",
	profile: {
		freeBytes: 20971520,
		worktreeAdd: "ENOSPC",
	},
	stage: {
		run: "node scripts/fakes/conditions/git-fixture.mjs git.worktree-disk --url {url}",
		live: "the project thread whose worktree could not be made: no space left",
	},
	measure: [
		{
			state:
				"a full disk during worktree creation is a plain notice, not a hung thread",
		},
	],
	verdict: "both",
	ci: { debt: "climb" },
	status: "active",
});
