// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { prTone } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { sourceRequestFn } from "../integrations/source-request.js";
import { fakeHost, hostFixture } from "./__fixtures__/fake-host.js";
import {
	type EtagCache,
	HostReadError,
	LOG_UNAVAILABLE,
	logTail,
	readGithub,
	readGithubCheckLog,
	readGitlab,
	readGitlabJobLog,
	readReviewThreads,
} from "./pr-hosts.js";

const SHA = "d43c4e3ad3c34332c803a568f85f116e3ee58f19";
const GH = "/repos/cli/cli";
const GL = "/api/v4/projects/gitlab-org%2Fcli";

const req = (impl: typeof fetch, base = "https://api.github.com") =>
	sourceRequestFn(base, { ok: true, credential: { kind: "none" } }, {
		fetchImpl: impl,
		maxRedirects: 0,
		maxBytes: 1024 * 1024,
	});

function githubRoutes() {
	return {
		[`${GH}/pulls/14927`]: { body: hostFixture("github-pull"), etag: '"p1"' },
		[`${GH}/pulls/14927/reviews?per_page=100`]: {
			body: hostFixture("github-reviews"),
			etag: '"r1"',
		},
		[`${GH}/commits/${SHA}/check-runs?per_page=100`]: {
			body: hostFixture("github-check-runs"),
			etag: '"c1"',
		},
	};
}

