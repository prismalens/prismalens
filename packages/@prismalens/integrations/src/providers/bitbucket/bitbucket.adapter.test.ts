// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterEach, describe, expect, it } from "vitest";
import { type FakeApi, startFakeApi } from "../fake-http.js";
import { BitbucketVcsSegment } from "./bitbucket.adapter.js";
import * as fx from "./bitbucket.fixtures.js";

let api: FakeApi;
afterEach(() => api.close());

async function serve() {
	api = await startFakeApi((url) => {
		const p = url.pathname;
		const repos = fx.repos(api.origin);
		if (p === "/2.0/user") return { body: fx.user };
		if (p === "/2.0/workspaces") return { body: fx.workspaces };
		if (p === "/2.0/repositories")
			return {
				body: url.searchParams.get("page") === "2" ? repos.page2 : repos.page1,
			};
		if (p === "/2.0/repositories/acme/api") return { body: repos.page1.values[0] };
		if (p === "/2.0/repositories/acme/api/commits")
			return { body: { values: fx.commitsNewestFirst } };
		if (p === "/2.0/repositories/acme/merged/commits")
			return { body: { values: fx.commitsWithMerge } };
		if (p === "/2.0/repositories/acme/api/commit/c3")
			return { body: fx.commitsNewestFirst[0] };
		if (p === "/2.0/repositories/acme/api/diffstat/c3")
			return { body: fx.diffstat };
		if (p === "/2.0/repositories/acme/api/src/main/docs/runbook.md")
			return { body: "# Runbook\n" };
		return undefined;
	});
	return { bb: new BitbucketVcsSegment(), request: api.request("tok", "/2.0") };
}

describe("Bitbucket VCS segment (#848)", () => {
	it("reads the user and sends the token only as a bearer header", async () => {
		const { bb, request } = await serve();
		expect(await bb.getAuthenticatedUser(request)).toMatchObject({
			login: "ada",
			name: "Ada Lovelace",
		});
		expect(api.requests.every((r) => r.authorization === "Bearer tok")).toBe(
			true,
		);
	});

	it("lists workspaces and follows the absolute next link across repositories", async () => {
		const { bb, request } = await serve();
		expect((await bb.getOrganizations(request))[0]).toMatchObject({
			name: "acme",
		});
		const repos = await bb.getRepositories(request);
		expect(repos.map((r) => r.fullName)).toEqual(["acme/api", "acme/web"]);
		expect(repos[0]).toMatchObject({
			isPrivate: true,
			defaultBranch: "main",
			cloneUrl: "https://ada@bitbucket.org/acme/api.git",
		});
	});

	it("stops paging commits at the first one older than since", async () => {
		const { bb, request } = await serve();
		const commits = await bb.getCommitsSince(
			request,
			"acme/api",
			new Date("2026-10-01T00:00:00Z"),
		);
		expect(commits.map((c) => c.sha)).toEqual(["c3", "c2"]);
		expect(commits[0]).toEqual({
			sha: "c3",
			parents: 1,
			committedAt: new Date("2026-10-03T09:00:00Z"),
			author: "Ada Lovelace",
			subject: "Fix timeout",
			body: "Raise it to 30s",
			tag: null,
		});
	});

	it("follows only the first-parent chain, so a merged branch's old commit neither appears nor ends paging", async () => {
		const { bb, request } = await serve();
		const commits = await bb.getCommitsSince(
			request,
			"acme/merged",
			new Date("2026-10-01T00:00:00Z"),
		);
		expect(commits.map((c) => c.sha)).toEqual(["M", "P1"]);
	});

	it("gets a commit with files, using the old path for a deletion", async () => {
		const { bb, request } = await serve();
		expect((await bb.getCommit(request, "acme/api", "c3")).files).toEqual([
			"src/db.ts",
			"gone.md",
		]);
	});

	it("reads a file at the default branch and fails without echoing the body", async () => {
		const { bb, request } = await serve();
		expect(
			await bb.getFileContents(request, "acme/api", "docs/runbook.md"),
		).toMatchObject({ content: "# Runbook\n", sha: "main" });
		await expect(
			bb.getFileContents(request, "acme/api", "nope.md", "main"),
		).rejects.toThrow(
			"Bitbucket API request failed for provider 'bitbucket' (HTTP 404 Not Found)",
		);
	});
});
