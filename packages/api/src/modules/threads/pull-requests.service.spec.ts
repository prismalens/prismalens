// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CanonicalEvent, PullRequestSchema } from "@prismalens/contracts";
import { afterAll, describe, expect, it, vi } from "vitest";
import { remoteHeadOf } from "../investigations/remote-heads.js";
import { OffOriginError } from "../integrations/source-request.js";
import { LOG_UNAVAILABLE } from "./pr-hosts.js";
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
		/** In place of the fake host: a fetch of the test's own, e.g. one that cannot connect. */
		fetch?: typeof fetch;
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
	const origFindUnique = db.pullRequest.findUnique;
	(db.pullRequest as any).findUnique = async ({ where }: any) => {
		if (where.id) return db.prs.find((p) => p.id === where.id) ?? null;
		return origFindUnique({ where });
	};
	(db.pullRequest as any).updateMany = async ({ where, data }: any) => {
		let count = 0;
		for (const p of db.prs) {
			if (!where.url || p.url === where.url) {
				Object.assign(p, data);
				count++;
			}
		}
		return { count };
	};
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
		opts.fetch ?? host.impl,
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

	// 0ab5288b9 adds the row's PR count, drawn as "+N" beside the newest; d0739b420 its title
	// and checks, for the palette's PR results.
	it("gives each feed row its newest PR's number, tone, PR count, title and checks", async () => {
		const { svc } = setup();
		await svc.readAgentEvents(RUN, [step(PR_URL)]);
		const glyphs = await svc.rowGlyphs([RUN]);
		expect(glyphs.get(RUN)).toEqual({
			number: 14927,
			tone: "unknown",
			count: 1,
			title: null,
			checks: { state: "none", total: 0, failed: 0, pending: 0 },
		});
		expect((await svc.rowGlyphs([])).size).toBe(0);
	});

	it("returns a kept checkLog without calling the host, refuses unknown runId, maps commit status, and stores read logs in detail.checkLogs", async () => {
		const { svc, db, host } = setup({
			routes: {
				...recorded(),
				[`${GH}/actions/jobs/run-fetch`]: { status: 404 },
				[`${GH}/check-runs/run-fetch`]: {
					body: {
						output: {
							title: "Compile TypeScript",
							text: "Error: cannot find module",
						},
					},
				},
				[`${GH}/check-runs/run-fetch/annotations`]: { body: [] },
			},
		});

		const prRow = await db.pullRequest.create({
			data: {
				investigationId: RUN,
				repositoryId: "repo-cli",
				host: "github",
				repo: "cli/cli",
				url: PR_URL,
				number: 14927,
				source: "agent",
				headSha: SHA,
				detail: JSON.stringify({
					checkRuns: [
						{
							id: "run-kept",
							name: "test",
							state: "failing",
							headSha: SHA,
							appId: "app-1",
						},
						{
							id: "run-status",
							name: "ci/status",
							state: "failing",
							headSha: SHA,
						},
						{
							id: "run-fetch",
							name: "build",
							state: "failing",
							headSha: SHA,
							appId: "app-1",
						},
					],
					checkLogs: [
						{
							runId: "run-kept",
							headSha: SHA,
							step: "Run vitest",
							lines: ["failed test"],
							unavailable: null,
							fetchedAt: "2026-11-12T00:00:00.000Z",
						},
					],
				}),
			},
		});

		// 1. Returns kept log for same head commit without calling the host
		const keptLog = await svc.checkLog(RUN, prRow.id, "run-kept");
		expect(keptLog.step).toBe("Run vitest");
		expect(keptLog.lines).toEqual(["failed test"]);
		expect(keptLog.unavailable).toBeNull();
		expect(host.calls).toHaveLength(0);

		// 2. Refuses unknown run id with NOT_FOUND and message
		await expect(svc.checkLog(RUN, prRow.id, "unknown-run")).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "That check is not on this pull request.",
		});

		// 3. GitHub commit status (run without appId) returns LOG_UNAVAILABLE.status
		const statusLog = await svc.checkLog(RUN, prRow.id, "run-status");
		expect(statusLog.unavailable).toBe(LOG_UNAVAILABLE.status);
		expect(statusLog.lines).toEqual([]);
		expect(statusLog.step).toBeNull();

		// 4. A read log is stored in the row's detail.checkLogs
		const fetchedLog = await svc.checkLog(RUN, prRow.id, "run-fetch");
		expect(fetchedLog.step).toBe("Compile TypeScript");
		expect(fetchedLog.lines).toEqual(["Error: cannot find module"]);
		expect(fetchedLog.unavailable).toBeNull();

		const updatedRow = await db.pullRequest.findFirst({ where: { id: prRow.id } });
		const storedDetail = JSON.parse(String(updatedRow?.detail));
		expect(storedDetail.checkLogs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ runId: "run-fetch", step: "Compile TypeScript" }),
				expect.objectContaining({ runId: "run-kept", step: "Run vitest" }),
			]),
		);
	});

	it("host refresh keeps checkLogs matching new head, stores reviewThreads, and on GraphQL 401 stores reviewThreadsNote keeping previous threads", async () => {
		const newSha = "d43c4e3ad3c34332c803a568f85f116e3ee58f19";
		const oldSha = "0000000000000000000000000000000000000000";
		const { svc, db } = setup({
			routes: {
				...recorded(),
				"/graphql": {
					body: {
						data: {
							repository: {
								pullRequest: {
									reviewThreads: {
										nodes: [
											{
												id: "thread-graphql",
												isResolved: false,
												isOutdated: false,
												path: "src/main.ts",
												line: 10,
												comments: {
													totalCount: 1,
													nodes: [{ author: { login: "reviewer" }, body: "review note" }],
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
		});

		const prRow = await db.pullRequest.create({
			data: {
				investigationId: RUN,
				repositoryId: "repo-cli",
				host: "github",
				repo: "cli/cli",
				url: PR_URL,
				number: 14927,
				source: "agent",
				headSha: oldSha,
				detail: JSON.stringify({
					checkLogs: [
						{
							runId: "run-new",
							headSha: newSha,
							step: "Step new",
							lines: ["new log"],
							unavailable: null,
							fetchedAt: "2026-11-12T00:00:00.000Z",
						},
						{
							runId: "run-old",
							headSha: oldSha,
							step: "Step old",
							lines: ["old log"],
							unavailable: null,
							fetchedAt: "2026-11-12T00:00:00.000Z",
						},
					],
					reviewThreads: [
						{
							id: "thread-initial",
							path: "src/initial.ts",
							line: 5,
							author: "alice",
							resolved: true,
							outdated: false,
							excerpt: "initial thread",
							replies: 0,
						},
					],
				}),
			},
		});

		// 1. Host refresh with successful GraphQL
		await svc.list(RUN, { force: true });
		const rowAfterRefresh = await db.pullRequest.findFirst({ where: { id: prRow.id } });
		const detail1 = JSON.parse(String(rowAfterRefresh?.detail));

		// Keeps checkLogs matching newSha (new head is SHA), drops oldSha
		expect(detail1.checkLogs).toEqual([
			expect.objectContaining({ runId: "run-new", headSha: newSha }),
		]);
		// Stores reviewThreads from GraphQL
		expect(detail1.reviewThreads).toEqual([
			expect.objectContaining({ id: "thread-graphql", path: "src/main.ts" }),
		]);
		expect(detail1.reviewThreadsNote).toBeUndefined();

		// 2. Next host refresh with 401 on GraphQL
		const failingSetup = setup({
			routes: {
				...recorded(),
				"/graphql": { status: 401 },
			},
		});
		// Update row in failingSetup's db
		await failingSetup.db.pullRequest.create({
			data: {
				...prRow,
				detail: JSON.stringify({
					checkLogs: detail1.checkLogs,
					reviewThreads: detail1.reviewThreads,
				}),
			},
		});
		await failingSetup.svc.list(RUN, { force: true });
		const rowAfter401 = await failingSetup.db.pullRequest.findFirst({ where: { id: prRow.id } });
		const detail2 = JSON.parse(String(rowAfter401?.detail));

		// Stores reviewThreadsNote and keeps the previous threads
		expect(detail2.reviewThreadsNote).toBe(
			"Review threads need a token for this repository: the host shows them only to a signed-in reader.",
		);
		expect(detail2.reviewThreads).toEqual([
			expect.objectContaining({ id: "thread-graphql", path: "src/main.ts" }),
		]);
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
			headSha: null,
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
			headSha: null,
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

	it("Given a watch pass, Then each PR is read now, and a host that cannot be reached, fails or limits is reported, while a 404 is not (#1024 spec B)", async () => {
		const pass = async (opts: Parameters<typeof setup>[0]) => {
			const t = setup(opts);
			await t.svc.readAgentEvents(RUN, [step(PR_URL)]);
			return t.svc.refreshForWatch(RUN);
		};
		const refused = await pass({
			fetch: (async () => {
				throw new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED 127.0.0.1:443") });
			}) as typeof fetch,
		});
		expect(refused.failed).toBe(true);
		expect(refused.pullRequests[0]).toMatchObject({ state: "unknown" });
		const busy = await pass({
			fetch: (async () => new Response("busy", { status: 503 })) as typeof fetch,
		});
		expect(busy.failed).toBe(true);
		const limited = await pass({
			fetch: (async () => new Response("slow down", { status: 429 })) as typeof fetch,
		});
		expect(limited.failed).toBe(true);
		// A deleted PR answers 404: the host is fine, so nothing backs off.
		const gone = await pass({ routes: {} });
		expect(gone.failed).toBe(false);
		const read = await pass({});
		expect(read.failed).toBe(false);
		expect(read.pullRequests[0]).toMatchObject({ state: "draft" });
	});
});

describe("threadBranches", () => {
	it("returns branches of workspace repositories with configured remotes, skipping branches without remotes or branches not set", async () => {
		const { svc } = setup({
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
						branch: "feat-prs",
						services: [],
					},
					{
						name: "no-branch",
						dir: "/w/no-branch",
						sourceKind: "url",
						url: "https://github.com/cli/cli.git",
						subPath: null,
						connectionId: null,
						head: SHA,
						branch: null,
						services: [],
					},
					{
						name: "unknown-repo",
						dir: "/w/unknown",
						sourceKind: "url",
						url: "https://github.com/unknown/other.git",
						subPath: null,
						connectionId: null,
						head: SHA,
						branch: "feat-other",
						services: [],
					},
					{
						name: "bad-url",
						dir: "/w/bad",
						sourceKind: "url",
						url: "not-a-valid-url",
						subPath: null,
						connectionId: null,
						head: SHA,
						branch: "feat-bad",
						services: [],
					},
				],
			},
		});
		const branches = await svc.threadBranches(RUN);
		expect(branches).toEqual([{ repo: "cli/cli", branch: "feat-prs" }]);
	});

	it("returns empty branches when the thread has no workspace", async () => {
		const { svc } = setup({ workspace: null });
		const branches = await svc.threadBranches(RUN);
		expect(branches).toEqual([]);
	});
});

describe("replyReview", () => {
	const REPLY_URL = `${PR_URL}#discussion_r101`;

	it("posts a reply to a review thread with a line number, updates thread replies, appends status event, and caches client key", async () => {
		const { svc, db, host, appended } = setup({
			routes: {
				...recorded(),
				"/graphql": {
					body: {
						data: {
							addPullRequestReviewThreadReply: {
								comment: {
									databaseId: 101,
									author: { login: "octocat" },
									body: "Addressed comment",
									url: REPLY_URL,
								},
							},
						},
					},
				},
			},
		});

		const prRow = await db.pullRequest.create({
			data: {
				investigationId: RUN,
				repositoryId: "repo-cli",
				host: "github",
				repo: "cli/cli",
				url: PR_URL,
				number: 14927,
				source: "agent",
				headSha: SHA,
				detail: JSON.stringify({
					reviewThreads: [
						{
							id: "thread-line",
							path: "src/file.ts",
							line: 42,
							author: "alice",
							resolved: false,
							outdated: false,
							excerpt: "initial comment",
							replies: 0,
						},
					],
				}),
			},
		});

		const res = await svc.replyReview({
			id: RUN,
			prId: prRow.id,
			threadId: "thread-line",
			body: "Addressed comment",
			clientKey: "client-key-1",
		});

		expect(res).toEqual({
			ok: true,
			url: REPLY_URL,
			thread: {
				id: "thread-line",
				path: "src/file.ts",
				line: 42,
				author: "alice",
				resolved: false,
				outdated: false,
				excerpt: "initial comment",
				replies: 1,
				last: {
					author: "octocat",
					excerpt: "Addressed comment",
					url: REPLY_URL,
				},
			},
		});

		const updatedRow = await db.pullRequest.findFirst({ where: { id: prRow.id } });
		const updatedDetail = JSON.parse(String(updatedRow?.detail));
		expect(updatedDetail.reviewThreads).toEqual([
			expect.objectContaining({ id: "thread-line", replies: 1 }),
		]);
		expect(updatedDetail.own).toEqual([{ source: "review_comment", id: 101 }]);

		expect(appended).toEqual([
			expect.objectContaining({
				kind: "pr_status",
				runId: RUN,
				prId: prRow.id,
				lines: ["You replied on src/file.ts:42: Addressed comment"],
				marks: [{ kind: "comment", state: "commented", name: "octocat" }],
				link: REPLY_URL,
			}),
		]);

		const initialCalls = host.calls.length;
		const secondRes = await svc.replyReview({
			id: RUN,
			prId: prRow.id,
			threadId: "thread-line",
			body: "Addressed comment",
			clientKey: "client-key-1",
		});
		expect(secondRes).toEqual(res);
		expect(host.calls).toHaveLength(initialCalls);
	});

	it("formats path without line number when review thread has no line", async () => {
		const { svc, db, appended } = setup({
			routes: {
				...recorded(),
				"/graphql": {
					body: {
						data: {
							addPullRequestReviewThreadReply: {
								comment: {
									databaseId: 102,
									author: { login: "octocat" },
									body: "Top level file note",
									url: `${PR_URL}#discussion_r102`,
								},
							},
						},
					},
				},
			},
		});

		const prRow = await db.pullRequest.create({
			data: {
				investigationId: RUN,
				repositoryId: "repo-cli",
				host: "github",
				repo: "cli/cli",
				url: PR_URL,
				number: 14927,
				source: "agent",
				headSha: SHA,
				detail: JSON.stringify({
					reviewThreads: [
						{
							id: "thread-noline",
							path: "README.md",
							line: null,
							author: "bob",
							resolved: false,
							outdated: false,
							excerpt: "top note",
							replies: 0,
						},
					],
				}),
			},
		});

		const res = await svc.replyReview({
			id: RUN,
			prId: prRow.id,
			threadId: "thread-noline",
			body: "Top level file note",
			clientKey: "client-key-2",
		});
		expect(res.ok).toBe(true);
		const statusEvent = appended[0] as Extract<CanonicalEvent, { kind: "pr_status" }>;
		expect(statusEvent.lines).toEqual(["You replied on README.md: Top level file note"]);
	});

	it("refuses reply when pull request or review thread is not found with NOT_FOUND", async () => {
		const { svc, db } = setup({ routes: recorded() });

		const prRow = await db.pullRequest.create({
			data: {
				investigationId: RUN,
				repositoryId: "repo-cli",
				host: "github",
				repo: "cli/cli",
				url: PR_URL,
				number: 14927,
				source: "agent",
				headSha: SHA,
				detail: JSON.stringify({ reviewThreads: [] }),
			},
		});

		await expect(
			svc.replyReview({
				id: RUN,
				prId: "missing-pr-id",
				threadId: "thread-1",
				body: "msg",
				clientKey: "key-err-1",
			}),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "Pull request not found",
		});

		await expect(
			svc.replyReview({
				id: RUN,
				prId: prRow.id,
				threadId: "missing-thread-id",
				body: "msg",
				clientKey: "key-err-2",
			}),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "Review thread not found",
		});
	});

	it("returns refusal failure when host returns write error with scope rejection", async () => {
		const { svc, db } = setup({
			routes: {
				...recorded(),
				"/graphql": {
					body: {
						errors: [
							{
								type: "INSUFFICIENT_SCOPES",
								message: "Token is missing repo scope",
							},
						],
					},
				},
			},
		});

		const prRow = await db.pullRequest.create({
			data: {
				investigationId: RUN,
				repositoryId: "repo-cli",
				host: "github",
				repo: "cli/cli",
				url: PR_URL,
				number: 14927,
				source: "agent",
				headSha: SHA,
				detail: JSON.stringify({
					reviewThreads: [
						{
							id: "thread-scope-err",
							path: "src/main.ts",
							line: null,
							author: "alice",
							resolved: false,
							outdated: false,
							excerpt: "comment",
							replies: 0,
						},
					],
				}),
			},
		});

		const res = await svc.replyReview({
			id: RUN,
			prId: prRow.id,
			threadId: "thread-scope-err",
			body: "reply",
			clientKey: "key-scope-err",
		});

		expect(res).toEqual({
			ok: false,
			failure: "scope",
			message: "Token is missing repo scope",
		});
	});

	it("returns rejected failure when pull request repository is not one PrismaLens reads from", async () => {
		const { svc, db } = setup({ routes: recorded() });

		const prRow = await db.pullRequest.create({
			data: {
				investigationId: RUN,
				repositoryId: "repo-cli",
				host: "github",
				repo: "unknown/other",
				url: "https://github.com/unknown/other/pull/1",
				number: 1,
				source: "agent",
				headSha: SHA,
				detail: JSON.stringify({
					reviewThreads: [
						{
							id: "thread-unknown-remote",
							path: "src/main.ts",
							line: null,
							author: "alice",
							resolved: false,
							outdated: false,
							excerpt: "comment",
							replies: 0,
						},
					],
				}),
			},
		});

		const res = await svc.replyReview({
			id: RUN,
			prId: prRow.id,
			threadId: "thread-unknown-remote",
			body: "reply",
			clientKey: "key-unknown-remote",
		});

		expect(res).toEqual({
			ok: false,
			failure: "rejected",
			message: "This pull request's repository is not one PrismaLens reads from.",
		});
	});

	it("retries an unreachable reply by checking matching excerpt on the thread before posting again", async () => {
		let replyCallCount = 0;
		const host = fakeHost(recorded());
		const customFetch = (async (input: string | URL, init?: RequestInit) => {
			const url = String(input);
			if (url.includes("/graphql")) {
				const body = JSON.parse(String(init?.body ?? "{}"));
				if (body.query?.includes("addPullRequestReviewThreadReply")) {
					replyCallCount++;
					throw new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED") });
				}
				if (body.query?.includes("reviewThreads")) {
					return new Response(
						JSON.stringify({
							data: {
								repository: {
									pullRequest: {
										reviewThreads: {
											nodes: [
												{
													id: "thread-retry",
													isResolved: false,
													isOutdated: false,
													path: "src/file.ts",
													line: 12,
													comments: {
														totalCount: 2,
														nodes: [{ author: { login: "alice" }, body: "initial" }],
													},
													latest: {
														nodes: [
															{
																author: { login: "octocat" },
																body: "Body that was lost in transit",
																url: `${PR_URL}#discussion_r999`,
															},
														],
													},
												},
											],
										},
									},
								},
							},
						}),
						{ status: 200, headers: { "content-type": "application/json" } },
					);
				}
			}
			return host.impl(input, init);
		}) as typeof fetch;

		const { svc, db } = setup({ fetch: customFetch });

		const prRow = await db.pullRequest.create({
			data: {
				investigationId: RUN,
				repositoryId: "repo-cli",
				host: "github",
				repo: "cli/cli",
				url: PR_URL,
				number: 14927,
				source: "agent",
				headSha: SHA,
				detail: JSON.stringify({
					reviewThreads: [
						{
							id: "thread-retry",
							path: "src/file.ts",
							line: 12,
							author: "alice",
							resolved: false,
							outdated: false,
							excerpt: "initial comment",
							replies: 0,
						},
					],
				}),
			},
		});

		const firstRes = await svc.replyReview({
			id: RUN,
			prId: prRow.id,
			threadId: "thread-retry",
			body: "Body that was lost in transit",
			clientKey: "key-unsure-retry",
		});
		expect(firstRes).toEqual({
			ok: false,
			failure: "unreachable",
			message: "The git host did not answer.",
		});
		expect(replyCallCount).toBe(1);

		const secondRes = await svc.replyReview({
			id: RUN,
			prId: prRow.id,
			threadId: "thread-retry",
			body: "Body that was lost in transit",
			clientKey: "key-unsure-retry",
		});
		expect(secondRes).toEqual({
			ok: true,
			url: `${PR_URL}#discussion_r999`,
			thread: {
				id: "thread-retry",
				path: "src/file.ts",
				line: 12,
				author: "alice",
				resolved: false,
				outdated: false,
				excerpt: "initial comment",
				replies: 1,
				last: {
					author: "octocat",
					excerpt: "Body that was lost in transit",
					url: `${PR_URL}#discussion_r999`,
				},
			},
		});
		expect(replyCallCount).toBe(1);
	});

	it("expires cached replies after thirty minutes allowing a fresh post", async () => {
		const { svc, db } = setup({
			routes: {
				...recorded(),
				"/graphql": {
					body: {
						data: {
							addPullRequestReviewThreadReply: {
								comment: {
									databaseId: 200,
									author: { login: "octocat" },
									body: "reply",
									url: `${PR_URL}#note_200`,
								},
							},
						},
					},
				},
			},
		});

		const prRow = await db.pullRequest.create({
			data: {
				investigationId: RUN,
				repositoryId: "repo-cli",
				host: "github",
				repo: "cli/cli",
				url: PR_URL,
				number: 14927,
				source: "agent",
				headSha: SHA,
				detail: JSON.stringify({
					reviewThreads: [
						{
							id: "thread-expire",
							path: "src/file.ts",
							line: 5,
							author: "alice",
							resolved: false,
							outdated: false,
							excerpt: "comment",
							replies: 0,
						},
					],
				}),
			},
		});

		const nowSpy = vi.spyOn(Date, "now");
		nowSpy.mockReturnValue(1_000_000);

		await svc.replyReview({
			id: RUN,
			prId: prRow.id,
			threadId: "thread-expire",
			body: "reply",
			clientKey: "key-expire",
		});

		nowSpy.mockReturnValue(1_000_000 + 1_800_001);

		const res = await svc.replyReview({
			id: RUN,
			prId: prRow.id,
			threadId: "thread-expire",
			body: "reply",
			clientKey: "key-expire",
		});
		expect(res.ok).toBe(true);
		nowSpy.mockRestore();
	});
});

describe("checkLogFull and log reads", () => {
	it("reads a check's full log using locate and download with step and lines without storing in pullRequest", async () => {
		const host = fakeHost({
			...recorded(),
			[`${GH}/actions/jobs/run-full`]: {
				body: {
					steps: [
						{ name: "Set up runner", conclusion: "success" },
						{ name: "Run test suite", conclusion: "failure" },
					],
				},
			},
			[`${GH}/actions/jobs/run-full/logs`]: {
				status: 302,
				headers: { location: "https://logs.github.com/run-full.log" },
			},
		});

		const customFetch = (async (input: string | URL, init?: RequestInit) => {
			const url = String(input);
			if (url.includes("/run-full.log")) {
				return new Response("line 1\nline 2 error in test\n", { status: 200 });
			}
			return host.impl(input, init);
		}) as typeof fetch;

		const { svc, db } = setup({ fetch: customFetch });

		const prRow = await db.pullRequest.create({
			data: {
				investigationId: RUN,
				repositoryId: "repo-cli",
				host: "github",
				repo: "cli/cli",
				url: PR_URL,
				number: 14927,
				source: "agent",
				headSha: SHA,
				detail: JSON.stringify({
					checkRuns: [
						{
							id: "run-full",
							name: "test",
							state: "failing",
							headSha: SHA,
							appId: "app-1",
						},
					],
				}),
			},
		});

		const log = await svc.checkLogFull(RUN, prRow.id, "run-full");
		expect(log.runId).toBe("run-full");
		expect(log.step).toBe("Run test suite");
		expect(log.lines).toEqual(["line 1", "line 2 error in test"]);
		expect(log.truncated).toBe(false);
		expect(log.unavailable).toBeNull();
		expect(typeof log.fetchedAt).toBe("string");
		expect(log.fetchedAt.length).toBe(24);

		const rowAfter = await db.pullRequest.findFirst({ where: { id: prRow.id } });
		const detailAfter = JSON.parse(String(rowAfter?.detail));
		expect(detailAfter.checkLogs).toBeUndefined();
	});

	it("returns unavailable message when pull request status is disabled in settings", async () => {
		const { svc, db } = setup({ prStatus: false });

		const prRow = await db.pullRequest.create({
			data: {
				investigationId: RUN,
				repositoryId: "repo-cli",
				host: "github",
				repo: "cli/cli",
				url: PR_URL,
				number: 14927,
				source: "agent",
				headSha: SHA,
				detail: JSON.stringify({
					checkRuns: [
						{
							id: "run-disabled",
							name: "test",
							state: "failing",
							headSha: SHA,
							appId: "app-1",
						},
					],
				}),
			},
		});

		const log = await svc.checkLogFull(RUN, prRow.id, "run-disabled");
		expect(log.step).toBeNull();
		expect(log.lines).toEqual([]);
		expect(log.unavailable).toBe("Pull request status is off in Settings, so PrismaLens reads no logs.");
	});

	it("returns unavailable gone when log download location uses insecure http scheme", async () => {
		const { svc, db } = setup({
			routes: {
				...recorded(),
				[`${GH}/actions/jobs/run-insecure`]: {
					body: {
						steps: [{ name: "Run task", conclusion: "failure" }],
					},
				},
				[`${GH}/actions/jobs/run-insecure/logs`]: {
					status: 302,
					headers: { location: "http://insecure.logs.com/log.txt" },
				},
			},
		});

		const prRow = await db.pullRequest.create({
			data: {
				investigationId: RUN,
				repositoryId: "repo-cli",
				host: "github",
				repo: "cli/cli",
				url: PR_URL,
				number: 14927,
				source: "agent",
				headSha: SHA,
				detail: JSON.stringify({
					checkRuns: [
						{
							id: "run-insecure",
							name: "task",
							state: "failing",
							headSha: SHA,
							appId: "app-1",
						},
					],
				}),
			},
		});

		const log = await svc.checkLogFull(RUN, prRow.id, "run-insecure");
		expect(log.step).toBe("Run task");
		expect(log.lines).toEqual([]);
		expect(log.unavailable).toBe(LOG_UNAVAILABLE.gone);
	});

	it("uses row headSha when run has no headSha and replaces existing checkLog with same runId", async () => {
		const { svc, db } = setup({
			routes: {
				...recorded(),
				[`${GH}/actions/jobs/run-fallback`]: { status: 404 },
				[`${GH}/check-runs/run-fallback`]: {
					body: {
						output: {
							title: "Replaced step",
							text: "new output",
						},
					},
				},
				[`${GH}/check-runs/run-fallback/annotations`]: { body: [] },
			},
		});

		const prRow = await db.pullRequest.create({
			data: {
				investigationId: RUN,
				repositoryId: "repo-cli",
				host: "github",
				repo: "cli/cli",
				url: PR_URL,
				number: 14927,
				source: "agent",
				headSha: SHA,
				detail: JSON.stringify({
					checkRuns: [
						{
							id: "run-fallback",
							name: "ci",
							state: "failing",
							appId: "app-1",
						},
					],
					checkLogs: [
						{
							runId: "run-fallback",
							headSha: "old-sha",
							step: "Old step",
							lines: ["old line"],
							unavailable: null,
							fetchedAt: "2026-11-10T00:00:00.000Z",
						},
					],
				}),
			},
		});

		const log = await svc.checkLog(RUN, prRow.id, "run-fallback");
		expect(log.headSha).toBe(SHA);
		expect(log.step).toBe("Replaced step");

		const rowAfter = await db.pullRequest.findFirst({ where: { id: prRow.id } });
		const detailAfter = JSON.parse(String(rowAfter?.detail));
		expect(detailAfter.checkLogs).toHaveLength(1);
		expect(detailAfter.checkLogs[0].step).toBe("Replaced step");
	});
});

describe("readShared", () => {
	it("reads a pull request shared state, activity, head branch, viewer, and preserves own entries", async () => {
		const { svc, db } = setup({
			routes: {
				...recorded(),
				[`${GH}/git/ref/heads/williammartin-multiaccount-draft-08-evaluation`]: {
					body: { object: { sha: SHA } },
				},
				[`${GH}/issues/14927/events?per_page=100`]: {
					body: [{ event: "head_ref_force_pushed" }],
				},
				[`${GH}/issues/14927/comments?per_page=100`]: { body: [] },
				[`${GH}/pulls/14927/comments?per_page=100`]: { body: [] },
				"/user": { body: { login: "current-viewer" } },
			},
		});

		await db.pullRequest.create({
			data: {
				investigationId: RUN,
				repositoryId: "repo-cli",
				host: "github",
				repo: "cli/cli",
				url: PR_URL,
				number: 14927,
				source: "agent",
				detail: JSON.stringify({
					own: [{ source: "review_comment", id: 777 }],
				}),
			},
		});

		const shared = await svc.readShared(PR_URL, {});
		expect(shared).not.toBeNull();
		expect(shared?.read.title).toBe("Add guided multi-account setup and evaluation");
		expect(shared?.head).toEqual({
			exists: true,
			sha: SHA,
			forcePushed: true,
		});
		expect(shared?.viewer).toBe("current-viewer");
		expect(shared?.own).toEqual([{ source: "review_comment", id: 777 }]);
	});

	it("returns null when URL matches no stored pull request or has an untrusted remote", async () => {
		const { svc } = setup({ routes: recorded() });
		expect(await svc.readShared("https://github.com/unknown/repo/pull/1", {})).toBeNull();
	});

	it("catches head read failure on headRef and returns null head", async () => {
		const { svc, db } = setup({
			routes: {
				...recorded(),
				[`${GH}/git/ref/heads/williammartin-multiaccount-draft-08-evaluation`]: { status: 500 },
				[`${GH}/issues/14927/events?per_page=100`]: { body: [] },
				[`${GH}/issues/14927/comments?per_page=100`]: { body: [] },
				[`${GH}/pulls/14927/comments?per_page=100`]: { body: [] },
				"/user": { body: { login: "viewer-1" } },
			},
		});

		await db.pullRequest.create({
			data: {
				investigationId: RUN,
				repositoryId: "repo-cli",
				host: "github",
				repo: "cli/cli",
				url: PR_URL,
				number: 14927,
				source: "agent",
			},
		});

		const shared = await svc.readShared(PR_URL, {});
		expect(shared?.head).toBeNull();
	});
});

describe("noteHead", () => {
	it("records remote head reading on workspace repository matching the branch", async () => {
		const { svc } = setup({
			workspace: {
				layout: "single",
				cwd: "/w/matching",
				repos: [
					{
						name: "matching",
						dir: "/w/matching",
						sourceKind: "url",
						url: "https://github.com/cli/cli.git",
						subPath: null,
						connectionId: null,
						head: SHA,
						branch: "feat-match",
						services: [],
					},
					{
						name: "other",
						dir: "/w/other",
						sourceKind: "url",
						url: "https://github.com/cli/cli.git",
						subPath: null,
						connectionId: null,
						head: SHA,
						branch: "feat-other",
						services: [],
					},
				],
			},
		});

		await svc.noteHead(RUN, "feat-match", "cli/cli", {
			exists: true,
			sha: SHA,
			forcePushed: false,
		});

		const match = remoteHeadOf("/w/matching");
		expect(match?.branch).toBe("feat-match");
		expect(match?.remote).toBe("cli/cli");
		expect(match?.exists).toBe(true);
		expect(match?.sha).toBe(SHA);
		expect(match?.forcePushed).toBe(false);
		expect(match?.source).toBe("host");
		expect(typeof match?.at).toBe("number");
		expect(remoteHeadOf("/w/other")).toBeNull();
	});
});

describe("pullRequestView detailView", () => {
	it("omits author, reviewers, and checkRuns when detail has none", () => {
		const view = pullRequestView({
			id: "view-empty-detail",
			investigationId: RUN,
			repositoryId: null,
			host: "github",
			repo: "cli/cli",
			url: PR_URL,
			number: 14927,
			title: "Minimal PR",
			state: "open",
			review: "none",
			checks: "{}",
			conflicts: null,
			detail: JSON.stringify({ body: "description" }),
			source: "agent",
			etag: null,
			fetchedAt: null,
			headSha: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		expect(view.author).toBeUndefined();
		expect(view.reviewers).toBeUndefined();
		expect(view.checkRuns).toBeUndefined();
		expect(view.title).toBe("Minimal PR");
	});
});

describe("D3 log storage and rerun ledger", () => {
	it("does not store credential refusals, and re-reads a stored noAccess or host row", async () => {
		const prRow = {
			investigationId: RUN,
			repositoryId: "repo-cli",
			host: "github",
			repo: "cli/cli",
			url: PR_URL,
			number: 14927,
			source: "agent",
			headSha: SHA,
			detail: JSON.stringify({
				checkRuns: [
					{ id: "run-refusal", name: "auth-check", state: "failing", appId: "15368", headSha: SHA },
				],
			}),
		};

		// 1. Initial read returns 401 (noAccess): should not be stored in checkLogs
		const host401 = fakeHost({
			...recorded(),
			[`${GH}/actions/jobs/run-refusal`]: { status: 401 },
		});
		const setup401 = setup({ fetch: host401.impl });
		const row1 = await setup401.db.pullRequest.create({ data: prRow });

		const log1 = await setup401.svc.checkLog(RUN, row1.id, "run-refusal");
		expect(log1.unavailable).toBe(LOG_UNAVAILABLE.noAccess);

		const rowAfter1 = await setup401.db.pullRequest.findFirst({ where: { id: row1.id } });
		const detail1 = JSON.parse(String(rowAfter1?.detail));
		expect(detail1.checkLogs).toBeUndefined();

		// 2. If a row already had a stored noAccess or host entry, checkLog re-reads from the host
		const host200 = fakeHost({
			...recorded(),
			[`${GH}/actions/jobs/run-refusal`]: {
				body: { steps: [{ name: "Compile", conclusion: "failure" }] },
			},
			[`${GH}/actions/jobs/run-refusal/logs`]: {
				status: 302,
				headers: { location: "https://logs.github.com/run-refusal.log" },
			},
		});
		const customFetch = (async (input: string | URL, init?: RequestInit) => {
			if (String(input).includes("/run-refusal.log")) {
				return new Response("error line\n", { status: 200 });
			}
			return host200.impl(input, init);
		}) as typeof fetch;

		const setup200 = setup({ fetch: customFetch });
		const rowWithStaleRefusal = await setup200.db.pullRequest.create({
			data: {
				...prRow,
				detail: JSON.stringify({
					checkRuns: [
						{ id: "run-refusal", name: "auth-check", state: "failing", appId: "15368", headSha: SHA },
					],
					checkLogs: [
						{
							runId: "run-refusal",
							headSha: SHA,
							step: null,
							lines: [],
							unavailable: LOG_UNAVAILABLE.noAccess,
							fetchedAt: "2026-11-10T00:00:00.000Z",
						},
					],
				}),
			},
		});

		const log2 = await setup200.svc.checkLog(RUN, rowWithStaleRefusal.id, "run-refusal");
		expect(log2.step).toBe("Compile");
		expect(log2.lines).toEqual(["error line"]);
		expect(log2.unavailable).toBeNull();
	});

	it("survives concurrent poll while an entry is sending, and never POSTs while an entry is sending", async () => {
		const prRow = {
			investigationId: RUN,
			repositoryId: "repo-cli",
			host: "github",
			repo: "cli/cli",
			url: PR_URL,
			number: 14927,
			source: "agent",
			headSha: SHA,
			detail: JSON.stringify({
				checkRuns: [
					{
						id: "run-rerun-1",
						name: "ci-check",
						state: "failing",
						appId: "15368",
						headSha: SHA,
						rerunnable: true,
					},
				],
			}),
		};

		let rerunPostCalls = 0;
		const host = fakeHost({
			...recorded(),
			[`${GH}/actions/jobs/run-rerun-1/rerun`]: {
				status: 201,
				body: () => {
					rerunPostCalls++;
					return {};
				},
			},
		});

		const { svc, db } = setup({
			fetch: host.impl,
			// Make sure rerunChecks setting is on
			routes: recorded(),
		});
		db.setting.findUnique = async ({ where }: any) => {
			if (where.key === "threads.context")
				return { key: "threads.context", value: JSON.stringify({ rerunChecks: true, prStatus: true }) };
			return null;
		};

		const row = await db.pullRequest.create({ data: prRow });

		// Start a rerunCheck with a confirmKey: sets sending
		// When rerunCheck executes with sending already in progress for confirmKey, it settles without POST
		await (svc as any).withPrRow(row.id, async (now: any) => {
			await (svc as any).writeRerun(row.id, now, {
				confirmKey: "11111111-1111-4111-8111-111111111111",
				runId: "run-rerun-1",
				ident: "15368::ci-check",
				at: new Date().toISOString(),
				state: "sending",
			});
		});

		// Calling rerunCheck with confirmKey must NOT send a POST
		const resSending = await svc.rerunCheck({
			id: RUN,
			prId: row.id,
			runId: "run-rerun-1",
			confirmKey: "11111111-1111-4111-8111-111111111111",
		});

		expect(rerunPostCalls).toBe(0);
		// If check is still failing and not found as started/pending, it returns unknown failure
		expect(resSending.ok).toBe(false);

		// Now simulate: start a refresh (capturing prev), write 'sending' under lock, finish refresh, entry still there
		await (svc as any).withPrRow(row.id, async (now: any) => {
			await (svc as any).writeRerun(row.id, now, {
				confirmKey: "22222222-2222-4222-8222-222222222222",
				runId: "run-rerun-1",
				ident: "15368::ci-check",
				at: new Date().toISOString(),
				state: "sending",
			});
		});

		await svc.refreshOne(RUN, row.id);

		const rowAfterRefresh = await db.pullRequest.findFirst({ where: { id: row.id } });
		const detailAfter = JSON.parse(String(rowAfterRefresh?.detail));
		expect(detailAfter.reruns).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ confirmKey: "22222222-2222-4222-8222-222222222222", state: "sending" }),
			]),
		);
	});

	it("answers Retry from its ledger (ok or sending entry) even after poll replaced the job", async () => {
		const { svc, db } = setup();
		db.setting.findUnique = async ({ where }: any) => {
			if (where.key === "threads.context")
				return { key: "threads.context", value: JSON.stringify({ rerunChecks: true, prStatus: true }) };
			return null;
		};

		// PR detail has reruns entry with 'ok', but checkRuns does NOT have the old job (it was replaced)
		const row = await db.pullRequest.create({
			data: {
				investigationId: RUN,
				repositoryId: "repo-cli",
				host: "github",
				repo: "cli/cli",
				url: PR_URL,
				number: 14927,
				source: "agent",
				headSha: SHA,
				detail: JSON.stringify({
					checkRuns: [
						{ id: "new-job-2", name: "ci-check", state: "passing", appId: "15368", headSha: SHA },
					],
					reruns: [
						{
							confirmKey: "33333333-3333-4333-8333-333333333333",
							runId: "old-job-1",
							ident: "15368::ci-check",
							at: "2026-11-18T00:00:00.000Z",
							state: "ok",
						},
					],
				}),
			},
		});

		// Calling rerunCheck with the old runId and confirmKey key-retry-1: answers from ledger
		const res = await svc.rerunCheck({
			id: RUN,
			prId: row.id,
			runId: "old-job-1",
			confirmKey: "33333333-3333-4333-8333-333333333333",
		});

		expect(res).toEqual({
			ok: true,
			at: "2026-11-18T00:00:00.000Z",
			already: true,
		});
	});

	it("computes ownPrIds including null headRepo exclusion and matching branch", async () => {
		const { svc } = setup();

		// Mock threadBranches to return live branch
		vi.spyOn(svc, "threadBranches").mockResolvedValue([
			{ branch: "feature-match", repo: "cli/cli" },
		]);

		const prs: any[] = [
			// Valid: open, matching branch, headRepo equals repo
			{ id: "pr-1", state: "open", headRef: "feature-match", headRepo: "cli/cli", repo: "cli/cli" },
			// Null headRepo: excluded
			{ id: "pr-2", state: "open", headRef: "feature-match", headRepo: null, repo: "cli/cli" },
			// Closed PR: excluded
			{ id: "pr-3", state: "closed", headRef: "feature-match", headRepo: "cli/cli", repo: "cli/cli" },
			// Fork branch (headRepo !== repo): excluded
			{ id: "pr-4", state: "open", headRef: "feature-match", headRepo: "fork/cli", repo: "cli/cli" },
			// Different branch: excluded
			{ id: "pr-5", state: "open", headRef: "feature-other", headRepo: "cli/cli", repo: "cli/cli" },
		];

		const own = await svc.ownPrIds(RUN, prs);
		expect(own).toEqual(["pr-1"]);
	});
});
