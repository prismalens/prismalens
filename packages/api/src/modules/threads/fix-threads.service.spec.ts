// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi, beforeEach } from "vitest";
import { ORPCError } from "@orpc/nest";
import type { FixThreadInput, PullRequest } from "@prismalens/contracts";
import type { PrismaService } from "../../core/prisma/prisma.service.js";
import { FixThreadsService } from "./fix-threads.service.js";
import type { PullRequestsService } from "./pull-requests.service.js";
import type { ThreadsService } from "./threads.service.js";
import * as fixGit from "./fix-git.js";
import { fixActionId } from "./fix-seed.js";

vi.mock("./fix-git.js", () => ({
	checkRef: vi.fn(async () => true),
	fetchHead: vi.fn(async () => ({ ok: true })),
	hasCommit: vi.fn(async () => true),
	pushUrls: vi.fn(async () => []),
}));

const THREAD_ID = "11111111-1111-4111-8111-111111111111";
const PR_ID = "22222222-2222-4222-8222-222222222222";
const HEAD_SHA = "0123456789abcdef0123456789abcdef01234567";
const REPO_ID = "repo-uuid-1";

const defaultPr = {
	id: PR_ID,
	host: "github" as const,
	url: "https://github.com/prismalens/prismalens/pull/10",
	repo: "prismalens/prismalens",
	number: 10,
	title: "Fix bug",
	state: "open" as const,
	review: "none" as const,
	checks: "failing" as const,
	conflicts: false,
	tone: "warn" as const,
	headSha: HEAD_SHA,
	headRef: "feat/bugfix",
	headRepo: "prismalens/prismalens",
	baseRef: "main",
	checkRuns: [
		{
			id: "run-1",
			name: "unit-tests",
			state: "failing" as const,
			appName: "GitHub Actions",
			group: "123",
			url: "https://github.com/prismalens/prismalens/actions/runs/123",
		},
	],
	reviewThreads: [
		{
			id: "review-1",
			path: "src/main.ts",
			line: 42,
			author: "alice",
			excerpt: "Please fix this",
			resolved: false,
			outdated: false,
			replies: 0,
		},
	],
} as unknown as PullRequest;

