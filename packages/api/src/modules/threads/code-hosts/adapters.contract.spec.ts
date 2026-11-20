// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A new host adds a fixture file and a line in CONTRACT_FIXTURES,
 * and this suite runs it.
 */

import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedRequestFn } from "@prismalens/integrations";
import { sourceRequestFn } from "../../integrations/source-request.js";
import { fakeHost } from "../__fixtures__/fake-host.js";
import {
	type EtagCache,
	LOG_UNAVAILABLE,
	excerptOf,
	idOf,
	linkOf,
	logTail,
	merged,
	person,
	readLogEnd,
	run,
} from "./common.js";
import { CODE_HOSTS } from "./registry.js";
import { CONTRACT_FIXTURES } from "./__fixtures__/contract.js";

const req = (impl: typeof fetch, base: string) =>
	sourceRequestFn(base, { ok: true, credential: { kind: "none" } }, {
		fetchImpl: impl,
		maxRedirects: 0,
		maxBytes: 1024 * 1024,
	});

describe.each(Object.values(CODE_HOSTS))("$kind code-host adapter contract", (adapter) => {
	const fixture = CONTRACT_FIXTURES[adapter.kind];

	it("registers a fixture with matching kind and terms", () => {
		expect(fixture.kind).toBe(adapter.kind);
		expect(adapter.terms).toEqual(fixture.terms);
	});

	it("maps host to expected apiBase origin", () => {
		expect(adapter.apiBase(fixture.host)).toBe(fixture.apiBase);
	});

	it("parses path segments into repo and number, rebuilds webUrl from webPath, and returns null for another host", () => {
		const segments = new URL(fixture.webUrl).pathname.split("/").filter(Boolean);
		expect(adapter.parsePath(segments)).toEqual(fixture.parsePath);
		const rebuilt = `https://${fixture.host}/${fixture.repo}/${adapter.webPath(fixture.number)}`;
		expect(rebuilt).toBe(fixture.webUrl);
		expect(adapter.parsePath(fixture.otherHostPathSegments)).toBeNull();
	});

	it("reads state, headSha, checks, and reuses cached read sending If-None-Match", async () => {
		const host = fakeHost(fixture.routes());
		const client = req(host.impl, fixture.apiBase);
		const cache: EtagCache = {};
		const first = await adapter.read(client, fixture.repo, fixture.number, cache);
		expect(first.state).toBe(fixture.read.state);
		expect(first.headSha).toBe(fixture.read.headSha);
		expect(first.checks).toEqual(fixture.read.checks);

		const second = await adapter.read(client, fixture.repo, fixture.number, cache);
		expect(second).toEqual(first);
		const secondCalls = host.calls.slice(fixture.secondReadEtags.length);
		expect(secondCalls.map((c) => c.headers["if-none-match"])).toEqual(fixture.secondReadEtags);
	});

	it("reads activity items in order", async () => {
		const host = fakeHost(fixture.routes());
		const client = req(host.impl, fixture.apiBase);
		const items = await adapter.readActivity(client, fixture.repo, fixture.number, {});
		const summary = items.map((i) => ({ source: i.source, id: i.id, login: i.login }));
		expect(summary).toEqual(fixture.activity);
	});

	it("reads review threads returning expected ids and resolved flags", async () => {
		const host = fakeHost(fixture.routes());
		const client = req(host.impl, fixture.apiBase);
		const threads = await adapter.readReviewThreads(
			client,
			fixture.repo,
			fixture.number,
			fixture.apiBase,
		);
		const summary = threads.map((t) => ({ id: t.id, resolved: t.resolved }));
		expect(summary).toEqual(fixture.reviewThreads);
	});

	it("reads check log returning expected step and last line", async () => {
		const host = fakeHost(fixture.routes());
		const client = req(host.impl, fixture.apiBase);
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
		const result = await adapter.readCheckLog(
			{ req: client, apiBase: fixture.apiBase, locate, download },
			fixture.repo,
			fixture.checkRun,
		);
		expect(result.step).toBe(fixture.checkLog.step);
		expect(result.unavailable).toBe(fixture.checkLog.unavailable);
		expect(result.lines.at(-1)).toBe(fixture.checkLog.lastLine);
	});

	it.skipIf(!fixture.statusRun)(
		"returns LOG_UNAVAILABLE.status for a run with no appId when host separates commit statuses",
		async () => {
			const host = fakeHost(fixture.routes());
			const client = req(host.impl, fixture.apiBase);
			const locate = vi.fn();
			const download = vi.fn();
			const result = await adapter.readCheckLog(
				{ req: client, apiBase: fixture.apiBase, locate, download },
				fixture.repo,
				fixture.statusRun!,
			);
			expect(result.step).toBeNull();
			expect(result.lines).toEqual([]);
			expect(result.unavailable).toBe(LOG_UNAVAILABLE.status);
		},
	);

	it("finds change request by branch returning expected URL and returns null on 404", async () => {
		const host = fakeHost(fixture.routes());
		const client = req(host.impl, fixture.apiBase);
		const url = await adapter.findByBranch(client, fixture.repo, fixture.branch);
		expect(url).toBe(fixture.findByBranchUrl);

		const notFoundHost = fakeHost({});
		const notFoundClient = req(notFoundHost.impl, fixture.apiBase);
		const notFound = await adapter.findByBranch(notFoundClient, fixture.repo, fixture.branch);
		expect(notFound).toBeNull();
	});

	it("reads connected viewer login, and returns null when viewer lookup fails", async () => {
		const host = fakeHost(fixture.viewerRoute(fixture.expectedViewer));
		const client = req(host.impl, fixture.apiBase);
		const login = await adapter.readViewer(client, {});
		expect(login).toBe(fixture.expectedViewer);

		const failedHost = fakeHost({});
		const failedClient = req(failedHost.impl, fixture.apiBase);
		const failedLogin = await adapter.readViewer(failedClient, {});
		expect(failedLogin).toBeNull();
	});

	it("reads head ref tip commit and force-pushed flag, returning not found when ref is missing", async () => {
		const host = fakeHost(fixture.headRoute(fixture.headRef, fixture.headSha));
		const client = req(host.impl, fixture.apiBase);
		const head = await adapter.readHead(
			client,
			fixture.repo,
			fixture.number,
			fixture.headRef,
			{},
		);
		expect(head.exists).toBe(true);
		expect(head.sha).toBe(fixture.headSha);
		expect(head.forcePushed).toBe(fixture.headForcePushed);

		const missingHost = fakeHost({});
		const missingClient = req(missingHost.impl, fixture.apiBase);
		const missingHead = await adapter.readHead(
			missingClient,
			fixture.repo,
			fixture.number,
			fixture.headRef,
			{},
		);
		expect(missingHead.exists).toBe(false);
		expect(missingHead.sha).toBeNull();
		expect(missingHead.forcePushed).toBe(false);
	});

	it("posts reply to review thread returning author, excerpt and activity", async () => {
		const host = fakeHost(
			fixture.replyRoute(fixture.replyThreadId, fixture.replyBody),
		);
		const client = req(host.impl, fixture.apiBase);
		const reply = await adapter.replyToReviewThread(
			client,
			fixture.repo,
			fixture.number,
			fixture.replyThreadId,
			fixture.replyBody,
			fixture.apiBase,
		);
		expect(reply).toEqual(fixture.expectedReply);
	});

	it("rejects reply with scope failure on 403 and locked failure when conversation is locked", async () => {
		const scopeHost = fakeHost(
			fixture.replyFailureRoute(403, "Resource not accessible by integration"),
		);
		const scopeClient = req(scopeHost.impl, fixture.apiBase);
		await expect(
			adapter.replyToReviewThread(
				scopeClient,
				fixture.repo,
				fixture.number,
				fixture.replyThreadId,
				fixture.replyBody,
				fixture.apiBase,
			),
		).rejects.toMatchObject({
			failure: "scope",
			status: 403,
			message: "Resource not accessible by integration",
		});

		const lockedHost = fakeHost(
			fixture.replyFailureRoute(423, "Conversation is locked"),
		);
		const lockedClient = req(lockedHost.impl, fixture.apiBase);
		await expect(
			adapter.replyToReviewThread(
				lockedClient,
				fixture.repo,
				fixture.number,
				fixture.replyThreadId,
				fixture.replyBody,
				fixture.apiBase,
			),
		).rejects.toMatchObject({
			failure: "locked",
			status: 423,
			message: "Conversation is locked",
		});
	});

	it("rejects reply with unreachable failure on 500 and rejected failure on 422", async () => {
		const serverErrorHost = fakeHost(
			fixture.replyFailureRoute(500, "Internal server error"),
		);
		const serverErrorClient = req(serverErrorHost.impl, fixture.apiBase);
		await expect(
			adapter.replyToReviewThread(
				serverErrorClient,
				fixture.repo,
				fixture.number,
				fixture.replyThreadId,
				fixture.replyBody,
				fixture.apiBase,
			),
		).rejects.toMatchObject({
			failure: "unreachable",
			status: 500,
			message: "Internal server error",
		});

		const rejectedHost = fakeHost(
			fixture.replyFailureRoute(422, "Validation failed"),
		);
		const rejectedClient = req(rejectedHost.impl, fixture.apiBase);
		await expect(
			adapter.replyToReviewThread(
				rejectedClient,
				fixture.repo,
				fixture.number,
				fixture.replyThreadId,
				fixture.replyBody,
				fixture.apiBase,
			),
		).rejects.toMatchObject({
			failure: "rejected",
			status: 422,
			message: "Validation failed",
		});
	});

	it("rejects reply with unreachable failure when host connection throws", async () => {
		const client: AuthenticatedRequestFn = () => {
			throw new Error("connection reset");
		};
		await expect(
			adapter.replyToReviewThread(
				client,
				fixture.repo,
				fixture.number,
				fixture.replyThreadId,
				fixture.replyBody,
				fixture.apiBase,
			),
		).rejects.toMatchObject({
			failure: "unreachable",
			message: "The git host did not answer.",
		});
	});

	it("returns LOG_UNAVAILABLE.noAccess when check log request answers 401", async () => {
		const host = fakeHost(fixture.checkLogUnauthorizedRoute);
		const client = req(host.impl, fixture.apiBase);
		const locate = vi.fn();
		const download = vi.fn();
		const result = await adapter.readCheckLog(
			{ req: client, apiBase: fixture.apiBase, locate, download },
			fixture.repo,
			fixture.checkRun,
		);
		expect(result.step).toBeNull();
		expect(result.lines).toEqual([]);
		expect(result.unavailable).toBe(LOG_UNAVAILABLE.noAccess);
	});

	it("returns LOG_UNAVAILABLE.gone when check log trace or download answers 404", async () => {
		const host = fakeHost(fixture.checkLogNotFoundRoute);
		const client = req(host.impl, fixture.apiBase);
		const locate = vi.fn(async () => ({ status: 404, location: null }));
		const download = vi.fn(async () => new Response("not found", { status: 404 }));
		const result = await adapter.readCheckLog(
			{ req: client, apiBase: fixture.apiBase, locate, download },
			fixture.repo,
			fixture.checkRun,
		);
		expect(result.lines).toEqual([]);
		expect(result.unavailable).toBe(LOG_UNAVAILABLE.gone);
	});

	it("reads open change request with conflict and required review", async () => {
		const host = fakeHost(fixture.openConflictRoutes);
		const client = req(host.impl, fixture.apiBase);
		const read = await adapter.read(client, fixture.repo, fixture.number, {});
		expect(read.state).toBe("open");
		expect(read.conflicts).toBe(true);
		expect(read.review).toBe("review_required");
	});

	it("reads closed change request with clean merge and review status", async () => {
		const host = fakeHost(fixture.closedCleanRoutes);
		const client = req(host.impl, fixture.apiBase);
		const read = await adapter.read(client, fixture.repo, fixture.number, {});
		expect(read.state).toBe("closed");
		expect(read.conflicts).toBe(false);
		expect(read.review).toBe(fixture.closedReviewStatus);
	});

	it("reads review threads including reply count and latest response details", async () => {
		const host = fakeHost(fixture.threadedReviewRoutes);
		const client = req(host.impl, fixture.apiBase);
		const threads = await adapter.readReviewThreads(
			client,
			fixture.repo,
			fixture.number,
			fixture.apiBase,
		);
		expect(threads[0].replies).toBe(1);
		expect(threads[0].last).toEqual(fixture.expectedThreadLast);
	});

	it("reads activity items mapping review verdicts and skipping system entries", async () => {
		const host = fakeHost(fixture.verdictActivityRoutes);
		const client = req(host.impl, fixture.apiBase);
		const items = await adapter.readActivity(
			client,
			fixture.repo,
			fixture.number,
			{},
		);
		const mapped = items.map((i) => ({
			source: i.source,
			id: i.id,
			...(i.verdict ? { verdict: i.verdict } : {}),
		}));
		expect(mapped).toEqual(fixture.expectedVerdictActivity);
	});

	it.skipIf(adapter.kind !== "github")(
		"rejects GraphQL reply with scope, locked, or rejected failure from GraphQL errors payload",
		async () => {
			const scopeHost = fakeHost({
				"/graphql": {
					body: {
						errors: [
							{
								type: "INSUFFICIENT_SCOPES",
								message: "Resource not accessible by integration",
							},
						],
					},
				},
			});
			const scopeClient = req(scopeHost.impl, fixture.apiBase);
			await expect(
				adapter.replyToReviewThread(
					scopeClient,
					fixture.repo,
					fixture.number,
					fixture.replyThreadId,
					fixture.replyBody,
					fixture.apiBase,
				),
			).rejects.toMatchObject({
				failure: "scope",
				message: "Resource not accessible by integration",
			});

			const customLockedHost = fakeHost({
				"/graphql": {
					body: {
						errors: [
							{
								type: "UNPROCESSABLE",
								message: "Conversation was locked by owner",
							},
						],
					},
				},
			});
			const customLockedClient = req(customLockedHost.impl, fixture.apiBase);
			await expect(
				adapter.replyToReviewThread(
					customLockedClient,
					fixture.repo,
					fixture.number,
					fixture.replyThreadId,
					fixture.replyBody,
					fixture.apiBase,
				),
			).rejects.toMatchObject({
				failure: "locked",
				message: "Conversation was locked by owner",
			});

			const rejectedHost = fakeHost({
				"/graphql": {
					body: {
						errors: [
							{
								type: "UNPROCESSABLE",
								message: "Validation error on body",
							},
						],
					},
				},
			});
			const rejectedClient = req(rejectedHost.impl, fixture.apiBase);
			await expect(
				adapter.replyToReviewThread(
					rejectedClient,
					fixture.repo,
					fixture.number,
					fixture.replyThreadId,
					fixture.replyBody,
					fixture.apiBase,
				),
			).rejects.toMatchObject({
				failure: "rejected",
				message: "Validation error on body",
			});
		},
	);

	it.skipIf(adapter.kind !== "github")(
		"falls back to check-run output and annotations when actions job is not found",
		async () => {
			const host = fakeHost({
				"/repos/cli/cli/actions/jobs/run-custom": { status: 404 },
				"/repos/cli/cli/check-runs/run-custom": {
					body: {
						output: {
							title: "Linter step",
							summary: "Found style issues",
						},
					},
				},
				"/repos/cli/cli/check-runs/run-custom/annotations": {
					body: [
						{
							path: "src/cli.ts",
							start_line: 10,
							message: "Trailing whitespace",
						},
					],
				},
			});
			const client = req(host.impl, fixture.apiBase);
			const locate = vi.fn();
			const download = vi.fn();
			const result = await adapter.readCheckLog(
				{ req: client, apiBase: fixture.apiBase, locate, download },
				fixture.repo,
				{
					id: "run-custom",
					appId: "custom-app",
					name: "lint",
					state: "failing",
				},
			);
			expect(result.step).toBe("Linter step");
			expect(result.lines).toEqual([
				"Found style issues",
				"src/cli.ts:10 Trailing whitespace",
			]);
			expect(result.unavailable).toBeNull();
		},
	);

	it.skipIf(adapter.kind !== "github")(
		"routes review thread operations to parent graphql path on enterprise host",
		async () => {
			const enterpriseBase = "https://ghe.local/api/v3";
			const host = fakeHost({
				"/api/graphql": {
					body: {
						data: {
							repository: {
								pullRequest: {
									reviewThreads: {
										nodes: [
											{
												id: "ghe-thread-1",
												isResolved: false,
												isOutdated: false,
												path: "src/index.ts",
												line: 20,
												comments: {
													totalCount: 1,
													nodes: [
														{
															author: { login: "ghe-user" },
															body: "Review note",
															url: "https://ghe.local/cli/cli/pull/1#r1",
														},
													],
												},
											},
										],
									},
								},
							},
							addPullRequestReviewThreadReply: {
								comment: {
									databaseId: 701,
									author: { login: "ghe-user" },
									body: "Addressed",
									url: "https://ghe.local/cli/cli/pull/1#r2",
								},
							},
						},
					},
				},
			});
			const client = req(host.impl, enterpriseBase);
			const threads = await adapter.readReviewThreads(
				client,
				fixture.repo,
				fixture.number,
				enterpriseBase,
			);
			expect(threads.map((t) => ({ id: t.id, resolved: t.resolved }))).toEqual([
				{ id: "ghe-thread-1", resolved: false },
			]);

			const reply = await adapter.replyToReviewThread(
				client,
				fixture.repo,
				fixture.number,
				"ghe-thread-1",
				"Addressed",
				enterpriseBase,
			);
			expect(reply.author).toBe("ghe-user");
			expect(reply.excerpt).toBe("Addressed");
			expect(reply.url).toBe("https://ghe.local/cli/cli/pull/1#r2");
		},
	);

	it.skipIf(adapter.kind !== "gitlab")(
		"swallows not found error on approvals endpoint leaving review state unknown",
		async () => {
			const host = fakeHost({
				"/api/v4/projects/gitlab-org%2Fcli/merge_requests/1500": {
					body: {
						title: "MR without approvals API",
						state: "opened",
						source_branch: "feat",
						target_branch: "main",
						head_pipeline: { id: 10, status: "success" },
					},
				},
				"/api/v4/projects/gitlab-org%2Fcli/merge_requests/1500/approvals": {
					status: 404,
				},
				"/api/v4/projects/gitlab-org%2Fcli/pipelines/10/jobs?per_page=100": {
					body: [],
				},
			});
			const client = req(host.impl, fixture.apiBase);
			const read = await adapter.read(client, fixture.repo, fixture.number, {});
			expect(read.review).toBe("unknown");
			expect(read.state).toBe("open");
		},
	);

	it.skipIf(adapter.kind !== "gitlab")(
		"overrides checks state based on pipeline status when jobs do not reflect it",
		async () => {
			const failingPipelineHost = fakeHost({
				"/api/v4/projects/gitlab-org%2Fcli/merge_requests/1500": {
					body: {
						title: "MR with failed pipeline",
						state: "opened",
						head_pipeline: { id: 11, status: "failed" },
					},
				},
				"/api/v4/projects/gitlab-org%2Fcli/pipelines/11/jobs?per_page=100": {
					body: [{ id: 1, name: "job1", status: "success" }],
				},
			});
			const failingClient = req(failingPipelineHost.impl, fixture.apiBase);
			const failingRead = await adapter.read(failingClient, fixture.repo, fixture.number, {});
			expect(failingRead.checks.state).toBe("failing");

			const runningPipelineHost = fakeHost({
				"/api/v4/projects/gitlab-org%2Fcli/merge_requests/1500": {
					body: {
						title: "MR with running pipeline",
						state: "opened",
						head_pipeline: { id: 12, status: "running" },
					},
				},
				"/api/v4/projects/gitlab-org%2Fcli/pipelines/12/jobs?per_page=100": {
					body: [{ id: 2, name: "job2", status: "success" }],
				},
			});
			const runningClient = req(runningPipelineHost.impl, fixture.apiBase);
			const runningRead = await adapter.read(runningClient, fixture.repo, fixture.number, {});
			expect(runningRead.checks.state).toBe("pending");
		},
	);
});

