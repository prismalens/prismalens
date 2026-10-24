// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterEach, describe, expect, it } from "vitest";
import { type FakeApi, startFakeApi } from "../fake-http.js";
import { GitLabVcsSegment } from "./gitlab.adapter.js";
import * as fx from "./gitlab.fixtures.js";

let api: FakeApi;
afterEach(() => api.close());

async function serve() {
	api = await startFakeApi((url) => {
		const p = url.pathname;
		if (p === "/api/v4/user") return { body: fx.user };
		if (p === "/api/v4/groups") return { body: fx.groups };
		if (p === "/api/v4/projects")
			return url.searchParams.get("page") === "2"
				? { body: fx.projectsPage2 }
				: { body: fx.projectsPage1, headers: { "x-next-page": "2" } };
		if (p === "/api/v4/projects/acme%2Fapi/repository/commits")
			return { body: fx.commits };
		if (p === "/api/v4/projects/acme%2Flong/repository/commits")
			return { body: [fx.longTitleCommit] };
		if (p.endsWith(`/repository/commits/${fx.MERGE_SHA}`))
			return { body: fx.commits[0] };
		if (p.endsWith("/diff")) return { body: fx.diff };
		if (p.endsWith("/repository/files/docs%2Frunbook.md"))
			return { body: fx.file };
		return undefined;
	});
	return {
		gitlab: new GitLabVcsSegment(),
		request: api.request("tok", "/api/v4"),
	};
}

describe("GitLab VCS segment (#848)", () => {
	it("reads the token's user and sends the token only as a bearer header", async () => {
		const { gitlab, request } = await serve();
		expect(await gitlab.getAuthenticatedUser(request)).toMatchObject({
			login: "ada",
			name: "Ada Lovelace",
		});
		expect(await gitlab.testConnection(request)).toBe(true);
		expect(api.requests.every((r) => r.authorization === "Bearer tok")).toBe(
			true,
		);
		expect(api.requests.every((r) => !r.url.includes("tok"))).toBe(true);
	});

	it("lists groups and follows x-next-page across projects", async () => {
		const { gitlab, request } = await serve();
		expect((await gitlab.getOrganizations(request))[0]).toMatchObject({
			name: "acme",
			displayName: "Acme",
		});
		const repos = await gitlab.getRepositories(request);
		expect(repos.map((r) => r.fullName)).toEqual([
			"acme/api",
			"acme/platform/web",
		]);
		expect(repos[0]).toMatchObject({
			isPrivate: true,
			cloneUrl: "https://gitlab.example/acme/api.git",
		});
		expect(repos[1]?.isPrivate).toBe(false);
	});

	it("lists first-parent commits since a time, in the change row shape", async () => {
		const { gitlab, request } = await serve();
		const since = new Date("2026-10-01T00:00:00Z");
		const [c] = await gitlab.getCommitsSince(request, "acme/api", since);
		expect(c).toEqual({
			sha: fx.MERGE_SHA,
			parents: 2,
			committedAt: new Date("2026-10-02T09:30:00.000Z"),
			author: "Ada Lovelace",
			subject: "Merge branch 'fix-timeout' into 'main'",
			body: "Raise the db timeout\n\nSee merge request acme/api!42",
			tag: null,
		});
		const asked = api.requests.find((r) => r.url.includes("/commits?"));
		expect(asked?.url).toContain("first_parent=true");
		expect(asked?.url).toContain(encodeURIComponent(since.toISOString()));
	});

	it("builds subject and body from the message, not GitLab's truncated title", async () => {
		const { gitlab, request } = await serve();
		const [c] = await gitlab.getCommitsSince(
			request,
			"acme/long",
			new Date("2026-10-01T00:00:00Z"),
		);
		expect(c).toMatchObject({
			subject:
				"Raise the database connection timeout for the checkout service under load",
			body: "Body line",
		});
	});

	it("gets a commit with the files it touched", async () => {
		const { gitlab, request } = await serve();
		const c = await gitlab.getCommit(request, "acme/api", fx.MERGE_SHA);
		expect(c.files).toEqual(["src/db.ts", "docs/new.md"]);
		expect(c.parents).toBe(2);
	});

	it("decodes file contents and fails without echoing the body", async () => {
		const { gitlab, request } = await serve();
		expect(
			await gitlab.getFileContents(request, "acme/api", "docs/runbook.md", "main"),
		).toMatchObject({ content: "# Runbook\n", sha: "deadbeef" });
		await expect(
			gitlab.getFileContents(request, "acme/api", "missing.md"),
		).rejects.toThrow(
			"GitLab API request failed for provider 'gitlab' (HTTP 404 Not Found)",
		);
		expect(api.requests.every((r) => r.method === "GET")).toBe(true);
	});
});
