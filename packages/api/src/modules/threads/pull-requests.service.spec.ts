// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CanonicalEvent, PullRequestSchema } from "@prismalens/contracts";
import { afterAll, describe, expect, it, vi } from "vitest";
import { OffOriginError } from "../integrations/source-request.js";
import { fakeDb } from "./__fixtures__/fake-db.js";
import { fakeHost, hostFixture } from "./__fixtures__/fake-host.js";
import {
	LINKS_BRANCH,
	PullRequestsService,
	pullRequestView,
} from "./pull-requests.service.js";

const RUN = "11111111-1111-4111-8111-111111111111";
const SHA = "d43c4e3ad3c34332c803a568f85f116e3ee58f19";
const GH = "/repos/cli/cli";
const PR_URL = "https://github.com/cli/cli/pull/14927";

const recorded = () => ({
	[`${GH}/pulls/14927`]: { body: hostFixture("github-pull"), etag: '"p1"' },
	[`${GH}/pulls/14927/reviews?per_page=100`]: { body: hostFixture("github-reviews") },
	[`${GH}/commits/${SHA}/check-runs?per_page=100`]: {
		body: hostFixture("github-check-runs"),
	},
});

const step = (text: string): CanonicalEvent => ({
	kind: "agent_step",
	runId: RUN,
	branchId: "root",
	path: [],
	seq: 1,
	label: null,
	ts: new Date().toISOString(),
	text,
	toolCalls: [],
});

function setup(
	opts: {
		routes?: Parameters<typeof fakeHost>[0];
		prStatus?: boolean;
		workspace?: unknown;
		repositories?: Record<string, unknown>[];
		token?: boolean;
	} = {},
) {
	const db = fakeDb({
		repositories: opts.repositories ?? [
			{
				id: "repo-cli",
				sourceKind: "url",
				url: "https://github.com/cli/cli.git",
				connectionId: null,
				metadata: JSON.stringify({ credentialConnectionId: "conn-1" }),
			},
		],
		investigations: [
			{
				id: RUN,
				workspace: opts.workspace ? JSON.stringify(opts.workspace) : null,
				repositoryId: "repo-cli",
				agentPlan: null,
			},
		],
		settings:
			opts.prStatus === false
				? [{ key: "threads.context", value: JSON.stringify({ prStatus: false }) }]
				: [],
	});
	const host = fakeHost(opts.routes ?? recorded());
	const appended: CanonicalEvent[] = [];
	const investigations = {
		onEventsAppended: vi.fn(),
		lastEventSeq: vi.fn(async () => 41),
		appendEvents: vi.fn(async (_id: string, events: CanonicalEvent[]) => {
			appended.push(...events);
			return { inserted: events.length, duplicates: 0 };
		}),
	};
	const credentials = {
		resolveForUse: vi.fn(async () => ({
			effectiveUrl: "https://github.com/cli/cli.git",
			authorization: (url: string, scheme: string) =>
				opts.token === false
					? undefined
					: url.startsWith("https://github.com/") && scheme === "bearer"
						? "Bearer tok-123"
						: undefined,
		})),
	};
	const svc = new PullRequestsService(
		db as never,
		credentials as never,
		investigations as never,
		host.impl,
	);
	return { db, host, svc, appended, investigations, credentials };
}

