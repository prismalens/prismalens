// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { PR_HOST_TERMS } from "@prismalens/contracts";
import { type FakeRoute, hostFixture } from "../../__fixtures__/fake-host.js";
import type { ContractFixture } from "./contract.js";

const SHA = "d43c4e3ad3c34332c803a568f85f116e3ee58f19";
const GH = "/repos/cli/cli";

export const githubContract: ContractFixture = {
	kind: "github",
	host: "github.com",
	apiBase: "https://api.github.com",
	repo: "cli/cli",
	number: 14927,
	branch: "feature-branch",
	webUrl: "https://github.com/cli/cli/pull/14927",
	parsePath: { repoParts: ["cli", "cli"], number: "14927" },
	otherHostPathSegments: ["gitlab-org", "cli", "-", "merge_requests", "1500"],
	routes: (): Record<string, FakeRoute> => ({
		[`${GH}/pulls/14927`]: {
			body: hostFixture("github-pull"),
			etag: '"p1"',
		},
		[`${GH}/pulls/14927/reviews?per_page=100`]: {
			body: hostFixture("github-reviews"),
			etag: '"r1"',
		},
		[`${GH}/commits/${SHA}/check-runs?per_page=100`]: {
			body: hostFixture("github-check-runs"),
			etag: '"c1"',
		},
		[`${GH}/commits/${SHA}/status`]: {
			body: hostFixture("github-status"),
		},
		[`${GH}/issues/14927/comments?per_page=100`]: {
			body: [
				{
					id: 101,
					user: { login: "alice", type: "User" },
					body: "Initial issue comment",
				},
			],
		},
		[`${GH}/pulls/14927/comments?per_page=100`]: {
			body: [
				{
					id: 201,
					user: { login: "bob", type: "User" },
					body: "Review comment on pull",
				},
			],
		},
		"/graphql": {
			body: {
				data: {
					repository: {
						pullRequest: {
							reviewThreads: {
								nodes: [
									{
										id: "gh-thread-1",
										isResolved: true,
										isOutdated: false,
										path: "src/cli.ts",
										line: 15,
										comments: {
											totalCount: 2,
											nodes: [
												{
													author: { login: "alice" },
													body: "Resolved comment",
													url: "https://github.com/cli/cli/pull/14927#discussion_r1",
												},
											],
										},
									},
									{
										id: "gh-thread-2",
										isResolved: false,
										isOutdated: false,
										path: "src/utils.ts",
										line: 30,
										comments: {
											totalCount: 1,
											nodes: [
												{
													author: { login: "bob" },
													body: "Open issue comment",
													url: "https://github.com/cli/cli/pull/14927#discussion_r2",
												},
											],
										},
									},
								],
							},
						},
					},
				},
			},
		},
		[`${GH}/actions/jobs/run-14927`]: {
			body: {
				steps: [
					{ name: "Set up Node", conclusion: "success" },
					{ name: "Run test suite", conclusion: "failure" },
				],
			},
		},
		[`${GH}/pulls?state=all&per_page=5&head=cli%3Afeature-branch`]: {
			body: [{ html_url: "https://github.com/cli/cli/pull/14927" }],
		},
	}),
	read: {
		state: "draft",
		headSha: "d43c4e3ad3c34332c803a568f85f116e3ee58f19",
		checks: { state: "failing", total: 26, failed: 1, pending: 0 },
	},
	secondReadEtags: ['"p1"', '"r1"', '"c1"', undefined],
	activity: [
		{ source: "issue_comment", id: 101, login: "alice" },
		{ source: "review_comment", id: 201, login: "bob" },
	],
	reviewThreads: [
		{ id: "gh-thread-1", resolved: true },
		{ id: "gh-thread-2", resolved: false },
	],
	checkRun: {
		id: "run-14927",
		appId: "1",
		name: "test",
		state: "failing",
	},
	statusRun: {
		id: "status-14927",
		name: "status-check",
		state: "failing",
	},
	checkLog: {
		step: "Run test suite",
		unavailable: null,
		lastLine: "post error 2",
	},
	findByBranchUrl: "https://github.com/cli/cli/pull/14927",
	terms: PR_HOST_TERMS.github,
};