function setupService(overrides: {
	prStatus?: boolean;
	sourceThread?: Record<string, unknown> | null;
	pr?: PullRequest | null;
	refreshedPr?: PullRequest | null;
	remotes?: Array<{ host: string; repo: string; repositoryId: string }>;
	project?: Record<string, unknown> | null;
	jobs?: Array<{ id: string; investigationId: string }>;
	pullRequests?: Array<{ id: string; url: string; investigationId: string }>;
	children?: Array<Record<string, unknown>>;
	checkLog?: { step: string | null; lines: string[]; unavailable: string | null };
} = {}) {
	const sourceThread =
		overrides.sourceThread !== undefined
			? overrides.sourceThread
			: {
					id: THREAD_ID,
					repositoryId: REPO_ID,
					harness: "claude",
					model: "opus",
					effort: "high",
					accessLevel: "supervised",
				};

	let currentPr = overrides.pr !== undefined ? overrides.pr : defaultPr;

	const pullRequestsList = overrides.pullRequests ?? [
		{ id: PR_ID, url: currentPr?.url ?? "https://github.com/prismalens/prismalens/pull/10", investigationId: THREAD_ID },
	];

	const childrenList = overrides.children ?? [];
	const jobsList = overrides.jobs ?? [];

	const prisma = {
		setting: {
			findUnique: vi.fn(async ({ where }: { where: { key: string } }) => {
				if (where.key === "threads.context") {
					return {
						key: "threads.context",
						value: JSON.stringify({ prStatus: overrides.prStatus ?? true }),
					};
				}
				return null;
			}),
		},
		investigation: {
			findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
				if (where.id === THREAD_ID) return sourceThread;
				return null;
			}),
			findMany: vi.fn(async ({ where }: any) => {
				return childrenList.filter((c: any) => {
					if (where?.parentId?.in && !where.parentId.in.includes(c.parentId)) return false;
					const trPrefix = (where?.triggerReason as { startsWith?: string } | undefined)?.startsWith;
					if (trPrefix && !c.triggerReason?.startsWith(trPrefix)) return false;
					return true;
				});
			}),
			updateMany: vi.fn(async ({ where, data }: any) => {
				let count = 0;
				for (const c of childrenList) {
					if (where.id === c.id) {
						Object.assign(c, data);
						count++;
					}
				}
				return { count };
			}),
		},
		repository: {
			findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
				if (overrides.project !== undefined) return overrides.project;
				return {
					id: REPO_ID,
					fullName: "prismalens/prismalens",
					sourceKind: "folder",
					plain: false,
					url: "/path/to/repo",
				};
			}),
		},
		pullRequest: {
			findMany: vi.fn(async ({ where }: any) => {
				return pullRequestsList.filter((p) => !where.url || p.url === where.url);
			}),
		},
		job: {
			findUnique: vi.fn(async ({ where }: { where: { investigationId: string } }) => {
				return jobsList.find((j) => j.investigationId === where.investigationId) ?? null;
			}),
		},
	};

	const pullRequestsService = {
		one: vi.fn(async (tid: string, pid: string) => currentPr),
		refreshOne: vi.fn(async (tid: string, pid: string) => {
			if (overrides.refreshedPr !== undefined) {
				currentPr = overrides.refreshedPr;
				return overrides.refreshedPr;
			}
			return currentPr;
		}),
		remotes: vi.fn(async () => overrides.remotes ?? [
			{ host: "github.com", repo: "prismalens/prismalens", repositoryId: REPO_ID },
		]),
		forgetRemotes: vi.fn(),
		ownPrIds: vi.fn(async () => [PR_ID]),
		checkLog: vi.fn(async () => overrides.checkLog ?? { step: "test", lines: ["error line 1"], unavailable: null }),
	};

	const threadsService = {
		start: vi.fn(async (opts?: any, placement?: any) => ({ investigation: { id: "new-thread-id" } })),
	};

	const service = new FixThreadsService(
		prisma as unknown as PrismaService,
		pullRequestsService as unknown as PullRequestsService,
		threadsService as unknown as ThreadsService,
	);

	return { service, prisma, pullRequestsService, threadsService, basePr: defaultPr, childrenList };
}

