// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	PrCheckRun,
	PrChecks,
	PrHostTerms,
	PrState,
} from "@prismalens/contracts";
import type { FakeRoute } from "../../__fixtures__/fake-host.js";
import type { CodeHostKind } from "../adapter.js";
import { githubContract } from "./github.contract.js";
import { gitlabContract } from "./gitlab.contract.js";

export interface ExpectedActivityItem {
	source: string;
	id: number;
	login: string;
}

export interface ExpectedReviewThread {
	id: string;
	resolved: boolean;
}

export interface ExpectedCheckLog {
	step: string | null;
	unavailable: string | null;
	lastLine: string;
}

export interface ExpectedRead {
	state: PrState;
	headSha: string | null;
	checks: PrChecks;
}

export interface ExpectedReply {
	readonly author: string;
	readonly excerpt: string;
	readonly url?: string;
	readonly noteId?: string;
	readonly activity?: { source: string; id: number };
}

export interface ExpectedThreadLast {
	readonly author: string;
	readonly excerpt: string;
	readonly url?: string;
}

export interface ExpectedVerdictActivity {
	readonly source: string;
	readonly id: number;
	readonly verdict?: "approved" | "changes_requested" | "commented";
}

export interface ContractFixture {
	readonly kind: CodeHostKind;
	readonly host: string;
	readonly apiBase: string;
	readonly repo: string;
	readonly number: number;
	readonly branch: string;
	readonly webUrl: string;
	readonly parsePath: { repoParts: string[]; number: string | undefined };
	readonly otherHostPathSegments: string[];
	readonly routes: () => Record<string, FakeRoute>;
	readonly read: ExpectedRead;
	readonly secondReadEtags: (string | undefined)[];
	readonly activity: ExpectedActivityItem[];
	readonly reviewThreads: ExpectedReviewThread[];
	readonly checkRun: PrCheckRun;
	readonly statusRun?: PrCheckRun;
	readonly checkLog: ExpectedCheckLog;
	readonly findByBranchUrl: string;
	readonly terms: PrHostTerms;
}

export interface ExtendedContractFixture extends ContractFixture {
	readonly replyThreadId: string;
	readonly replyBody: string;
	readonly expectedReply: ExpectedReply;
	readonly replyRoute: (
		threadId: string,
		body: string,
	) => Record<string, FakeRoute>;
	readonly replyFailureRoute: (
		status: number,
		message: string,
	) => Record<string, FakeRoute>;
	readonly headRef: string;
	readonly headSha: string;
	readonly headForcePushed: boolean;
	readonly headRoute: (ref: string, sha: string) => Record<string, FakeRoute>;
	readonly expectedViewer: string;
	readonly viewerRoute: (login: string) => Record<string, FakeRoute>;
	readonly checkLogUnauthorizedRoute: Record<string, FakeRoute>;
	readonly checkLogNotFoundRoute: Record<string, FakeRoute>;
	readonly openConflictRoutes: Record<string, FakeRoute>;
	readonly closedCleanRoutes: Record<string, FakeRoute>;
	readonly closedReviewStatus: string;
	readonly threadedReviewRoutes: Record<string, FakeRoute>;
	readonly expectedThreadLast: ExpectedThreadLast;
	readonly verdictActivityRoutes: Record<string, FakeRoute>;
	readonly expectedVerdictActivity: ExpectedVerdictActivity[];
}

