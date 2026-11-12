// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	branchPr,
	gitAction,
	type GitState,
	hostOfUrl,
} from "./git-action";

function makePr(
	overrides: Partial<GitState["pullRequests"][number]> = {},
): GitState["pullRequests"][number] {
	return {
		source: "branch",
		headRef: "feat/branch",
		state: "open",
		checks: { state: "passing", total: 1, failed: 0, pending: 0 },
		conflicts: false,
		mergeState: "clean",
		...overrides,
	};
}

function makeState(overrides: Partial<GitState> = {}): GitState {
	return {
		layout: "single",
		branch: "feat/branch",
		ahead: 0,
		changed: false,
		pullRequests: [],
		lookedUp: true,
		...overrides,
	};
}

describe("gitAction (#1101)", () => {
	it("returns null for no branch, folder, and unmapped layouts", () => {
		expect(gitAction(makeState({ branch: null }))).toBeNull();
		expect(gitAction(makeState({ layout: "folder" }))).toBeNull();
		expect(gitAction(makeState({ layout: "unmapped" }))).toBeNull();
	});

	it("returns viewPr for a merged and a closed branch PR", () => {
		expect(
			gitAction(
				makeState({
					pullRequests: [makePr({ state: "merged" })],
				}),
			),
		).toBe("viewPr");
		expect(
			gitAction(
				makeState({
					pullRequests: [makePr({ state: "closed" })],
				}),
			),
		).toBe("viewPr");
	});

	it("returns resolveConflicts for conflicts: true and for mergeState: 'conflicts'", () => {
		expect(
			gitAction(
				makeState({
					pullRequests: [makePr({ conflicts: true })],
				}),
			),
		).toBe("resolveConflicts");
		expect(
			gitAction(
				makeState({
					pullRequests: [
						makePr({ conflicts: false, mergeState: "conflicts" }),
					],
				}),
			),
		).toBe("resolveConflicts");
	});

	it("returns push when ahead > 0 with an open PR that has failing checks (push outranks fix)", () => {
		expect(
			gitAction(
				makeState({
					ahead: 2,
					pullRequests: [
						makePr({
							state: "open",
							checks: {
								state: "failing",
								total: 2,
								failed: 1,
								pending: 0,
							},
						}),
					],
				}),
			),
		).toBe("push");
	});

	it("returns fixChecks for an open PR with failing checks when not ahead", () => {
		expect(
			gitAction(
				makeState({
					ahead: 0,
					pullRequests: [
						makePr({
							state: "open",
							checks: {
								state: "failing",
								total: 1,
								failed: 1,
								pending: 0,
							},
						}),
					],
				}),
			),
		).toBe("fixChecks");
	});

	it("returns markReady for a draft with passing checks", () => {
		expect(
			gitAction(
				makeState({
					ahead: 0,
					pullRequests: [
						makePr({
							state: "draft",
							checks: {
								state: "passing",
								total: 1,
								failed: 0,
								pending: 0,
							},
						}),
					],
				}),
			),
		).toBe("markReady");
	});

	it("returns viewPr for an open passing PR", () => {
		expect(
			gitAction(
				makeState({
					ahead: 0,
					pullRequests: [
						makePr({
							state: "open",
							checks: {
								state: "passing",
								total: 1,
								failed: 0,
								pending: 0,
							},
						}),
					],
				}),
			),
		).toBe("viewPr");
	});

	it("returns null when a linked PR has no headRef", () => {
		expect(
			gitAction(
				makeState({
					pullRequests: [
						makePr({ source: "agent", headRef: undefined }),
					],
				}),
			),
		).toBeNull();
	});

	it("returns push when ahead > 0 with no PR", () => {
		expect(
			gitAction(
				makeState({
					ahead: 3,
					pullRequests: [],
				}),
			),
		).toBe("push");
	});

	it("returns null on in_place layout with ahead 0 and no PR", () => {
		expect(
			gitAction(
				makeState({
					layout: "in_place",
					ahead: 0,
					pullRequests: [],
				}),
			),
		).toBeNull();
	});

	it("returns push on single layout with no upstream and changes", () => {
		expect(
			gitAction(
				makeState({
					layout: "single",
					ahead: null,
					changed: true,
					pullRequests: [],
				}),
			),
		).toBe("push");
	});

	it("returns null on single layout with no upstream and no changes", () => {
		expect(
			gitAction(
				makeState({
					layout: "single",
					ahead: null,
					changed: false,
					pullRequests: [],
				}),
			),
		).toBeNull();
	});

	it("returns createPr on single layout with ahead 0 and lookedUp: true", () => {
		expect(
			gitAction(
				makeState({
					layout: "single",
					ahead: 0,
					lookedUp: true,
					pullRequests: [],
				}),
			),
		).toBe("createPr");
	});

	it("returns null on single layout with ahead 0 and lookedUp: false", () => {
		expect(
			gitAction(
				makeState({
					layout: "single",
					ahead: 0,
					lookedUp: false,
					pullRequests: [],
				}),
			),
		).toBeNull();
	});
});

describe("branchPr (#1101)", () => {
	it("picks source: 'branch', or the PR whose headRef equals the branch, and ignores another branch's PR", () => {
		const prBranch = { source: "branch" as const, headRef: "other" };
		expect(branchPr([prBranch], "feat/branch")).toBe(prBranch);

		const prHead = { source: "agent" as const, headRef: "feat/branch" };
		expect(branchPr([prHead], "feat/branch")).toBe(prHead);

		const prOther = { source: "agent" as const, headRef: "other" };
		expect(branchPr([prOther], "feat/branch")).toBeUndefined();
	});
});

describe("hostOfUrl (#1101)", () => {
	it("maps remote URLs to host kinds: github, gitlab, or other", () => {
		expect(hostOfUrl("https://github.com/a/b.git")).toBe("github");
		expect(hostOfUrl("git@gitlab.com:a/b.git")).toBe("gitlab");
		expect(hostOfUrl("https://gitlab.example.com/a/b")).toBe("gitlab");
		expect(hostOfUrl("https://bitbucket.org/a/b")).toBe("other");
		expect(hostOfUrl(undefined)).toBe("other");
	});
});