describe("code-host common utilities", () => {
	it("creates person profile dropping non-https and email-hash avatars", () => {
		expect(person(null, null)).toBeUndefined();
		expect(person("alice", "http://insecure.example.com/avatar.png")).toEqual({ login: "alice" });
		expect(person("alice", "https://gravatar.com/avatar/abc")).toEqual({ login: "alice" });
		expect(person("alice", "https://example.com/alice.png")).toEqual({
			login: "alice",
			avatarUrl: "https://example.com/alice.png",
		});
	});

	it("extracts identifier from string or number and returns undefined for invalid values", () => {
		expect(idOf(123)).toBe("123");
		expect(idOf("job-456")).toBe("job-456");
		expect(idOf(null)).toBeUndefined();
		expect(idOf("")).toBeUndefined();
	});

	it("extracts web url for valid protocols and drops invalid links", () => {
		expect(linkOf("https://example.com/run/1")).toBe("https://example.com/run/1");
		expect(linkOf("http://example.com/run/1")).toBe("http://example.com/run/1");
		expect(linkOf("ftp://example.com/run/1")).toBeUndefined();
		expect(linkOf("not-a-url")).toBeUndefined();
		expect(linkOf(null)).toBeUndefined();
	});

	it("builds check run with default name and identity properties", () => {
		const fallback = run(null, "failing");
		expect(fallback.name).toBe("check");
		expect(fallback.state).toBe("failing");

		const identified = run("custom-check", "passing", "app", undefined, {
			id: "check-1",
			appId: "app-1",
			headSha: "abcdef123456",
			url: "https://example.com/run/check-1",
		});
		expect(identified.name).toBe("custom-check");
		expect(identified.state).toBe("passing");
		expect(identified.appName).toBe("app");
		expect(identified.id).toBe("check-1");
		expect(identified.appId).toBe("app-1");
		expect(identified.headSha).toBe("abcdef123456");
		expect(identified.url).toBe("https://example.com/run/check-1");
	});

	it("marks merged checks unknown when a source fails or is absent beside passing checks", () => {
		const failedSource = merged({ kind: "failed" });
		expect(failedSource.checks.state).toBe("unknown");

		const absentSource = merged(
			{
				kind: "ok",
				value: {
					checks: { state: "passing", total: 1, failed: 0, pending: 0 },
					runs: [{ name: "build", state: "passing" }],
				},
			},
			{ kind: "absent" },
		);
		expect(absentSource.checks.state).toBe("unknown");
	});

	it("formats excerpt normalizing newlines and trimming whitespace", () => {
		expect(excerptOf(null)).toBe("");
		expect(excerptOf("  first line\r\nsecond line  ")).toBe("first line\nsecond line");
	});

	it("trims log tail lines ending after error markers", () => {
		const log = "step 1\nstep 2\n##[error]Task failed\npost 1\npost 2\npost 3\npost 4";
		const lines = logTail(log, 10, true);
		expect(lines).toEqual(["step 1", "step 2", "##[error]Task failed", "post 1", "post 2"]);
	});

	it("reads log end retaining keep buffer size and handles empty response body", async () => {
		const emptyRes = new Response(null);
		const emptyText = await readLogEnd(emptyRes);
		expect(emptyText).toBe("");

		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode("first chunk of data\n"));
				controller.enqueue(new TextEncoder().encode("second chunk of data\n"));
				controller.enqueue(new TextEncoder().encode("third chunk of data\n"));
				controller.close();
			},
		});
		const res = new Response(stream);
		const retained = await readLogEnd(res, 20);
		expect(retained).toBe("third chunk of data\n");
	});
});