describe("PullRequestsService (#1024 decision 2)", () => {
	it("registers for stored events on start", () => {
		const { svc, investigations } = setup();
		svc.onModuleInit();
		expect(investigations.onEventsAppended).toHaveBeenCalledTimes(1);
	});

	it("links a PR the agent wrote on a configured repository, once, without calling the host", async () => {
		const { svc, db, host, appended } = setup();
		await svc.readAgentEvents(RUN, [
			step(`Opened ${PR_URL} and https://github.com/someone/else/pull/1.`),
			step(`Again: ${PR_URL}`),
		]);
		await svc.readAgentEvents(RUN, [step(PR_URL)]);
		expect(db.prs).toHaveLength(1);
		expect(db.prs[0]).toMatchObject({ source: "agent", number: 14927, repo: "cli/cli" });
		expect(host.calls).toHaveLength(0);
		expect(appended).toEqual([
			expect.objectContaining({
				kind: "pull_request_linked",
				branchId: LINKS_BRANCH,
				seq: 42,
				source: "agent",
				url: PR_URL,
			}),
		]);
	});

	it("reads PR URLs in tool output too, and stores the agent's latest plan", async () => {
		const { svc, db } = setup();
		await svc.readAgentEvents(RUN, [
			{
				kind: "tool_result",
				runId: RUN,
				branchId: "root",
				path: [],
				seq: 2,
				label: null,
				ts: new Date().toISOString(),
				result: {
					name: "gh",
					toolCallId: "t",
					source: "gh pr create",
					ok: true,
					preview: `${PR_URL}\n`,
				},
			},
			{
				kind: "plan",
				runId: RUN,
				branchId: "root",
				path: [],
				seq: 3,
				label: null,
				ts: new Date().toISOString(),
				entries: [{ content: "Open a PR", status: "completed" }],
			},
		]);
		expect(db.prs).toHaveLength(1);
		const run = await db.investigation.findUnique({ where: { id: RUN } });
		expect(JSON.parse(String(run?.agentPlan))).toEqual([
			{ content: "Open a PR", status: "completed" },
		]);
	});

	it("reads state from the host with the repository's token when the panel lists, and caches 60 s", async () => {
		const { svc, host } = setup();
		await svc.readAgentEvents(RUN, [step(PR_URL)]);
		const first = await svc.list(RUN);
		expect(first.statusEnabled).toBe(true);
		expect(first.pullRequests[0]).toMatchObject({
			state: "draft",
			tone: "draft",
			checks: { state: "failing", failed: 1 },
			author: { login: "williammartin" },
		});
		expect(host.calls[0]?.url).toBe(`https://api.github.com${GH}/pulls/14927`);
		expect(host.calls[0]?.headers.authorization).toBe("Bearer tok-123");
		const calls = host.calls.length;
		await svc.list(RUN);
		expect(host.calls).toHaveLength(calls);
		await svc.list(RUN, { force: true });
		expect(host.calls[calls]?.headers["if-none-match"]).toBe('"p1"');
		expect((await svc.stored(RUN))[0]?.fetchedAt).toBeTruthy();
	});

	it("stores a pasted PR without calling the host while PR status is off", async () => {
		const { svc, db, host } = setup({ prStatus: false });
		const pr = await svc.linkFromUser(RUN, PR_URL);
		expect(pr).toMatchObject({ source: "user", state: "unknown", fetchedAt: null });
		expect(db.prs).toHaveLength(1);
		expect(host.calls).toHaveLength(0);
	});

	it("makes no request while PR status is off", async () => {
		const { svc, host } = setup({ prStatus: false });
		await svc.readAgentEvents(RUN, [step(PR_URL)]);
		const out = await svc.list(RUN);
		expect(out).toMatchObject({ statusEnabled: false });
		expect(out.pullRequests[0]?.state).toBe("unknown");
		expect(host.calls).toHaveLength(0);
		expect(await svc.findWorkItems("repo-cli", 1)).toEqual([]);
	});

	it("reads a public repository with no header when no token applies", async () => {
		const { svc, host } = setup({ token: false });
		await svc.readAgentEvents(RUN, [step(PR_URL)]);
		await svc.list(RUN);
		expect(host.calls[0]?.headers.authorization).toBeUndefined();
	});

	it("keeps the stored row when the host fails", async () => {
		const { svc } = setup({ routes: {} });
		await svc.readAgentEvents(RUN, [step(PR_URL)]);
		const out = await svc.list(RUN);
		expect(out.pullRequests[0]).toMatchObject({ state: "unknown", fetchedAt: null });
	});

	it("links a pasted URL and reads it at once; refuses one on no configured repository", async () => {
		const { svc, appended } = setup();
		const pr = await svc.linkFromUser(RUN, `${PR_URL}/files`);
		expect(pr).toMatchObject({ source: "user", url: PR_URL, state: "draft" });
		expect(appended[0]).toMatchObject({ source: "user" });
		await expect(
			svc.linkFromUser(RUN, "https://github.com/evil/cart/pull/1"),
		).rejects.toThrow(/not on a repository PrismaLens knows/);
		await expect(svc.linkFromUser(RUN, "https://example.com/x")).rejects.toThrow(
			/not a pull request/,
		);
		await expect(
			svc.linkFromUser("22222222-2222-4222-8222-222222222222", PR_URL),
		).rejects.toThrow(/Thread not found/);
	});

	it("unlinks only this thread's PR", async () => {
		const { svc, db } = setup();
		await svc.readAgentEvents(RUN, [step(PR_URL)]);
		const id = db.prs[0]?.id ?? "";
		expect(await svc.unlink("33333333-3333-4333-8333-333333333333", id)).toBe(false);
		expect(await svc.unlink(RUN, id)).toBe(true);
		expect(db.prs).toHaveLength(0);
	});

	it("finds the PR of the workspace branch on the host (head=owner:branch)", async () => {
		const { svc, db, host } = setup({
			workspace: {
				layout: "single",
				cwd: "/w/repo",
				repos: [
					{
						name: "repo",
						dir: "/w/repo",
						sourceKind: "url",
						url: "https://github.com/cli/cli.git",
						subPath: null,
						connectionId: null,
						head: SHA,
						branch: "fix/alias",
						services: [],
					},
				],
			},
			routes: {
				...recorded(),
				[`${GH}/pulls`]: { body: [{ html_url: PR_URL }] },
			},
		});
		await svc.list(RUN);
		expect(db.prs[0]).toMatchObject({ source: "branch", number: 14927 });
		const lookup = host.calls.find((c) => c.url.includes("/pulls?"));
		expect(decodeURIComponent(lookup?.url ?? "")).toContain("head=cli:fix/alias");
		const n = host.calls.length;
		await svc.list(RUN);
		expect(host.calls.filter((c) => c.url.includes("/pulls?")).length).toBe(1);
		expect(host.calls.length).toBe(n);
	});

	it("never follows a redirect with the credential, to another origin or its own", async () => {
		const off = setup({
			routes: {
				[`${GH}/pulls/1`]: {
					status: 302,
					headers: { location: "https://evil.example/steal" },
				},
				[`${GH}/pulls/2`]: {
					status: 301,
					headers: { location: "https://api.github.com/repos/cli/cli/pulls/3" },
				},
			},
		});
		const remote = (await off.svc.remotes())[0];
		if (!remote) throw new Error("no remote");
		const req = await off.svc.requestFn("https://api.github.com", remote);
		await expect(req("GET", "repos/cli/cli/pulls/1")).rejects.toThrow(OffOriginError);
		await expect(req("GET", "repos/cli/cli/pulls/2")).rejects.toThrow(/redirects/);
		expect(off.host.calls.map((c) => c.url)).not.toContain("https://evil.example/steal");
		expect(off.host.calls).toHaveLength(2);
	});

	it("looks up work items on a configured repository only", async () => {
		const { svc, host } = setup({
			routes: {
				[`${GH}/issues/14755`]: { body: hostFixture("github-issue") },
				"/search/issues": { body: hostFixture("github-search") },
			},
		});
		expect((await svc.findWorkItems("repo-cli", 14755))[0]?.kind).toBe("issue");
		expect(await svc.searchWorkItems("repo-cli", "alias")).toHaveLength(3);
		expect(await svc.findWorkItems("unknown-repo", 1)).toEqual([]);
		expect(await svc.searchWorkItems("unknown-repo", "x")).toEqual([]);
		expect(host.calls).toHaveLength(2);
	});

	it("gives each feed row its newest PR's number and tone", async () => {
		const { svc } = setup();
		await svc.readAgentEvents(RUN, [step(PR_URL)]);
		const glyphs = await svc.rowGlyphs([RUN]);
		expect(glyphs.get(RUN)).toEqual({ number: 14927, tone: "unknown" });
		expect((await svc.rowGlyphs([])).size).toBe(0);
	});
});

