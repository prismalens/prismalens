// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import { ORPCError } from "@orpc/nest";
import type { FixThreadInput, PullRequest } from "@prismalens/contracts";
import { fakeDb } from "./__fixtures__/fake-db.js";
import { FixThreadsService } from "./fix-threads.service.js";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const PR_ID = "pr-uuid-1";
const PR_URL = "https://github.com/cli/cli/pull/14927";
const HEAD_SHA = "0123456789abcdef0123456789abcdef01234567";

function setupService(opts: {
	prStatus?: boolean;
	prOverrides?: Partial<PullRequest>;
	sourceOverrides?: Record<string, unknown>;
	repositoryOverrides?: Record<string, unknown>;
	pullRequestsServiceMock?: Record<string, unknown>;
	threadsServiceMock?: Record<string, unknown>;
} = {}) {
	const repositories = [
		{
			id: "repo-1",
			fullName: "cli/cli",
			sourceKind: "url",
			url: "https://github.com/cli/cli.git",
			plain: false,
			connectionId: null,
			metadata: null,
			...opts.repositoryOverrides,
		},
	];

	const db = fakeDb({
		settings: [
			{
				key: "threads.context",
				value: JSON.stringify({ prStatus: opts.prStatus ?? true, rerunChecks: true }),
			},
		],
		investigations: [
			{
				id: RUN_ID,
				repositoryId: "repo-1",
				harness: "cli",
				model: "sonnet",
				effort: "medium",
				accessLevel: "operate",
				...opts.sourceOverrides,
			},
		],
		repositories,
	});

	// Add repository.findUnique and investigation.findMany mocks
	(db.repository as any).findUnique = async ({ where }: any) => {
		return repositories.find((r) => r.id === where.id) ?? null;
	};
	(db.investigation as any).findMany = async () => [];

	// Add a dummy job finding mock if not present
	(db as any).job = {
		findUnique: async () => ({ id: "job-1" }),
	};

	const defaultPr: PullRequest = {
		id: PR_ID,
		investigationId: RUN_ID,
		repositoryId: "repo-1",
		host: "github",
		repo: "cli/cli",
		url: PR_URL,
		number: 14927,
		title: "Sample PR",
		state: "open",
		review: "none",
		checks: { state: "failing", total: 1, failed: 1, pending: 0 },
		conflicts: false,
		detail: {},
		source: "agent",
		etag: null,
		fetchedAt: new Date().toISOString(),
		headSha: HEAD_SHA,
		headRef: "feat/sample",
		headRepo: "cli/cli",
		baseRef: "main",
		checkRuns: [
			{
				id: "check-run-1",
				name: "test-run",
				state: "failing",
				appId: "15368",
				headSha: HEAD_SHA,
				rerunnable: true,
			},
		],
		reviewThreads: [
			{
				id: "review-1",
				path: "src/sample.ts",
				line: 10,
				author: "alice",
				resolved: false,
				outdated: false,
				excerpt: "Please fix",
				replies: 0,
			},
		],
		...opts.prOverrides,
	};

	const pullRequestsService = {
		one: vi.fn(async () => defaultPr),
		refreshOne: vi.fn(async () => defaultPr),
		remotes: vi.fn(async () => [
			{
				host: "github.com",
				repo: "cli/cli",
				repositoryId: "repo-1",
				ref: { sourceKind: "url", url: "https://github.com/cli/cli.git" },
			},
		]),
		forgetRemotes: vi.fn(),
		checkLog: vi.fn(async () => ({
			step: "npm test",
			lines: ["error line 1"],
			unavailable: null,
		})),
		ownPrIds: vi.fn(async () => [PR_ID]),
		...opts.pullRequestsServiceMock,
	};

	const threadsService = {
		start: vi.fn(async () => ({
			id: "thread-started-1",
			title: "Fix title",
			link: "/thread/1",
		})),
		...opts.threadsServiceMock,
	};

	const service = new FixThreadsService(
		db as any,
		pullRequestsService as any,
		threadsService as any,
	);

	return { service, db, pullRequestsService, threadsService, defaultPr };
}

