// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { PR_HOST_TERMS } from "@prismalens/contracts";
import { type FakeRoute, hostFixture } from "../../__fixtures__/fake-host.js";
import type { ContractFixture } from "./contract.js";

const GL = "/api/v4/projects/gitlab-org%2Fcli";

export const gitlabContract: ContractFixture = {
	kind: "gitlab",
	host: "gitlab.com",
	apiBase: "https://gitlab.com/api/v4",
	repo: "gitlab-org/cli",
	number: 1500,
	branch: "feature-branch",
	webUrl: "https://gitlab.com/gitlab-org/cli/-/merge_requests/1500",
	parsePath: { repoParts: ["gitlab-org", "cli"], number: "1500" },
	otherHostPathSegments: ["cli", "cli", "pull", "14927"],
	routes: (): Record<string, FakeRoute> => ({
		[`${GL}/merge_requests/1500`]: {
			body: hostFixture("gitlab-mr"),
			etag: 'W/"m1"',
		},
		[`${GL}/merge_requests/1500/approvals`]: {
			body: hostFixture("gitlab-approvals"),
		},
		[`${GL}/pipelines/1304361054/jobs?per_page=100`]: {
			body: hostFixture("gitlab-jobs"),
		},
		[`${GL}/merge_requests/1500/notes?sort=asc&order_by=created_at&per_page=100`]:
			{
				body: [
					{
						id: 301,
						author: { username: "dave", bot: false },
						body: "GitLab note on MR",
						system: false,
					},
				],
			},
		[`${GL}/merge_requests/1500/discussions?per_page=100`]: {
			body: [
				{
					id: "gl-disc-1",
					notes: [
						{
							id: 401,
							resolvable: true,
							resolved: true,
							body: "Resolved discussion note",
							author: { username: "dave" },
							position: { new_path: "src/main.go", new_line: 10 },
						},
					],
				},
				{
					id: "gl-disc-2",
					notes: [
						{
							id: 402,
							resolvable: true,
							resolved: false,
							body: "Open discussion note",
							author: { username: "eve" },
							position: { new_path: "src/lib.go", new_line: 25 },
						},
					],
				},
			],
		},
		[`${GL}/jobs/job-1500`]: {
			body: { stage: "test" },
		},
		[`${GL}/jobs/job-1500/trace`]: {
			body: "Pipeline failed: tests exited with code 1",
		},
		[`${GL}/merge_requests?per_page=5&source_branch=feature-branch`]: {
			body: [
				{ web_url: "https://gitlab.com/gitlab-org/cli/-/merge_requests/1500" },
			],
		},
	}),
	read: {
		state: "merged",
		headSha: "0da2cfbfeb405f156867e066a4517d634cdf6875",
		checks: { state: "passing", total: 14, failed: 0, pending: 0 },
	},
	secondReadEtags: ['W/"m1"', undefined, undefined],
	activity: [{ source: "note", id: 301, login: "dave" }],
	reviewThreads: [
		{ id: "gl-disc-1", resolved: true },
		{ id: "gl-disc-2", resolved: false },
	],
	checkRun: {
		id: "job-1500",
		appId: "gitlab",
		name: "test",
		state: "failing",
	},
	checkLog: {
		step: "test",
		unavailable: null,
		lastLine: '"Pipeline failed: tests exited with code 1"',
	},
	findByBranchUrl: "https://gitlab.com/gitlab-org/cli/-/merge_requests/1500",
	terms: PR_HOST_TERMS.gitlab,
};