describe("PullRequestsService edges", () => {
	const repo = (over: Record<string, unknown>) => ({
		name: "repo",
		dir: "/w/repo",
		sourceKind: "url",
		url: "https://github.com/cli/cli.git",
		subPath: null,
		connectionId: null,
		head: SHA,
		branch: "fix",
		services: [],
		...over,
	});
	const repositories = [
		{ id: "repo-cli", sourceKind: "url", url: "https://github.com/cli/cli.git", connectionId: "c", metadata: null },
		{ id: "repo-gl", sourceKind: "url", url: "https://gitlab.com/g/p.git", connectionId: null, metadata: null },
		{ id: "repo-bb", sourceKind: "url", url: "https://bitbucket.org/t/r.git", connectionId: null, metadata: null },
		{ id: "repo-bad", sourceKind: "url", url: "not a remote", connectionId: null, metadata: null },
	];

	it("looks up only named branches on hosts it reads, and survives a host that fails", async () => {
		const { svc, db, host } = setup({
			repositories,
			workspace: {
				layout: "multi",
				cwd: "/w",
				repos: [
					repo({ branch: null }),
					repo({ url: "https://github.com/someone/else.git" }),
					repo({ url: "https://bitbucket.org/t/r.git" }),
					repo({ sourceKind: "folder", dir: "/no/such/folder" }),
					repo({ url: "https://gitlab.com/g/p.git" }),
					repo({}),
				],
			},
			routes: {
				"/api/v4/projects/g%2Fp/merge_requests": { body: { not: "a list" } },
				[`${GH}/pulls`]: { status: 302, headers: { location: "https://evil.example/" } },
			},
		});
		await svc.list(RUN, { force: true });
		expect(db.prs).toEqual([]);
		expect(host.calls.map((c) => new URL(c.url).host)).toEqual([
			"gitlab.com",
			"api.github.com",
		]);
	});

	it("keeps a Bitbucket PR as a link with no state read", async () => {
		const { svc, db, host } = setup({ repositories });
		await svc.readAgentEvents(RUN, [step("https://bitbucket.org/t/r/pull-requests/3")]);
		const out = await svc.list(RUN);
		expect(db.prs).toHaveLength(1);
		expect(out.pullRequests[0]).toMatchObject({ host: "other", tone: "unknown" });
		expect(host.calls).toHaveLength(0);
	});

	it("reads without a header when the credential cannot be resolved, and ignores a bad plan", async () => {
		const { svc, credentials, host, db } = setup();
		credentials.resolveForUse.mockRejectedValueOnce(new Error("ambiguous"));
		await svc.readAgentEvents(RUN, [
			step("no links here"),
			{
				kind: "plan",
				runId: RUN,
				branchId: "root",
				path: [],
				seq: 3,
				label: null,
				ts: new Date().toISOString(),
				entries: Array(101).fill({ content: "x", status: "pending" }),
			},
		]);
		const run = await db.investigation.findUnique({ where: { id: RUN } });
		expect(run?.agentPlan).toBeNull();
		await svc.readAgentEvents(RUN, [step(PR_URL)]);
		await svc.list(RUN);
		expect(host.calls[0]?.headers.authorization).toBeUndefined();
	});

	it("reads a stored row whose fields are not what it expects as unknown", () => {
		const view = pullRequestView({
			id: "x",
			investigationId: RUN,
			repositoryId: null,
			host: "weird",
			repo: "a/b",
			url: "https://github.com/a/b/pull/1",
			number: 1,
			title: null,
			state: "bogus",
			review: "bogus",
			checks: "{",
			conflicts: null,
			detail: JSON.stringify({ author: { login: "a", avatarUrl: "not a url" } }),
			source: "bogus",
			etag: null,
			fetchedAt: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		expect(view).toMatchObject({ host: "other", state: "unknown", source: "agent", tone: "unknown" });
		expect(view.author).toBeUndefined();
	});

	it("serves host avatars only through the image proxy, and drops what it won't serve (#1024)", () => {
		const row = {
			id: "x",
			investigationId: RUN,
			repositoryId: null,
			host: "github",
			repo: "a/b",
			url: "https://github.com/a/b/pull/1",
			number: 1,
			title: null,
			state: "open",
			review: "none",
			checks: "{}",
			conflicts: null,
			detail: JSON.stringify({
				author: { login: "ana", avatarUrl: "https://avatars.githubusercontent.com/u/1" },
				reviewers: [{ login: "bo", state: "approved", avatarUrl: "https://evil.example/bo.png" }],
				checkRuns: [
					{
						name: "ci",
						state: "passing",
						appName: "Actions",
						appAvatarUrl: "https://avatars.githubusercontent.com/in/15368",
					},
				],
			}),
			source: "agent",
			etag: null,
			fetchedAt: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		const proxied = (u: string) => (u.includes("evil") ? undefined : "/api/images/k.sig");
		const view = pullRequestView(row, proxied);
		expect(view.author).toEqual({ login: "ana", avatarUrl: "/api/images/k.sig" });
		expect(view.reviewers).toEqual([{ login: "bo", state: "approved" }]);
		expect(view.checkRuns?.[0]?.appAvatarUrl).toBe("/api/images/k.sig");
		expect(PullRequestSchema.safeParse(view).success).toBe(true);
		// Without the proxy no host URL reaches the browser at all.
		const bare = pullRequestView(row);
		expect(bare.author).toEqual({ login: "ana" });
		expect(bare.checkRuns?.[0]?.appAvatarUrl).toBeUndefined();
	});
});

describe("a folder project's remote", () => {
	const dir = mkdtempSync(join(tmpdir(), "pl-pr-origin-"));
	afterAll(() => rmSync(dir, { recursive: true, force: true }));

	it("is read from its origin, so a PR on it is trusted", async () => {
		execFileSync("git", ["init", "-q", dir]);
		execFileSync("git", ["-C", dir, "remote", "add", "origin", "git@github.com:cli/cli.git"]);
		const { svc, db } = setup({
			repositories: [
				{ id: "folder", sourceKind: "folder", url: dir, connectionId: null, metadata: null },
				{ id: "no-origin", sourceKind: "folder", url: tmpdir(), connectionId: null, metadata: null },
			],
		});
		await svc.readAgentEvents(RUN, [step(PR_URL)]);
		expect(db.prs[0]).toMatchObject({ repositoryId: "folder" });
		svc.forgetRemotes();
		expect((await svc.remotes()).map((r) => r.repositoryId)).toEqual(["folder"]);
	});
});