describe("FixThreadsService: Refusals in spec order (#1176 D4)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("1. status-off: when prStatus is false in settings", async () => {
		const { service } = setupService({ prStatus: false });
		const preview = await service.preview({ id: THREAD_ID, prId: PR_ID, items: [{ kind: "check", runId: "run-1" }] });
		expect(preview.refusal).toEqual({
			reason: "status-off",
			detail: "Pull request status is off in Settings.",
		});
	});

	it("2. closed: when PR is not open or draft (e.g. closed or merged)", async () => {
		const { service } = setupService({
			pr: { ...defaultPr, state: "closed" },
		});
		const preview = await service.preview({ id: THREAD_ID, prId: PR_ID, items: [{ kind: "check", runId: "run-1" }] });
		expect(preview.refusal?.reason).toBe("closed");
	});

	it("3. no-head: when headSha or headRef is missing", async () => {
		const { service } = setupService({
			pr: { ...defaultPr, headSha: null },
		});
		const preview = await service.preview({ id: THREAD_ID, prId: PR_ID, items: [{ kind: "check", runId: "run-1" }] });
		expect(preview.refusal?.reason).toBe("no-head");
	});

	it("4.1 fork-branch: a null headRepo is re-read once, then refuses if still null", async () => {
		const { service, pullRequestsService } = setupService({
			pr: { ...defaultPr, headRepo: undefined },
			refreshedPr: { ...defaultPr, headRepo: undefined },
		});
		const preview = await service.preview({ id: THREAD_ID, prId: PR_ID, items: [{ kind: "check", runId: "run-1" }] });
		expect(pullRequestsService.refreshOne).toHaveBeenCalledWith(THREAD_ID, PR_ID);
		expect(preview.refusal).toEqual({
			reason: "fork-branch",
			detail: "Can't tell which repository the branch is in.",
		});
	});

	it("4.2 fork-branch: when refreshed headRepo succeeds, refusal is averted", async () => {
		const { service, pullRequestsService } = setupService({
			pr: { ...defaultPr, headRepo: undefined },
			refreshedPr: { ...defaultPr, headRepo: "prismalens/prismalens" },
		});
		const preview = await service.preview({ id: THREAD_ID, prId: PR_ID, items: [{ kind: "check", runId: "run-1" }] });
		expect(pullRequestsService.refreshOne).toHaveBeenCalledWith(THREAD_ID, PR_ID);
		expect(preview.refusal).toBeNull();
	});

	it("4.3 fork-branch: headRepo !== pr.repo", async () => {
		const { service } = setupService({
			pr: { ...defaultPr, headRepo: "forkowner/prismalens" },
		});
		const preview = await service.preview({ id: THREAD_ID, prId: PR_ID, items: [{ kind: "check", runId: "run-1" }] });
		expect(preview.refusal?.reason).toBe("fork-branch");
		expect(preview.refusal?.detail).toBe("Its branch is in another repository.");
	});

	it("5.1 no-project: when no remote matches the PR", async () => {
		const { service } = setupService({
			remotes: [],
		});
		const preview = await service.preview({ id: THREAD_ID, prId: PR_ID, items: [{ kind: "check", runId: "run-1" }] });
		expect(preview.refusal?.reason).toBe("no-project");
	});

	it("5.2 plain-folder: when project repository is plain (no git)", async () => {
		const { service } = setupService({
			project: {
				id: REPO_ID,
				fullName: "prismalens/prismalens",
				sourceKind: "folder",
				plain: true,
				url: "/plain/dir",
			},
		});
		const preview = await service.preview({ id: THREAD_ID, prId: PR_ID, items: [{ kind: "check", runId: "run-1" }] });
		expect(preview.refusal?.reason).toBe("plain-folder");
	});

	it("5.3 no-project: when remote repo fails charset safeRepo", async () => {
		const { service } = setupService({
			remotes: [{ host: "github.com", repo: "../unsafe/repo", repositoryId: REPO_ID }],
		});
		const preview = await service.preview({ id: THREAD_ID, prId: PR_ID, items: [{ kind: "check", runId: "run-1" }] });
		expect(preview.refusal?.reason).toBe("no-project");
	});

	it("6.1 not-failing: check is not failing", async () => {
		const { service } = setupService({
			pr: {
				...defaultPr,
				checkRuns: [{ id: "run-1", name: "build", state: "passing" }],
			},
		});
		const preview = await service.preview({ id: THREAD_ID, prId: PR_ID, items: [{ kind: "check", runId: "run-1" }] });
		expect(preview.refusal?.reason).toBe("not-failing");
	});

	it("6.2 cancelled: check is cancelled", async () => {
		const { service } = setupService({
			pr: {
				...defaultPr,
				checkRuns: [{ id: "run-1", name: "build", state: "failing", cancelled: true }],
			},
		});
		const preview = await service.preview({ id: THREAD_ID, prId: PR_ID, items: [{ kind: "check", runId: "run-1" }] });
		expect(preview.refusal?.reason).toBe("cancelled");
	});

	it("6.3 resolved: review comment is resolved", async () => {
		const { service } = setupService({
			pr: {
				...defaultPr,
				reviewThreads: [
					{
						id: "rev-1",
						path: "file.ts",
						line: 1,
						author: "bob",
						excerpt: "note",
						resolved: true,
						outdated: false,
						replies: 0,
					},
				],
			},
		});
		const preview = await service.preview({ id: THREAD_ID, prId: PR_ID, items: [{ kind: "review", reviewThreadId: "rev-1" }] });
		expect(preview.refusal?.reason).toBe("resolved");
	});

	it("7. missing-commit: folder lacks commit, PR re-read once, and ref is not safe", async () => {
		vi.mocked(fixGit.hasCommit).mockResolvedValue(false);
		vi.mocked(fixGit.checkRef).mockResolvedValue(false);
		const { service, pullRequestsService } = setupService({
			pr: { ...defaultPr, headRef: "invalid..ref" },
		});
		const preview = await service.preview({ id: THREAD_ID, prId: PR_ID, items: [{ kind: "check", runId: "run-1" }] });
		expect(pullRequestsService.refreshOne).toHaveBeenCalledWith(THREAD_ID, PR_ID);
		expect(preview.refusal?.reason).toBe("missing-commit");
	});
});

