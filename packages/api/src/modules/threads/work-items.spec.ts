// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { sourceRequestFn } from "../integrations/source-request.js";
import { fakeHost, hostFixture } from "./__fixtures__/fake-host.js";
import { byNumber, search, workApiBase, workHostOf } from "./work-items.js";

const req = (impl: typeof fetch, base: string) =>
	sourceRequestFn(base, { ok: true, credential: { kind: "none" } }, {
		fetchImpl: impl,
		maxRedirects: 0,
	});

describe("work items for the # menu (#1024 decision 2)", () => {
	it("knows the host kinds and their fixed API origins", () => {
		expect(workHostOf("github.com")).toBe("github");
		expect(workHostOf("gitlab.acme.io")).toBe("gitlab");
		expect(workHostOf("bitbucket.org")).toBe("bitbucket");
		expect(workHostOf("git.acme.io")).toBeNull();
		expect(workApiBase("bitbucket.org", "bitbucket")).toBe(
			"https://api.bitbucket.org/2.0",
		);
		expect(workApiBase("ghe.io", "github")).toBe("https://ghe.io/api/v3");
	});

	it("finds a GitHub issue by number from a recorded answer", async () => {
		const host = fakeHost({
			"/repos/cli/cli/issues/14755": { body: hostFixture("github-issue") },
		});
		const base = "https://api.github.com";
		const [item] = await byNumber(req(host.impl, base), "github", "cli/cli", 14755);
		expect(item).toMatchObject({
			kind: "issue",
			number: 14755,
			state: "open",
			tone: "open",
			url: "https://github.com/cli/cli/issues/14755",
		});
		expect(item?.author?.login).toBeTruthy();
		expect(await byNumber(req(host.impl, base), "github", "cli/cli", 0)).toEqual([]);
		expect(await byNumber(req(host.impl, base), "github", "cli/cli", 9)).toEqual([]);
	});

	it("searches GitHub titles, capped at 20, in the host's order", async () => {
		const host = fakeHost({ "/search/issues": { body: hostFixture("github-search") } });
		const items = await search(req(host.impl, "https://api.github.com"), "github", "cli/cli", "alias");
		expect(items.map((i) => i.number)).toEqual([14755, 13104, 3512]);
		expect(host.calls[0]?.url).toContain("per_page=20");
		expect(decodeURIComponent(host.calls[0]?.url ?? "")).toContain("repo:cli/cli alias in:title");
		expect(await search(req(host.impl, "https://api.github.com"), "github", "cli/cli", " ")).toEqual([]);
	});

	it("finds a GitLab issue and MR that share a number, and searches both", async () => {
		const p = "/api/v4/projects/gitlab-org%2Fcli";
		const host = fakeHost({
			[`${p}/issues/1`]: { body: hostFixture("gitlab-issue") },
			[`${p}/merge_requests/1`]: { body: hostFixture("gitlab-mr") },
			[`${p}/merge_requests`]: { body: hostFixture("gitlab-mr-search") },
			[`${p}/issues`]: { body: [hostFixture("gitlab-issue")] },
		});
		const base = "https://gitlab.com/api/v4";
		const found = await byNumber(req(host.impl, base), "gitlab", "gitlab-org/cli", 1);
		expect(found.map((i) => [i.kind, i.state])).toEqual([
			["issue", "closed"],
			["pull_request", "merged"],
		]);
		const hits = await search(req(host.impl, base), "gitlab", "gitlab-org/cli", "alias");
		expect(hits.length).toBeGreaterThan(1);
		expect(hits.length).toBeLessThanOrEqual(20);
		expect(hits.at(-1)?.kind).toBe("issue");
	});

	it("reads a Bitbucket pull request, declined as closed, with its author but no email-hash avatar", async () => {
		const p = "/2.0/repositories/atlassian/atlassian-connect-express";
		const host = fakeHost({
			[`${p}/pullrequests/1`]: { body: hostFixture("bitbucket-pr") },
			[`${p}/pullrequests`]: { body: { values: [hostFixture("bitbucket-pr")] } },
		});
		const base = "https://api.bitbucket.org/2.0";
		const [pr] = await byNumber(
			req(host.impl, base),
			"bitbucket",
			"atlassian/atlassian-connect-express",
			1,
		);
		expect(pr).toMatchObject({ kind: "pull_request", number: 1, state: "closed", tone: "closed" });
		// Its recorded avatar is an email-hash service's, which is never stored (#1024 decision 11).
		expect(pr?.author).toEqual({ login: expect.any(String) });
		const hits = await search(
			req(host.impl, base),
			"bitbucket",
			"atlassian/atlassian-connect-express",
			'say "hi"',
		);
		expect(hits).toHaveLength(1);
		expect(decodeURIComponent(host.calls.at(-1)?.url ?? "")).toContain('title ~ "say hi"');
	});
});
