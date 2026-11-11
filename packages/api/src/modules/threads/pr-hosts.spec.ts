// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { prTone } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { sourceRequestFn } from "../integrations/source-request.js";
import { fakeHost, hostFixture } from "./__fixtures__/fake-host.js";
import { type EtagCache, HostReadError, readGithub, readGitlab } from "./pr-hosts.js";

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
});