describe("FixThreadsService: Push URL, workspace method, and coverage states (#1176 D4)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(fixGit.hasCommit).mockResolvedValue(true);
		vi.mocked(fixGit.checkRef).mockResolvedValue(true);
	});

	it("a clone-method workspace gives push none", async () => {
		const { service } = setupService({
			project: {
				id: REPO_ID,
				fullName: "prismalens/prismalens",
				sourceKind: "url", // URL repository uses clone method
				plain: false,
				url: "https://github.com/prismalens/prismalens.git",
			},
		});
		const preview = await service.preview({ id: THREAD_ID, prId: PR_ID, items: [{ kind: "check", runId: "run-1" }] });
		expect(preview.refusal).toBeNull();
		expect(preview.place?.push).toBe("none");
		expect(preview.place?.pushNote).toBe("clone");
		expect(preview.place?.pushUrl).toBeNull();
	});

	it("a push URL carrying userinfo is shown stripped", async () => {
		vi.mocked(fixGit.pushUrls).mockResolvedValue([
			"https://token:secret123@github.com/prismalens/prismalens.git",
		]);
		const { service } = setupService();
		const preview = await service.preview({ id: THREAD_ID, prId: PR_ID, items: [{ kind: "check", runId: "run-1" }] });
		expect(preview.place?.push).toBe("branch");
		expect(preview.place?.pushUrl).toBe("https://github.com/prismalens/prismalens.git");
		expect(preview.place?.pushUrl).not.toContain("secret123");
	});

	it("coverage states: admitted, young unadmitted, stale and released", async () => {
		vi.useFakeTimers();
		try {
			const now = new Date("2026-11-18T12:00:00.000Z");
			vi.setSystemTime(now);

			const fixReason = fixActionId({
				prId: PR_ID,
				headSha: HEAD_SHA,
				items: [{ kind: "check", ident: "status:123:unit-tests" }],
			});

			const admittedChildId = "admitted-child";
			const youngChildId = "young-child";
			const staleChildId = "stale-child";

			const children = [
				// Admitted: has job
				{
					id: admittedChildId,
					parentId: THREAD_ID,
					title: "Fix tests",
					status: "running",
					harness: "claude",
					triggerReason: `action:${fixReason}`,
					createdAt: new Date(now.getTime() - 100_000),
					completedAt: null,
				},
				// Young unadmitted: no job, < 60s
				{
					id: youngChildId,
					parentId: THREAD_ID,
					title: "Fix tests young",
					status: "running",
					harness: "claude",
					triggerReason: `action:${fixReason}`,
					createdAt: new Date(now.getTime() - 30_000),
					completedAt: null,
				},
				// Stale: no job, > 60s
				{
					id: staleChildId,
					parentId: THREAD_ID,
					title: "Fix tests stale",
					status: "running",
					harness: "claude",
					triggerReason: `action:${fixReason}`,
					createdAt: new Date(now.getTime() - 90_000),
					completedAt: null,
				},
			];

			const jobs = [{ id: "job-1", investigationId: admittedChildId }];

			const { service } = setupService({
				children,
				jobs,
			});

			const preview = await service.preview({ id: THREAD_ID, prId: PR_ID, items: [{ kind: "check", runId: "run-1" }] });
			expect(preview.covered).toHaveLength(1);
			expect(preview.covered[0]?.ident).toBe("status:123:unit-tests");
			// Newest covering link wins
			expect(preview.covered[0]?.link.id).toBe(admittedChildId);
			expect(preview.items).toHaveLength(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it("coverage spans every PR row with the same URL across threads", async () => {
		const fixReason = fixActionId({
			prId: "other-thread-pr-id",
			headSha: HEAD_SHA,
			items: [{ kind: "check", ident: "status:123:unit-tests" }],
		});

		const otherThreadId = "other-thread-id";
		const fixChildId = "fix-started-from-other-thread";

		const pullRequests = [
			{ id: PR_ID, url: "https://github.com/prismalens/prismalens/pull/10", investigationId: THREAD_ID },
			{ id: "other-thread-pr-id", url: "https://github.com/prismalens/prismalens/pull/10", investigationId: otherThreadId },
		];

		const children = [
			{
				id: fixChildId,
				parentId: otherThreadId,
				title: "Fix from other thread",
				status: "running",
				harness: "claude",
				triggerReason: `action:${fixReason}`,
				createdAt: new Date(),
				completedAt: null,
			},
		];

		const jobs = [{ id: "job-x", investigationId: fixChildId }];

		const { service } = setupService({
			pullRequests,
			children,
			jobs,
		});

		// Check finding in thread THREAD_ID
		const preview = await service.preview({ id: THREAD_ID, prId: PR_ID, items: [{ kind: "check", runId: "run-1" }] });
		expect(preview.covered).toHaveLength(1);
		expect(preview.covered[0]?.link.id).toBe(fixChildId);
		expect(preview.items).toHaveLength(0);
	});

	it("an admitted fix thread that failed no longer covers and appears in failed list", async () => {
		const fixReason = fixActionId({
			prId: PR_ID,
			headSha: HEAD_SHA,
			items: [{ kind: "check", ident: "status:123:unit-tests" }],
		});

		const failedChildId = "failed-child";
		const children = [
			{
				id: failedChildId,
				parentId: THREAD_ID,
				title: "Fix failed",
				status: "failed",
				harness: "claude",
				triggerReason: `action:${fixReason}`,
				createdAt: new Date(),
				completedAt: new Date(),
			},
		];
		const jobs = [{ id: "job-fail", investigationId: failedChildId }];

		const { service } = setupService({
			children,
			jobs,
		});

		const preview = await service.preview({ id: THREAD_ID, prId: PR_ID, items: [{ kind: "check", runId: "run-1" }] });
		expect(preview.covered).toHaveLength(0);
		expect(preview.items).toHaveLength(1);
		expect(preview.failed).toHaveLength(1);
		expect(preview.failed[0]?.id).toBe(failedChildId);
	});
});

describe("FixThreadsService: Start flow, fetch, locking, and recovery (#1176 D7)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(fixGit.hasCommit).mockResolvedValue(true);
		vi.mocked(fixGit.checkRef).mockResolvedValue(true);
		vi.mocked(fixGit.fetchHead).mockResolvedValue({ ok: true });
	});

	it("fetch success: calls fetchHead when fetch is true", async () => {
		// Mock hasCommit: false on check, false on re-read, true after fetch
		vi.mocked(fixGit.hasCommit).mockImplementation(async (folder, sha) => {
			// true after fetchHead has been called
			return vi.mocked(fixGit.fetchHead).mock.calls.length > 0;
		});

		const { service } = setupService();
		const preview = await service.preview({ id: THREAD_ID, prId: PR_ID, items: [{ kind: "check", runId: "run-1" }] });
		expect(preview.place?.fetch).toBe(true);

		await service.start({
			id: THREAD_ID,
			prId: PR_ID,
			items: [{ kind: "check", runId: "run-1" }],
			digest: preview.digest!,
		});

		expect(fixGit.fetchHead).toHaveBeenCalledWith("/path/to/repo", "feat/bugfix");
	});

	it("fetch failure: throws BAD_REQUEST with stderr detail", async () => {
		vi.mocked(fixGit.hasCommit).mockResolvedValue(false);
		vi.mocked(fixGit.fetchHead).mockResolvedValue({ ok: false, stderr: "fatal: remote error" });

		const { service } = setupService();
		const preview = await service.preview({ id: THREAD_ID, prId: PR_ID, items: [{ kind: "check", runId: "run-1" }] });
		expect(preview.place?.fetch).toBe(true);

		await expect(
			service.start({
				id: THREAD_ID,
				prId: PR_ID,
				items: [{ kind: "check", runId: "run-1" }],
				digest: preview.digest!,
			}),
		).rejects.toThrow("Couldn't fetch the branch");
	});

	it("still-missing after fetch re-reads PR before CONFLICT", async () => {
		vi.mocked(fixGit.hasCommit).mockResolvedValue(false);
		vi.mocked(fixGit.fetchHead).mockResolvedValue({ ok: true });

		const { service, pullRequestsService } = setupService();
		const preview = await service.preview({ id: THREAD_ID, prId: PR_ID, items: [{ kind: "check", runId: "run-1" }] });

		await expect(
			service.start({
				id: THREAD_ID,
				prId: PR_ID,
				items: [{ kind: "check", runId: "run-1" }],
				digest: preview.digest!,
			}),
		).rejects.toThrow("It changed; review again");

		expect(pullRequestsService.refreshOne).toHaveBeenCalledWith(THREAD_ID, PR_ID);
	});

	it("concurrent single and batch Start make one thread per finding; lock keys on PR URL + head SHA", async () => {
		const { service, threadsService, childrenList } = setupService();
		const preview = await service.preview({ id: THREAD_ID, prId: PR_ID, items: [{ kind: "check", runId: "run-1" }] });

		threadsService.start.mockImplementation(async (opts, placement) => {
			const id = "started-thread-id";
			childrenList.push({
				id,
				parentId: placement.parentId,
				title: placement.title,
				status: "running",
				harness: "claude",
				triggerReason: `action:${placement.actionId}`,
				createdAt: new Date(),
				completedAt: null,
			});
			return { investigation: { id } };
		});

		// Two starts with the same input at the same time
		const start1 = service.start({
			id: THREAD_ID,
			prId: PR_ID,
			items: [{ kind: "check", runId: "run-1" }],
			digest: preview.digest!,
		});
		const start2 = service.start({
			id: THREAD_ID,
			prId: PR_ID,
			items: [{ kind: "check", runId: "run-1" }],
			digest: preview.digest!,
		});

		// Both are serialized by PR URL + head SHA; the second sees the newly created thread in coverage (young unadmitted) and conflicts
		const results = await Promise.allSettled([start1, start2]);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
		expect(threadsService.start).toHaveBeenCalledTimes(1);
	});

	it("a batch excludes covered items", async () => {
		const fixReason = fixActionId({
			prId: PR_ID,
			headSha: HEAD_SHA,
			items: [{ kind: "check", ident: "status:123:unit-tests" }],
		});

		const coveredChildId = "covered-child";
		const children = [
			{
				id: coveredChildId,
				parentId: THREAD_ID,
				title: "Fix unit-tests",
				status: "running",
				harness: "claude",
				triggerReason: `action:${fixReason}`,
				createdAt: new Date(),
				completedAt: null,
			},
		];
		const jobs = [{ id: "job-c", investigationId: coveredChildId }];

		const { service } = setupService({
			children,
			jobs,
		});

		// Preview batch with check (covered) and review (uncovered)
		const preview = await service.preview({
			id: THREAD_ID,
			prId: PR_ID,
			items: [
				{ kind: "check", runId: "run-1" },
				{ kind: "review", reviewThreadId: "review-1" },
			],
		});

		expect(preview.covered).toHaveLength(1);
		expect(preview.covered[0]?.ident).toBe("status:123:unit-tests");
		expect(preview.items).toHaveLength(1);
		expect(preview.items[0]?.kind).toBe("review");
	});

	it("a fake job insert that throws once leaves the next preview offering Start", async () => {
		const { service, threadsService } = setupService();
		const preview = await service.preview({ id: THREAD_ID, prId: PR_ID, items: [{ kind: "check", runId: "run-1" }] });
		expect(preview.items).toHaveLength(1);

		// Throw in start (simulating fake job insert failure)
		threadsService.start.mockRejectedValueOnce(new Error("UNIQUE constraint failed: jobs.id"));

		await expect(
			service.start({
				id: THREAD_ID,
				prId: PR_ID,
				items: [{ kind: "check", runId: "run-1" }],
				digest: preview.digest!,
			}),
		).rejects.toThrow("UNIQUE constraint failed: jobs.id");

		// Next preview should still offer Start (no covered items recorded)
		const nextPreview = await service.preview({ id: THREAD_ID, prId: PR_ID, items: [{ kind: "check", runId: "run-1" }] });
		expect(nextPreview.refusal).toBeNull();
		expect(nextPreview.items).toHaveLength(1);
		expect(nextPreview.covered).toHaveLength(0);
	});
});