const extendedGithub: ExtendedContractFixture = {
	...githubContract,
	replyThreadId: "gh-thread-1",
	replyBody: "Fixed in next commit",
	expectedReply: {
		author: "alice",
		excerpt: "Fixed in next commit",
		url: "https://github.com/cli/cli/pull/14927#discussion_r501",
		activity: { source: "review_comment", id: 501 },
	},
	replyRoute: (_threadId, body) => ({
		"/graphql": {
			body: {
				data: {
					addPullRequestReviewThreadReply: {
						comment: {
							databaseId: 501,
							author: { login: "alice" },
							body,
							url: "https://github.com/cli/cli/pull/14927#discussion_r501",
						},
					},
				},
			},
		},
	}),
	replyFailureRoute: (status, message) => ({
		"/graphql": {
			status,
			body: { message },
		},
	}),
	headRef: "feature-branch",
	headSha: "d43c4e3ad3c34332c803a568f85f116e3ee58f19",
	headForcePushed: true,
	headRoute: (ref, sha) => ({
		[`/repos/cli/cli/git/ref/heads/${encodeURIComponent(ref)}`]: {
			body: { object: { sha } },
		},
		"/repos/cli/cli/issues/14927/events?per_page=100": {
			body: [{ event: "head_ref_force_pushed" }],
		},
	}),
	expectedViewer: "alice",
	viewerRoute: (login) => ({
		"/user": {
			body: { login },
		},
	}),
	checkLogUnauthorizedRoute: {
		"/repos/cli/cli/actions/jobs/run-14927": {
			status: 401,
		},
	},
	checkLogNotFoundRoute: {
		"/repos/cli/cli/actions/jobs/run-14927": {
			body: {
				steps: [{ name: "Run test suite", conclusion: "failure" }],
			},
		},
	},
	openConflictRoutes: {
		"/repos/cli/cli/pulls/14927": {
			body: {
				title: "Open PR with conflicts",
				state: "open",
				draft: false,
				merged: false,
				mergeable: false,
				mergeable_state: "dirty",
				head: {
					sha: "d43c4e3ad3c34332c803a568f85f116e3ee58f19",
					ref: "feature",
				},
				base: { ref: "main" },
				requested_reviewers: [{ login: "carol" }],
			},
		},
		"/repos/cli/cli/pulls/14927/reviews?per_page=100": {
			body: [],
		},
		"/repos/cli/cli/commits/d43c4e3ad3c34332c803a568f85f116e3ee58f19/check-runs?per_page=100":
			{
				body: { check_runs: [] },
			},
		"/repos/cli/cli/commits/d43c4e3ad3c34332c803a568f85f116e3ee58f19/status": {
			body: { statuses: [] },
		},
	},
	closedCleanRoutes: {
		"/repos/cli/cli/pulls/14927": {
			body: {
				title: "Closed PR with clean merge",
				state: "closed",
				draft: false,
				merged: false,
				mergeable: true,
				mergeable_state: "clean",
				head: {
					sha: "d43c4e3ad3c34332c803a568f85f116e3ee58f19",
					ref: "feature",
				},
				base: { ref: "main" },
				requested_reviewers: [],
			},
		},
		"/repos/cli/cli/pulls/14927/reviews?per_page=100": {
			body: [
				{
					id: 1,
					user: { login: "eve", avatar_url: "https://avatars.example.com/eve" },
					state: "CHANGES_REQUESTED",
				},
			],
		},
		"/repos/cli/cli/commits/d43c4e3ad3c34332c803a568f85f116e3ee58f19/check-runs?per_page=100":
			{
				body: { check_runs: [] },
			},
		"/repos/cli/cli/commits/d43c4e3ad3c34332c803a568f85f116e3ee58f19/status": {
			body: { statuses: [] },
		},
	},
	closedReviewStatus: "changes_requested",
	threadedReviewRoutes: {
		"/graphql": {
			body: {
				data: {
					repository: {
						pullRequest: {
							reviewThreads: {
								nodes: [
									{
										id: "gh-thread-with-replies",
										isResolved: false,
										isOutdated: false,
										path: "src/worker.ts",
										line: 12,
										comments: {
											totalCount: 2,
											nodes: [
												{
													author: { login: "alice" },
													body: "Original note",
													url: "https://github.com/cli/cli/pull/14927#discussion_r10",
												},
											],
										},
										latest: {
											nodes: [
												{
													author: { login: "bob" },
													body: "Reply note",
													url: "https://github.com/cli/cli/pull/14927#discussion_r11",
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
	},
	expectedThreadLast: {
		author: "bob",
		excerpt: "Reply note",
		url: "https://github.com/cli/cli/pull/14927#discussion_r11",
	},
	verdictActivityRoutes: {
		"/repos/cli/cli/pulls/14927/reviews?per_page=100": {
			body: [
				{
					id: 10,
					user: { login: "alice" },
					state: "APPROVED",
					body: "Approved review",
				},
				{
					id: 11,
					user: { login: "bob" },
					state: "CHANGES_REQUESTED",
					body: "Needs changes",
				},
				{
					id: 12,
					user: { login: "carol" },
					state: "COMMENTED",
					body: "Just a comment",
				},
			],
		},
		"/repos/cli/cli/issues/14927/comments?per_page=100": { body: [] },
		"/repos/cli/cli/pulls/14927/comments?per_page=100": { body: [] },
	},
	expectedVerdictActivity: [
		{ source: "review", id: 10, verdict: "approved" },
		{ source: "review", id: 11, verdict: "changes_requested" },
		{ source: "review", id: 12, verdict: "commented" },
	],
};

const extendedGitlab: ExtendedContractFixture = {
	...gitlabContract,
	replyThreadId: "gl-disc-1",
	replyBody: "Fixed in next commit",
	expectedReply: {
		author: "dave",
		excerpt: "Fixed in next commit",
		noteId: "601",
		activity: { source: "note", id: 601 },
	},
	replyRoute: (threadId, body) => ({
		[`/api/v4/projects/gitlab-org%2Fcli/merge_requests/1500/discussions/${encodeURIComponent(threadId)}/notes`]:
			{
				body: {
					id: 601,
					author: { username: "dave" },
					body,
				},
			},
	}),
	replyFailureRoute: (status, message) => ({
		[`/api/v4/projects/gitlab-org%2Fcli/merge_requests/1500/discussions/gl-disc-1/notes`]:
			{
				status,
				body: { message },
			},
	}),
	headRef: "feature-branch",
	headSha: "0da2cfbfeb405f156867e066a4517d634cdf6875",
	headForcePushed: false,
	headRoute: (ref, sha) => ({
		[`/api/v4/projects/gitlab-org%2Fcli/repository/branches/${encodeURIComponent(ref)}`]:
			{
				body: { commit: { id: sha } },
			},
	}),
	expectedViewer: "dave",
	viewerRoute: (login) => ({
		"/api/v4/user": {
			body: { username: login },
		},
	}),
	checkLogUnauthorizedRoute: {
		"/api/v4/projects/gitlab-org%2Fcli/jobs/job-1500": {
			status: 401,
		},
	},
	checkLogNotFoundRoute: {
		"/api/v4/projects/gitlab-org%2Fcli/jobs/job-1500": {
			status: 404,
		},
	},
	openConflictRoutes: {
		"/api/v4/projects/gitlab-org%2Fcli/merge_requests/1500": {
			body: {
				title: "Open MR with conflicts",
				state: "opened",
				draft: false,
				has_conflicts: true,
				detailed_merge_status: "conflict",
				source_branch: "feature",
				target_branch: "main",
				head_pipeline: null,
				reviewers: [{ username: "carol" }],
			},
		},
		"/api/v4/projects/gitlab-org%2Fcli/merge_requests/1500/approvals": {
			body: {
				approved: false,
				approvals_left: 1,
				approved_by: [],
			},
		},
	},
	closedCleanRoutes: {
		"/api/v4/projects/gitlab-org%2Fcli/merge_requests/1500": {
			body: {
				title: "Closed MR with clean merge",
				state: "closed",
				draft: false,
				has_conflicts: false,
				detailed_merge_status: "mergeable",
				source_branch: "feature",
				target_branch: "main",
				head_pipeline: null,
				reviewers: [{ username: "eve" }],
			},
		},
		"/api/v4/projects/gitlab-org%2Fcli/merge_requests/1500/approvals": {
			body: {
				approved: true,
				approvals_left: 0,
				approved_by: [{ user: { username: "eve" } }],
			},
		},
	},
	closedReviewStatus: "approved",
	threadedReviewRoutes: {
		"/api/v4/projects/gitlab-org%2Fcli/merge_requests/1500/discussions?per_page=100":
			{
				body: [
					{
						id: "gl-disc-with-replies",
						notes: [
							{
								id: 801,
								resolvable: true,
								resolved: false,
								author: { username: "dave" },
								body: "Original discussion note",
								position: { new_path: "src/worker.go", new_line: 12 },
							},
							{
								id: 802,
								resolvable: false,
								author: { username: "eve" },
								body: "Discussion reply note",
							},
						],
					},
				],
			},
	},
	expectedThreadLast: {
		author: "eve",
		excerpt: "Discussion reply note",
	},
	verdictActivityRoutes: {
		"/api/v4/projects/gitlab-org%2Fcli/merge_requests/1500/notes?sort=asc&order_by=created_at&per_page=100":
			{
				body: [
					{
						id: 20,
						author: { username: "dave", bot: false },
						body: "Regular note",
						system: false,
					},
					{
						id: 21,
						author: { username: "system", bot: false },
						body: "Changed title",
						system: true,
					},
				],
			},
	},
	expectedVerdictActivity: [{ source: "note", id: 20 }],
};

export const CONTRACT_FIXTURES: Record<CodeHostKind, ExtendedContractFixture> =
	{
		github: extendedGithub,
		gitlab: extendedGitlab,
	};