describe("FixThreadsService", () => {
	it("refuses no-head when headSha is not 40-64 lowercase hex", async () => {
		const { service } = setupService({
			prOverrides: {
				headSha: "NOT-HEX-OR-UPPERCASE-0123456789ABCDEF0123456789",
			},
		});

		const input: FixThreadInput = {
			id: RUN_ID,
			prId: PR_ID,
			items: [{ kind: "check", runId: "check-run-1" }],
		};

		const preview = await service.preview(input);
		expect(preview.refusal?.reason).toBe("no-head");
		expect(preview.refusal?.detail).toBe("The host hasn't said which commit it's at.");
	});

	it("refuses status-off when prStatus is false", async () => {
		const { service } = setupService({ prStatus: false });
		const preview = await service.preview({
			id: RUN_ID,
			prId: PR_ID,
			items: [{ kind: "check", runId: "check-run-1" }],
		});
		expect(preview.refusal?.reason).toBe("status-off");
	});

	it("refuses closed when PR is closed or merged", async () => {
		const { service } = setupService({ prOverrides: { state: "closed" } });
		const preview = await service.preview({
			id: RUN_ID,
			prId: PR_ID,
			items: [{ kind: "check", runId: "check-run-1" }],
		});
		expect(preview.refusal?.reason).toBe("closed");
	});

	it("refuses fork-branch when headRepo does not match repo", async () => {
		const { service } = setupService({ prOverrides: { headRepo: "other-user/cli" } });
		const preview = await service.preview({
			id: RUN_ID,
			prId: PR_ID,
			items: [{ kind: "check", runId: "check-run-1" }],
		});
		expect(preview.refusal?.reason).toBe("fork-branch");
	});

	it("refuses plain-folder when repository is plain", async () => {
		const { service } = setupService({ repositoryOverrides: { plain: true } });
		const preview = await service.preview({
			id: RUN_ID,
			prId: PR_ID,
			items: [{ kind: "check", runId: "check-run-1" }],
		});
		expect(preview.refusal?.reason).toBe("plain-folder");
	});

	it("refuses not-failing when check is passing", async () => {
		const { service } = setupService({
			prOverrides: {
				checkRuns: [{ id: "check-run-1", name: "test", state: "passing" }],
			},
		});
		const preview = await service.preview({
			id: RUN_ID,
			prId: PR_ID,
			items: [{ kind: "check", runId: "check-run-1" }],
		});
		expect(preview.refusal?.reason).toBe("not-failing");
	});

	it("refuses cancelled when check run was cancelled", async () => {
		const { service } = setupService({
			prOverrides: {
				checkRuns: [{ id: "check-run-1", name: "test", state: "failing", cancelled: true }],
			},
		});
		const preview = await service.preview({
			id: RUN_ID,
			prId: PR_ID,
			items: [{ kind: "check", runId: "check-run-1" }],
		});
		expect(preview.refusal?.reason).toBe("cancelled");
	});

	it("refuses resolved when review thread is resolved", async () => {
		const { service } = setupService({
			prOverrides: {
				reviewThreads: [
					{
						id: "review-1",
						path: "sample.ts",
						line: 1,
						author: "alice",
						resolved: true,
						outdated: false,
						excerpt: "fixed",
						replies: 0,
					},
				],
			},
		});
		const preview = await service.preview({
			id: RUN_ID,
			prId: PR_ID,
			items: [{ kind: "review", reviewThreadId: "review-1" }],
		});
		expect(preview.refusal?.reason).toBe("resolved");
	});

	it("previews fix thread successfully for failing check and review comment", async () => {
		const { service } = setupService();
		const preview = await service.preview({
			id: RUN_ID,
			prId: PR_ID,
			items: [
				{ kind: "check", runId: "check-run-1" },
				{ kind: "review", reviewThreadId: "review-1" },
			],
		});
		expect(preview.refusal).toBeNull();
		expect(preview.items.length).toBe(2);
		expect(preview.digest).toHaveLength(64);
		expect(preview.place?.own).toBe(true);
	});

	it("start starts thread matching preview digest", async () => {
		const { service, threadsService } = setupService();
		const input: FixThreadInput = {
			id: RUN_ID,
			prId: PR_ID,
			items: [{ kind: "check", runId: "check-run-1" }],
		};

		const preview = await service.preview(input);
		expect(preview.digest).not.toBeNull();

		const result = await service.start({
			...input,
			digest: preview.digest as string,
		});

		expect(result).toEqual({
			id: "thread-started-1",
			title: "Fix title",
			link: "/thread/1",
		});
		expect(threadsService.start).toHaveBeenCalledOnce();
	});

	it("start rejects with CONFLICT when digest does not match", async () => {
		const { service } = setupService();
		const input: FixThreadInput = {
			id: RUN_ID,
			prId: PR_ID,
			items: [{ kind: "check", runId: "check-run-1" }],
		};

		await expect(
			service.start({
				...input,
				digest: "0000000000000000000000000000000000000000000000000000000000000000",
			}),
		).rejects.toThrowError(ORPCError);
	});
});
