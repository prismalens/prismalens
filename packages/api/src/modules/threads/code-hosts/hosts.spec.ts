// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import type { AuthenticatedRequestFn } from "@prismalens/integrations";
import { sourceRequestFn } from "../../integrations/source-request.js";
import { fakeHost } from "../__fixtures__/fake-host.js";
import { HostWriteError } from "./common.js";
import { github } from "./github.js";
import { gitlab } from "./gitlab.js";

const req = (impl: typeof fetch, base: string) =>
	sourceRequestFn(base, { ok: true, credential: { kind: "none" } }, {
		fetchImpl: impl,
		maxRedirects: 0,
		maxBytes: 1024 * 1024,
	});

describe("code-hosts github & gitlab", () => {
	describe("github", () => {
		const repo = "cli/cli";
		const sha = "0123456789abcdef0123456789abcdef01234567";

		it("pages check runs across 2 pages and counts 144", async () => {
			const page1Runs = Array.from({ length: 100 }, (_, i) => ({
				id: i + 1,
				name: `check-${i + 1}`,
				status: "completed",
				conclusion: "success",
				app: { id: 15368, slug: "github-actions", name: "GitHub Actions" },
				html_url: `https://github.com/cli/cli/actions/runs/1000/job/${i + 1}`,
			}));

			const page2Runs = Array.from({ length: 44 }, (_, i) => ({
				id: i + 101,
				name: `check-${i + 101}`,
				status: "completed",
				conclusion: i === 0 ? "failure" : "success",
				app: { id: 15368, slug: "github-actions", name: "GitHub Actions" },
				html_url: `https://github.com/cli/cli/actions/runs/1000/job/${i + 101}`,
			}));

			const host = fakeHost({
				[`/repos/${repo}/pulls/10`]: {
					body: {
						title: "Test PR",
						state: "open",
						head: { sha, ref: "feat", repo: { full_name: repo } },
						base: { ref: "main" },
					},
				},
				[`/repos/${repo}/pulls/10/reviews?per_page=100`]: {
					body: [],
				},
				[`/repos/${repo}/commits/${sha}/check-runs?per_page=100`]: {
					body: { total_count: 144, check_runs: page1Runs },
				},
				[`/repos/${repo}/commits/${sha}/check-runs?per_page=100&page=2`]: {
					body: { total_count: 144, check_runs: page2Runs },
				},
				[`/repos/${repo}/commits/${sha}/status`]: {
					body: { statuses: [] },
				},
			});

			const client = req(host.impl, "https://api.github.com");
			const read = await github.read(client, repo, 10, {});
			expect(read.checks.total).toBe(144);
			expect(read.checks.failed).toBe(1);
			expect(read.checks.state).toBe("failing");
		});

		it("maps group and cancelled properly", async () => {
			const checkRuns = [
				{
					id: 1,
					name: "actions-run",
					status: "completed",
					conclusion: "cancelled",
					app: { id: 15368, slug: "github-actions", name: "GitHub Actions" },
					html_url: "https://github.com/cli/cli/actions/runs/5555/job/1",
				},
				{
					id: 2,
					name: "other-app-run",
					status: "completed",
					conclusion: "failure",
					app: { id: 9999, slug: "sonar", name: "Sonar" },
					check_suite: { id: 7777 },
					html_url: "https://sonar.example.com/check/2",
				},
			];

			const host = fakeHost({
				[`/repos/${repo}/pulls/11`]: {
					body: {
						title: "Test PR",
						state: "open",
						head: { sha, ref: "feat", repo: { full_name: repo } },
						base: { ref: "main" },
					},
				},
				[`/repos/${repo}/pulls/11/reviews?per_page=100`]: {
					body: [],
				},
				[`/repos/${repo}/commits/${sha}/check-runs?per_page=100`]: {
					body: { total_count: 2, check_runs: checkRuns },
				},
				[`/repos/${repo}/commits/${sha}/status`]: { body: { statuses: [] } },
			});

			const client = req(host.impl, "https://api.github.com");
			const read = await github.read(client, repo, 11, {});
			const runs = read.detail.checkRuns ?? [];

			const run1 = runs.find((r) => r.id === "1");
			expect(run1?.cancelled).toBe(true);
			expect(run1?.state).toBe("failing");
			expect(run1?.group).toBe("5555");

			const run2 = runs.find((r) => r.id === "2");
			expect(run2?.cancelled).toBeUndefined();
			expect(run2?.group).toBe("7777");
		});

		it("sets rerunnable to false while a run in the same group is pending", async () => {
			const checkRuns = [
				{
					id: 1,
					name: "failed-job",
					status: "completed",
					conclusion: "failure",
					app: { id: 15368, slug: "github-actions", name: "GitHub Actions" },
					html_url: "https://github.com/cli/cli/actions/runs/8888/job/1",
				},
				{
					id: 2,
					name: "running-job",
					status: "in_progress",
					conclusion: null,
					app: { id: 15368, slug: "github-actions", name: "GitHub Actions" },
					html_url: "https://github.com/cli/cli/actions/runs/8888/job/2",
				},
			];

			const host = fakeHost({
				[`/repos/${repo}/pulls/12`]: {
					body: {
						title: "Test PR",
						state: "open",
						head: { sha, ref: "feat", repo: { full_name: repo } },
						base: { ref: "main" },
					},
				},
				[`/repos/${repo}/pulls/12/reviews?per_page=100`]: {
					body: [],
				},
				[`/repos/${repo}/commits/${sha}/check-runs?per_page=100`]: {
					body: { total_count: 2, check_runs: checkRuns },
				},
				[`/repos/${repo}/commits/${sha}/status`]: { body: { statuses: [] } },
			});

			const client = req(host.impl, "https://api.github.com");
			const read = await github.read(client, repo, 12, {});
			const runs = read.detail.checkRuns ?? [];

			const failedJob = runs.find((r) => r.id === "1");
			expect(failedJob?.rerunnable).toBe(false);
		});

		it("rerunCheck handles 201 ok and 403 scope failure", async () => {
			const hostSuccess = fakeHost({
				[`/repos/${repo}/actions/jobs/101/rerun`]: { status: 201, body: {} },
			});
			const clientSuccess = req(hostSuccess.impl, "https://api.github.com");
			await expect(
				github.rerunCheck!(clientSuccess, repo, {
					id: "101",
					name: "test",
					state: "failing",
				}),
			).resolves.toBeUndefined();

			const hostForbidden = fakeHost({
				[`/repos/${repo}/actions/jobs/102/rerun`]: {
					status: 403,
					body: { message: "Must have admin rights to Repository" },
				},
			});
			const clientForbidden = req(hostForbidden.impl, "https://api.github.com");
			try {
				await github.rerunCheck!(clientForbidden, repo, {
					id: "102",
					name: "test",
					state: "failing",
				});
				expect.unreachable("expected rerunCheck to throw on 403");
			} catch (err) {
				expect(err).toBeInstanceOf(HostWriteError);
				expect((err as HostWriteError).failure).toBe("scope");
			}
		});

		it("reads files with paging across pages", async () => {
			const page1 = Array.from({ length: 100 }, (_, i) => ({
				filename: `file-${i + 1}.ts`,
				status: "modified",
				additions: 1,
				deletions: 1,
				patch: "+a\n-b",
			}));
			const page2 = [
				{
					filename: "file-101.ts",
					status: "added",
					additions: 5,
					deletions: 0,
					patch: "+test",
				},
			];

			const host = fakeHost({
				[`/repos/${repo}/pulls/15/files?per_page=100&page=1`]: { body: page1 },
				[`/repos/${repo}/pulls/15/files?per_page=100&page=2`]: { body: page2 },
			});
			const client = req(host.impl, "https://api.github.com");
			const res = await github.readFiles!(client, repo, 15);
			expect(res.files.length).toBe(101);
			expect(res.truncated).toBe(false);
			expect(res.files[100]?.path).toBe("file-101.ts");
			expect(res.files[100]?.status).toBe("added");
		});
	});

	describe("gitlab", () => {
		const project = "org/repo";
		const encodedProject = encodeURIComponent(project);
		const sha = "fedcba9876543210fedcba9876543210fedcba98";

		it("returns different headRepo when source_project_id != target_project_id", async () => {
			const host = fakeHost({
				[`/api/v4/projects/${encodedProject}/merge_requests/5`]: {
					body: {
						title: "MR Fork",
						state: "opened",
						sha,
						source_branch: "fork-branch",
						target_branch: "main",
						source_project_id: 1234,
						target_project_id: 5678,
						pipeline: null,
					},
				},
				[`/api/v4/projects/${encodedProject}/merge_requests/5/approvals`]: {
					body: { approved: false, approvals_left: 0, approved_by: [] },
				},
			});
			const client = req(host.impl, "https://gitlab.com/api/v4");
			const read = await gitlab.read(client, project, 5, {});
			expect(read.headRepo).toBe("project-id:1234");

			const hostSame = fakeHost({
				[`/api/v4/projects/${encodedProject}/merge_requests/6`]: {
					body: {
						title: "MR Same",
						state: "opened",
						sha,
						source_branch: "local-branch",
						target_branch: "main",
						source_project_id: 5678,
						target_project_id: 5678,
						pipeline: null,
					},
				},
				[`/api/v4/projects/${encodedProject}/merge_requests/6/approvals`]: {
					body: { approved: false, approvals_left: 0, approved_by: [] },
				},
			});
			const clientSame = req(hostSame.impl, "https://gitlab.com/api/v4");
			const readSame = await gitlab.read(clientSame, project, 6, {});
			expect(readSame.headRepo).toBe(project);
		});

		it("gives a manual job no pipeline group so a failed job stays rerunnable", async () => {
			const jobs = [
				{
					id: 10,
					name: "failed-unit-test",
					status: "failed",
					allow_failure: false,
					web_url: "https://gitlab.example.com/job/10",
				},
				{
					id: 20,
					name: "deploy-manual",
					status: "manual",
					allow_failure: false,
					web_url: "https://gitlab.example.com/job/20",
				},
			];

			const host = fakeHost({
				[`/api/v4/projects/${encodedProject}/merge_requests/7`]: {
					body: {
						title: "MR Manual",
						state: "opened",
						sha,
						source_branch: "feat",
						target_branch: "main",
						source_project_id: 100,
						target_project_id: 100,
						head_pipeline: { id: 999, status: "manual" },
					},
				},
				[`/api/v4/projects/${encodedProject}/merge_requests/7/approvals`]: {
					body: { approved: false, approvals_left: 0, approved_by: [] },
				},
				[`/api/v4/projects/${encodedProject}/pipelines/999/jobs?per_page=100`]: {
					body: jobs,
				},
			});

			const client = req(host.impl, "https://gitlab.com/api/v4");
			const read = await gitlab.read(client, project, 7, {});
			const checkRuns = read.detail.checkRuns ?? [];

			const failedJob = checkRuns.find((r) => r.id === "10");
			const manualJob = checkRuns.find((r) => r.id === "20");

			expect(manualJob?.group).toBeUndefined();
			expect(failedJob?.group).toBe("999");
			// Since manualJob has no group, it does not mark group 999 as waiting, so failedJob stays rerunnable!
			expect(failedJob?.rerunnable).toBe(true);
		});

		it("pages jobs across 2 pages and counts 144", async () => {
			const page1 = Array.from({ length: 100 }, (_, i) => ({
				id: i + 1,
				name: `job-${i + 1}`,
				status: "success",
				allow_failure: false,
			}));
			const page2 = Array.from({ length: 44 }, (_, i) => ({
				id: i + 101,
				name: `job-${i + 101}`,
				status: i === 0 ? "failed" : "success",
				allow_failure: false,
			}));

			const host = fakeHost({
				[`/api/v4/projects/${encodedProject}/merge_requests/8`]: {
					body: {
						title: "MR Paging",
						state: "opened",
						sha,
						source_branch: "feat",
						target_branch: "main",
						source_project_id: 100,
						target_project_id: 100,
						head_pipeline: { id: 500, status: "failed" },
					},
				},
				[`/api/v4/projects/${encodedProject}/merge_requests/8/approvals`]: {
					body: { approved: false, approvals_left: 0, approved_by: [] },
				},
				[`/api/v4/projects/${encodedProject}/pipelines/500/jobs?per_page=100`]: {
					body: page1,
				},
				[`/api/v4/projects/${encodedProject}/pipelines/500/jobs?per_page=100&page=2`]: {
					body: page2,
				},
			});

			const client = req(host.impl, "https://gitlab.com/api/v4");
			const read = await gitlab.read(client, project, 8, {});
			expect(read.checks.total).toBe(144);
			expect(read.checks.failed).toBe(1);
			expect(read.checks.state).toBe("failing");
		});

		it("rerunCheck handles 201 ok and 403 failure", async () => {
			const hostSuccess = fakeHost({
				[`/api/v4/projects/${encodedProject}/jobs/201/retry`]: { status: 201, body: {} },
			});
			const clientSuccess = req(hostSuccess.impl, "https://gitlab.com/api/v4");
			await expect(
				gitlab.rerunCheck!(clientSuccess, project, {
					id: "201",
					name: "test",
					state: "failing",
				}),
			).resolves.toBeUndefined();

			const hostForbidden = fakeHost({
				[`/api/v4/projects/${encodedProject}/jobs/202/retry`]: {
					status: 403,
					body: { message: "403 Forbidden" },
				},
			});
			const clientForbidden = req(hostForbidden.impl, "https://gitlab.com/api/v4");
			try {
				await gitlab.rerunCheck!(clientForbidden, project, {
					id: "202",
					name: "test",
					state: "failing",
				});
				expect.unreachable("expected rerunCheck to throw on 403");
			} catch (err) {
				expect(err).toBeInstanceOf(HostWriteError);
				expect((err as HostWriteError).failure).toBe("scope");
			}
		});

		it("reads files and handles pagination and fallback", async () => {
			const diffsPage1 = Array.from({ length: 100 }, (_, i) => ({
				new_path: `file-${i + 1}.ts`,
				old_path: `file-${i + 1}.ts`,
				diff: "+1\n-1",
				new_file: false,
				deleted_file: false,
			}));
			const diffsPage2 = [
				{
					new_path: "file-101.ts",
					old_path: "file-101.ts",
					diff: "+new line",
					new_file: true,
					deleted_file: false,
				},
			];

			const host = fakeHost({
				[`/api/v4/projects/${encodedProject}/merge_requests/9/diffs?per_page=100&page=1`]: {
					body: diffsPage1,
				},
				[`/api/v4/projects/${encodedProject}/merge_requests/9/diffs?per_page=100&page=2`]: {
					body: diffsPage2,
				},
			});

			const client = req(host.impl, "https://gitlab.com/api/v4");
			const res = await gitlab.readFiles!(client, project, 9);
			expect(res.files.length).toBe(101);
			expect(res.truncated).toBe(false);
			expect(res.files[100]?.status).toBe("added");
		});
	});
});