describe("readGithub against a recorded pull (cli/cli#14927)", () => {
	it("reads a draft with one failed check of 26, its author, reviewer and check apps", async () => {
		const host = fakeHost(githubRoutes());
		const read = await readGithub(req(host.impl), "cli/cli", 14927, {});
		expect(read).toMatchObject({
			state: "draft",
			review: "none",
			conflicts: false,
			checks: { state: "failing", total: 26, failed: 1, pending: 0 },
		});
		expect(read.detail.author?.login).toBe("williammartin");
		expect(read.detail.author?.avatarUrl).toMatch(/^https:\/\//);
		expect(read.detail.reviewers).toEqual([
			expect.objectContaining({
				login: "copilot-pull-request-reviewer[bot]",
				state: "commented",
			}),
		]);
		const runs = read.detail.checkRuns ?? [];
		expect(runs).toHaveLength(26);
		expect(runs.filter((r) => r.state === "failing")).toHaveLength(1);
		expect(runs.filter((r) => r.state === "neutral")).toHaveLength(13);
		expect(runs[0]?.appName).toBeTruthy();
		expect(prTone(read)).toBe("draft");
	});

	it("puts headRef, baseRef and mergeState in detail for the recorded pull", async () => {
		const host = fakeHost(githubRoutes());
		const read = await readGithub(req(host.impl), "cli/cli", 14927, {});
		expect(read.headRef).toBe("williammartin-multiaccount-draft-08-evaluation");
		expect(read.baseRef).toBeNull();
		expect(read.detail.headRef).toBe("williammartin-multiaccount-draft-08-evaluation");
		expect(read.detail.baseRef).toBeUndefined();
		expect(read.detail.mergeState).toBe("unstable");
	});

	it.each([
		["dirty", "conflicts"],
		["behind", "behind"],
		["custom_unknown", "unknown"],
	] as const)(
		"puts headRef, baseRef and maps mergeable_state %s to %s in detail",
		async (mergeableState, expectedMergeState) => {
			const pull = hostFixture("github-pull") as Record<string, unknown>;
			const host = fakeHost({
				...githubRoutes(),
				[`${GH}/pulls/14927`]: {
					body: {
						...pull,
						head: { sha: SHA, ref: "feature-branch" },
						base: { ref: "main" },
						mergeable_state: mergeableState,
					},
				},
			});
			const read = await readGithub(req(host.impl), "cli/cli", 14927, {});
			expect(read.headRef).toBe("feature-branch");
			expect(read.baseRef).toBe("main");
			expect(read.detail.headRef).toBe("feature-branch");
			expect(read.detail.baseRef).toBe("main");
			expect(read.detail.mergeState).toBe(expectedMergeState);
		},
	);

	it("reuses each answer on a 304 when it sends the ETag it got", async () => {
		const host = fakeHost(githubRoutes());
		const cache: EtagCache = {};
		const first = await readGithub(req(host.impl), "cli/cli", 14927, cache);
		const again = await readGithub(req(host.impl), "cli/cli", 14927, cache);
		expect(again).toEqual(first);
		// Four reads each time: the pull, its reviews, check runs and the combined status (no ETag here).
		const second = host.calls.slice(4);
		expect(second.map((c) => c.headers["if-none-match"])).toEqual([
			'"p1"',
			'"r1"',
			'"c1"',
			undefined,
		]);
	});

	it("falls back to the combined status when a token may not read check runs", async () => {
		const host = fakeHost({
			...githubRoutes(),
			[`${GH}/commits/${SHA}/check-runs?per_page=100`]: { status: 403 },
			[`${GH}/commits/${SHA}/status`]: {
				body: {
					state: "failure",
					statuses: [
						{ state: "success", context: "lint" },
						{ state: "error", context: "ci", avatar_url: "https://img.example/ci.png" },
						{ state: "pending", context: "deploy" },
					],
				},
			},
		});
		const read = await readGithub(req(host.impl), "cli/cli", 14927, {});
		expect(read.checks).toEqual({ state: "failing", total: 3, failed: 1, pending: 1 });
		expect(read.detail.checkRuns?.[1]).toEqual({
			name: "ci",
			state: "failing",
			appAvatarUrl: "https://img.example/ci.png",
			headSha: SHA,
		});
	});

	describe("when one check source cannot be read", () => {
		const passingRuns = {
			body: {
				total_count: 1,
				check_runs: [{ name: "build", status: "completed", conclusion: "success" }],
			},
		};
		const read = async (status: object, runs: object = passingRuns) => {
			const host = fakeHost({
				...githubRoutes(),
				[`${GH}/commits/${SHA}/check-runs?per_page=100`]: runs,
				[`${GH}/commits/${SHA}/status`]: status,
			});
			return (await readGithub(req(host.impl), "cli/cli", 14927, {})).checks;
		};

		it.each([429, 502])(
			"reads unknown, not passing, when the status answers %i beside passing check runs",
			async (code) => {
				expect(await read({ status: code })).toMatchObject({
					state: "unknown",
					total: 1,
				});
			},
		);

		it("reads unknown when a refused source sits beside passing check runs", async () => {
			expect((await read({ status: 404 })).state).toBe("unknown");
		});

		it("reads unknown, not none, when check runs are refused and the status lists nothing", async () => {
			expect(
				await read({ body: { state: "pending", statuses: [] } }, { status: 403 }),
			).toEqual({ state: "unknown", total: 0, failed: 0, pending: 0 });
		});

		it("still reads a known failure as failing beside a source that failed", async () => {
			const runs = {
				body: {
					total_count: 1,
					check_runs: [{ name: "build", status: "completed", conclusion: "failure" }],
				},
			};
			expect((await read({ status: 502 }, runs)).state).toBe("failing");
		});

		it("reads passing when both sources answer and pass, and none when both list nothing", async () => {
			expect(
				(await read({ body: { state: "success", statuses: [{ state: "success", context: "ci" }] } }))
					.state,
			).toBe("passing");
			expect(
				await read(
					{ body: { state: "pending", statuses: [] } },
					{ body: { total_count: 0, check_runs: [] } },
				),
			).toEqual({ state: "none", total: 0, failed: 0, pending: 0 });
		});
	});

	it("keeps a failing commit status when check runs all pass", async () => {
		const host = fakeHost({
			...githubRoutes(),
			[`${GH}/commits/${SHA}/check-runs?per_page=100`]: {
				body: {
					total_count: 1,
					check_runs: [{ name: "build", status: "completed", conclusion: "success" }],
				},
			},
			[`${GH}/commits/${SHA}/status`]: {
				body: {
					state: "failure",
					statuses: [
						{ state: "failure", context: "deploy/preview" },
						{ state: "pending", context: "security" },
					],
				},
			},
		});
		const read = await readGithub(req(host.impl), "cli/cli", 14927, {});
		expect(read.checks).toEqual({ state: "failing", total: 3, failed: 1, pending: 1 });
		expect(read.detail.checkRuns?.map((r) => r.name)).toEqual([
			"build",
			"deploy/preview",
			"security",
		]);
	});

	it("reads merged, closed, conflicts, requested reviewers and a verdict a comment does not undo", async () => {
		const pull = hostFixture("github-pull") as Record<string, unknown>;
		const host = fakeHost({
			...githubRoutes(),
			[`${GH}/pulls/14927`]: {
				body: {
					...pull,
					draft: false,
					mergeable: false,
					requested_reviewers: [{ login: "cy", avatar_url: "http://insecure/x" }],
					requested_teams: [{ slug: "core" }],
				},
			},
			[`${GH}/pulls/14927/reviews?per_page=100`]: {
				body: [
					{ user: { login: "bo" }, state: "APPROVED" },
					{ user: { login: "bo" }, state: "COMMENTED" },
					{ user: { login: "di" }, state: "PENDING" },
				],
			},
		});
		const read = await readGithub(req(host.impl), "cli/cli", 14927, {});
		expect(read).toMatchObject({ state: "open", review: "approved", conflicts: true });
		expect(read.detail.reviewers).toEqual([
			{ login: "bo", state: "approved" },
			{ login: "cy", state: "requested" },
			{ login: "core", state: "requested" },
		]);
		const merged = fakeHost({
			...githubRoutes(),
			[`${GH}/pulls/14927`]: {
				body: { ...pull, merged_at: "2026-11-01T00:00:00Z", head: {} },
			},
		});
		const m = await readGithub(req(merged.impl), "cli/cli", 14927, {});
		expect(m.state).toBe("merged");
		expect(m.checks.state).toBe("unknown");
	});

	it("refuses an oversize answer and names no upstream text", async () => {
		const host = fakeHost({
			[`${GH}/pulls/1`]: { body: { title: "x".repeat(2 * 1024 * 1024) } },
		});
		await expect(readGithub(req(host.impl), "cli/cli", 1, {})).rejects.toThrow(
			/^the git host's answer was over 1 MB$/,
		);
	});

	it("names the status of a refusal", async () => {
		const host = fakeHost({ [`${GH}/pulls/1`]: { status: 404 } });
		await expect(readGithub(req(host.impl), "cli/cli", 1, {})).rejects.toThrow(
			"the git host answered 404",
		);
	});
});

describe("readGitlab against a recorded merge request (gitlab-org/cli!1500)", () => {
	const routes = () => ({
		[`${GL}/merge_requests/1500`]: { body: hostFixture("gitlab-mr"), etag: 'W/"m1"' },
		[`${GL}/merge_requests/1500/approvals`]: { body: hostFixture("gitlab-approvals") },
		[`${GL}/pipelines/1304361054/jobs?per_page=100`]: {
			body: hostFixture("gitlab-jobs"),
		},
	});
	const base = "https://gitlab.com/api/v4";

	it("reads merged and approved, its approvers, and the pipeline's 14 passing jobs", async () => {
		const host = fakeHost(routes());
		const read = await readGitlab(req(host.impl, base), "gitlab-org/cli", 1500, {});
		expect(read).toMatchObject({
			state: "merged",
			review: "approved",
			conflicts: false,
			checks: { state: "passing", total: 14, failed: 0, pending: 0 },
		});
		expect(read.detail.author?.login).toBe("phikai");
		expect(read.detail.reviewers?.map((r) => [r.login, r.state])).toEqual([
			["garyh", "approved"],
			["hacks4oats", "approved"],
		]);
		expect(prTone(read)).toBe("merged");
	});

	it("reads an open draft with conflicts, a failed job and no approvals endpoint", async () => {
		const mr = hostFixture("gitlab-mr") as Record<string, unknown>;
		const host = fakeHost({
			...routes(),
			[`${GL}/merge_requests/1500`]: {
				body: { ...mr, state: "opened", draft: true, has_conflicts: true },
			},
			[`${GL}/merge_requests/1500/approvals`]: { status: 403 },
			[`${GL}/pipelines/1304361054/jobs?per_page=100`]: {
				body: [
					{ name: "test", status: "failed" },
					{ name: "flaky", status: "failed", allow_failure: true },
					{ name: "deploy", status: "running" },
				],
			},
		});
		const read = await readGitlab(req(host.impl, base), "gitlab-org/cli", 1500, {});
		expect(read).toMatchObject({
			state: "draft",
			review: "unknown",
			conflicts: true,
			checks: { state: "failing", total: 3, failed: 1, pending: 1 },
		});
		expect(read.detail.reviewers?.every((r) => r.state === "requested")).toBe(true);
	});

	it.each([
		[
			"a blocking manual job",
			"manual",
			[
				{ name: "build", status: "success" },
				{ name: "deploy", status: "manual", allow_failure: false },
			],
			"pending",
		],
		[
			"a cancelled job",
			"canceled",
			[
				{ name: "build", status: "success" },
				{ name: "test", status: "canceled" },
			],
			"failing",
		],
		["a failed pipeline whose jobs read passed", "failed", [{ name: "build", status: "success" }], "failing"],
		["a running pipeline", "running", [{ name: "build", status: "success" }], "pending"],
	])("never reads %s as passing", async (_why, pipeline, jobs, state) => {
		const mr = hostFixture("gitlab-mr") as Record<string, unknown>;
		const host = fakeHost({
			...routes(),
			[`${GL}/merge_requests/1500`]: {
				body: {
					...mr,
					state: "opened",
					head_pipeline: { id: 1304361054, status: pipeline },
				},
			},
			[`${GL}/pipelines/1304361054/jobs?per_page=100`]: { body: jobs },
		});
		const read = await readGitlab(req(host.impl, base), "gitlab-org/cli", 1500, {});
		expect(read.checks.state).toBe(state);
		expect(prTone(read)).not.toBe("ready");
	});

	it("still reads a manual job that may fail as passing", async () => {
		const host = fakeHost({
			...routes(),
			[`${GL}/pipelines/1304361054/jobs?per_page=100`]: {
				body: [
					{ name: "build", status: "success" },
					{ name: "optional", status: "manual", allow_failure: true },
				],
			},
		});
		const read = await readGitlab(req(host.impl, base), "gitlab-org/cli", 1500, {});
		expect(read.checks.state).toBe("passing");
	});

	it("reads no checks when the MR has no pipeline", async () => {
		const mr = hostFixture("gitlab-mr") as Record<string, unknown>;
		const host = fakeHost({
			...routes(),
			[`${GL}/merge_requests/1500`]: {
				body: { ...mr, state: "closed", head_pipeline: null },
			},
		});
		const read = await readGitlab(req(host.impl, base), "gitlab-org/cli", 1500, {});
		expect(read.state).toBe("closed");
		expect(read.checks.state).toBe("none");
	});

	it.each([
		["mergeable", "clean"],
		["conflict", "conflicts"],
		["need_rebase", "behind"],
		["checking", "unknown"],
		["not_approved", "blocked"],
	] as const)(
		"maps detailed_merge_status %s to %s in detail.mergeState",
		async (status, expected) => {
			const mr = hostFixture("gitlab-mr") as Record<string, unknown>;
			const host = fakeHost({
				...routes(),
				[`${GL}/merge_requests/1500`]: {
					body: { ...mr, detailed_merge_status: status },
				},
				[`${GL}/merge_requests/1500/approvals`]: { status: 403 },
			});
			const read = await readGitlab(req(host.impl, base), "gitlab-org/cli", 1500, {});
			expect(read.detail.mergeState).toBe(expected);
		},
	);
});

describe("logTail", () => {
	it("strips runner timestamp prefix, ANSI colour codes and GitLab markers, and drops group and blank lines", () => {
		const raw = [
			"2026-11-12T05:38:04.123Z First line",
			"\u001b[31mRed text\u001b[0m",
			"section_start:1710000000:step_1\rSection heading",
			"##[group]Collapsible group",
			"",
			"##[endgroup]",
			"section_end:1710000000:step_1\rNormal line",
		].join("\n");
		expect(logTail(raw)).toEqual([
			"First line",
			"Red text",
			"Section heading",
			"Normal line",
		]);
	});

	it("ends 2 lines after the last ##[error] line", () => {
		const raw = [
			"line 1",
			"##[error]syntax error in code",
			"post error 1",
			"post error 2",
			"post error 3",
			"post error 4",
		].join("\n");
		expect(logTail(raw)).toEqual([
			"line 1",
			"##[error]syntax error in code",
			"post error 1",
			"post error 2",
		]);
	});

	it("keeps at most N lines", () => {
		const lines = Array.from({ length: 10 }, (_, i) => `log line ${i + 1}`);
		expect(logTail(lines.join("\n"), 3)).toEqual([
			"log line 8",
			"log line 9",
			"log line 10",
		]);
	});
});

describe("readReviewThreads", () => {
	it("GitHub: maps one resolved, one open and one outdated thread to PrReviewThread objects, falling back to originalLine and setting replies", async () => {
		const host = fakeHost({
			"/graphql": {
				body: {
					data: {
						repository: {
							pullRequest: {
								reviewThreads: {
									nodes: [
										{
											id: "thread-1",
											isResolved: true,
											isOutdated: false,
											path: "src/resolved.ts",
											line: 10,
											originalLine: 8,
											comments: {
												totalCount: 3,
												nodes: [
													{
														author: { login: "alice" },
														body: "Looks good now",
														url: "https://github.com/cli/cli/pull/14927#discussion_r1",
													},
												],
											},
										},
										{
											id: "thread-2",
											isResolved: false,
											isOutdated: false,
											path: "src/open.ts",
											line: null,
											originalLine: 25,
											comments: {
												totalCount: 1,
												nodes: [
													{
														author: { login: "bob" },
														body: "Please fix this error",
														url: "https://github.com/cli/cli/pull/14927#discussion_r2",
													},
												],
											},
										},
										{
											id: "thread-3",
											isResolved: false,
											isOutdated: true,
											path: "src/outdated.ts",
											line: 50,
											originalLine: 45,
											comments: {
												totalCount: 2,
												nodes: [
													{
														author: { login: "charlie" },
														body: "Old comment on changed line",
														url: "https://github.com/cli/cli/pull/14927#discussion_r3",
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
		});
		const threads = await readReviewThreads(req(host.impl), "github", "cli/cli", 14927);
		expect(threads).toEqual([
			{
				id: "thread-1",
				path: "src/resolved.ts",
				line: 10,
				author: "alice",
				resolved: true,
				outdated: false,
				excerpt: "Looks good now",
				replies: 2,
				url: "https://github.com/cli/cli/pull/14927#discussion_r1",
			},
			{
				id: "thread-2",
				path: "src/open.ts",
				line: 25,
				author: "bob",
				resolved: false,
				outdated: false,
				excerpt: "Please fix this error",
				replies: 0,
				url: "https://github.com/cli/cli/pull/14927#discussion_r2",
			},
			{
				id: "thread-3",
				path: "src/outdated.ts",
				line: 50,
				author: "charlie",
				resolved: false,
				outdated: true,
				excerpt: "Old comment on changed line",
				replies: 1,
				url: "https://github.com/cli/cli/pull/14927#discussion_r3",
			},
		]);
	});

	it("GitHub: throws HostReadError with status 401 on a 401 response", async () => {
		const host = fakeHost({
			"/graphql": { status: 401 },
		});
		await expect(
			readReviewThreads(req(host.impl), "github", "cli/cli", 14927),
		).rejects.toThrow(new HostReadError("the git host answered 401", 401));
	});

	it("GitHub: throws HostReadError when response has errors", async () => {
		const host = fakeHost({
			"/graphql": {
				body: {
					errors: [{ message: "Field 'reviewThreads' doesn't exist on type 'PullRequest'" }],
				},
			},
		});
		await expect(
			readReviewThreads(req(host.impl), "github", "cli/cli", 14927),
		).rejects.toThrow(new HostReadError("the git host refused the review-thread query"));
	});

	it("GitLab: skips non-resolvable discussions, marks a thread resolved only when every resolvable note is, and keeps the newest note as last", async () => {
		const host = fakeHost({
			"/api/v4/projects/gitlab-org%2Fcli/merge_requests/1500/discussions?per_page=100": {
				body: [
					{
						id: "disc-system",
						notes: [
							{
								id: 101,
								resolvable: false,
								body: "assigned to @user",
								position: { new_path: "src/foo.ts", new_line: 5 },
							},
						],
					},
					{
						id: "disc-mixed",
						notes: [
							{
								id: 201,
								resolvable: true,
								resolved: true,
								body: "Please rename this variable",
								author: { username: "reviewer1" },
								position: { new_path: "src/mixed.ts", new_line: 12 },
							},
							{
								id: 202,
								resolvable: true,
								resolved: false,
								body: "Still needs work",
								author: { username: "reviewer2" },
							},
						],
					},
					{
						id: "disc-resolved",
						notes: [
							{
								id: 301,
								resolvable: true,
								resolved: true,
								body: "Fix typo here",
								author: { username: "reviewer1" },
								position: { old_path: "src/old.ts", old_line: 40 },
							},
							{
								id: 302,
								resolvable: true,
								resolved: true,
								body: "Done",
								author: { username: "author1" },
							},
						],
					},
				],
			},
		});
		const threads = await readReviewThreads(
			req(host.impl, "https://gitlab.com/api/v4"),
			"gitlab",
			"gitlab-org/cli",
			1500,
		);
		expect(threads).toEqual([
			{
				id: "disc-mixed",
				path: "src/mixed.ts",
				line: 12,
				author: "reviewer1",
				resolved: false,
				outdated: false,
				excerpt: "Please rename this variable",
				replies: 1,
				// b4738bcb1 keeps the newest note, so the panel shows where the conversation ended.
				last: { author: "reviewer2", excerpt: "Still needs work" },
			},
			{
				id: "disc-resolved",
				path: "src/old.ts",
				line: 40,
				author: "reviewer1",
				resolved: true,
				outdated: false,
				excerpt: "Fix typo here",
				replies: 1,
				last: { author: "author1", excerpt: "Done" },
			},
		]);
	});
});

describe("readGithubCheckLog", () => {
	it("reads check run output text and annotations when job answers 404, setting step to output title", async () => {
		const host = fakeHost({
			"/repos/cli/cli/actions/jobs/run-1": { status: 404 },
			"/repos/cli/cli/check-runs/run-1": {
				body: {
					output: {
						title: "Typecheck and Build",
						text: "Running typecheck...\nBuild succeeded",
					},
				},
			},
			"/repos/cli/cli/check-runs/run-1/annotations": {
				body: [
					{
						path: "packages/api/index.ts",
						start_line: 42,
						message: "Property 'id' is missing",
					},
				],
			},
		});
		const locate = vi.fn();
		const download = vi.fn();
		const result = await readGithubCheckLog(
			req(host.impl),
			"cli/cli",
			"run-1",
			locate,
			download,
		);
		expect(result).toEqual({
			step: "Typecheck and Build",
			lines: [
				"Running typecheck...",
				"Build succeeded",
				"packages/api/index.ts:42 Property 'id' is missing",
			],
			unavailable: null,
		});
		expect(locate).not.toHaveBeenCalled();
		expect(download).not.toHaveBeenCalled();
	});

	it("returns unavailable noAccess when job answers 403", async () => {
		const host = fakeHost({
			"/repos/cli/cli/actions/jobs/run-1": { status: 403 },
		});
		const locate = vi.fn();
		const download = vi.fn();
		const result = await readGithubCheckLog(
			req(host.impl),
			"cli/cli",
			"run-1",
			locate,
			download,
		);
		expect(result).toEqual({
			step: null,
			lines: [],
			unavailable: LOG_UNAVAILABLE.noAccess,
		});
		expect(locate).not.toHaveBeenCalled();
		expect(download).not.toHaveBeenCalled();
	});

	it("returns unavailable gone with failed step name when locate answers 410", async () => {
		const host = fakeHost({
			"/repos/cli/cli/actions/jobs/run-1": {
				body: {
					steps: [
						{ name: "Set up Node", conclusion: "success" },
						{ name: "Run test suite", conclusion: "failure" },
					],
				},
			},
		});
		const locate = vi.fn(async () => ({ status: 410, location: null }));
		const download = vi.fn();
		const result = await readGithubCheckLog(
			req(host.impl),
			"cli/cli",
			"run-1",
			locate,
			download,
		);
		expect(result).toEqual({
			step: "Run test suite",
			lines: [],
			unavailable: LOG_UNAVAILABLE.gone,
		});
		expect(locate).toHaveBeenCalledWith("repos/cli/cli/actions/jobs/run-1/logs");
		expect(download).not.toHaveBeenCalled();
	});

	it("downloads body and parses log tail when locate answers 302 with a location", async () => {
		const host = fakeHost({
			"/repos/cli/cli/actions/jobs/run-1": {
				body: {
					steps: [
						{ name: "Build package", conclusion: "failure" },
					],
				},
			},
		});
		const locate = vi.fn(async () => ({
			status: 302,
			location: "https://pipelines.actions.githubusercontent.com/log.txt",
		}));
		const download = vi.fn(async () =>
			new Response(
				"Compiling source files\n##[error]Process exited with code 1\npost error 1\npost error 2",
				{ status: 200 },
			),
		);
		const result = await readGithubCheckLog(
			req(host.impl),
			"cli/cli",
			"run-1",
			locate,
			download,
		);
		expect(result).toEqual({
			step: "Build package",
			lines: [
				"Compiling source files",
				"##[error]Process exited with code 1",
				"post error 1",
				"post error 2",
			],
			unavailable: null,
		});
		expect(download).toHaveBeenCalledWith(
			"https://pipelines.actions.githubusercontent.com/log.txt",
		);
	});
});

describe("readGitlabJobLog", () => {
	it("sets step to job's stage and trace text to tail", async () => {
		const fetchImpl = (async (input: string | URL) => {
			const url = new URL(String(input));
			if (url.pathname.endsWith("/trace")) {
				return new Response("Starting test suite\n##[error]Failed test\nline 1\nline 2", {
					status: 200,
					headers: { "content-type": "text/plain" },
				});
			}
			return new Response(JSON.stringify({ stage: "test" }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}) as typeof fetch;
		const result = await readGitlabJobLog(
			req(fetchImpl, "https://gitlab.com/api/v4"),
			"gitlab-org/cli",
			"job-1",
		);
		expect(result).toEqual({
			step: "test",
			lines: [
				"Starting test suite",
				"##[error]Failed test",
				"line 1",
				"line 2",
			],
			unavailable: null,
		});
	});

	it("returns unavailable noAccess when trace answers 403", async () => {
		const host = fakeHost({
			"/api/v4/projects/gitlab-org%2Fcli/jobs/job-1": {
				body: { stage: "test" },
			},
			"/api/v4/projects/gitlab-org%2Fcli/jobs/job-1/trace": {
				status: 403,
			},
		});
		const result = await readGitlabJobLog(
			req(host.impl, "https://gitlab.com/api/v4"),
			"gitlab-org/cli",
			"job-1",
		);
		expect(result).toEqual({
			step: "test",
			lines: [],
			unavailable: LOG_UNAVAILABLE.noAccess,
		});
	});
});
