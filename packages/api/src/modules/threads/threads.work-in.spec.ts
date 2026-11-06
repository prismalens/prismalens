// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** Where a new thread works (#1024): the user's checkout only on a local git project, under its lease. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const lease = vi.hoisted(() => ({
	checkoutRoot: vi.fn(async (_: string): Promise<string | null> => "/code/shop"),
	checkoutBusy: vi.fn(async () => false),
	takeLease: vi.fn(async () => {}),
}));
vi.mock("../../infrastructure/dispatch/checkout-lease.js", async (real) => ({
	...(await real<object>()),
	...lease,
}));

const { ThreadsService } = await import("./threads.service.js");

const REPO = "11111111-1111-4111-8111-111111111111";
const RUN = "44444444-4444-4444-8444-444444444444";
const TX = {
	repository: { findUnique: vi.fn(async () => ({ plain: false, url: "/code/shop" })) },
	investigation: { findMany: vi.fn(async () => []) },
	checkoutLease: { findMany: vi.fn(async () => []) },
};

describe("Work in: This checkout or New worktree (#1024)", () => {
	let repo: Record<string, unknown>;
	let settings: string | null;
	let prisma: Record<string, Record<string, ReturnType<typeof vi.fn>>>;
	let dispatch: Record<string, ReturnType<typeof vi.fn>>;
	const start = (over: Record<string, unknown> = {}) =>
		new ThreadsService(
			prisma as never,
			{
				startOrGet: vi.fn(
					async (dto: { onCreate?: (tx: unknown, id: string) => Promise<void> }) => {
						await dto.onCreate?.(TX, RUN);
						return { investigation: { id: RUN }, created: true };
					},
				),
			} as never,
			dispatch as never,
			{
				resolveSelection: vi.fn(async () => ({ runnable: true, harness: "claude-code" })),
				ensureReady: vi.fn(async () => ({ ready: true })),
			} as never,
			{} as never,
			{} as never,
			{ consume: async () => "none", withDrafts: async () => new Set() } as never,
			{ compose: async () => undefined } as never,
			{ rowGlyphs: async () => new Map() } as never,
		).start({
			subject: { kind: "project", repositoryId: REPO },
			text: "Rename the retry helper",
			...over,
		});
	const job = () => dispatch.addInvestigationJob?.mock.calls[0]?.[0];

	beforeEach(() => {
		vi.clearAllMocks();
		repo = { id: REPO, sourceKind: "folder", plain: false, url: "/code/shop", workIn: null };
		settings = null;
		prisma = {
			repository: {
				findUnique: vi.fn(async () => repo),
				update: vi.fn(async () => repo),
			},
			setting: {
				findUnique: vi.fn(async () => (settings ? { value: settings } : null)),
			},
		};
		dispatch = {
			threadRunOf: vi.fn(async () => ({
				subject: "project",
				repositoryId: REPO,
				serviceId: null,
				name: "shop",
				repos: [],
			})),
			addInvestigationJob: vi.fn(async () => "job-1"),
			freeCheckout: vi.fn(async () => {}),
		};
	});

	it("a person's choice takes the checkout's lease, rides with the job and is remembered", async () => {
		await start({ workIn: "checkout" });
		// A lease an ended run's gone agent left is freed first, outside the transaction.
		expect(dispatch.freeCheckout).toHaveBeenCalledWith("/code/shop");
		expect(lease.checkoutBusy).toHaveBeenCalledWith(TX, "/code/shop", RUN);
		expect(lease.takeLease).toHaveBeenCalledWith(TX, "/code/shop", RUN);
		expect(job().thread.checkout).toBe("/code/shop");
		expect(prisma.repository?.update).toHaveBeenCalledWith({
			where: { id: REPO },
			data: { workIn: "checkout" },
		});
	});

	it("a second thread in a held checkout is refused and offered a new worktree", async () => {
		lease.checkoutBusy.mockResolvedValueOnce(true);
		await expect(start({ workIn: "checkout" })).rejects.toThrow(
			/already working in this checkout.*new worktree/,
		);
		expect(lease.takeLease).not.toHaveBeenCalled();
		expect(dispatch.addInvestigationJob).not.toHaveBeenCalled();
	});

	it("a new project starts on New worktree; the project's remembered choice, then Settings, change that", async () => {
		await start();
		expect(lease.checkoutRoot).not.toHaveBeenCalled();
		expect(job().thread.checkout).toBeUndefined();
		expect(prisma.repository?.update).not.toHaveBeenCalled();

		vi.clearAllMocks();
		settings = JSON.stringify({ settleAfterDays: 3, newThreadsWorkIn: "checkout" });
		await start();
		expect(job().thread.checkout).toBe("/code/shop");

		vi.clearAllMocks();
		repo.workIn = "worktree";
		await start();
		expect(job().thread.checkout).toBeUndefined();

		vi.clearAllMocks();
		settings = null;
		repo.workIn = "checkout";
		await start();
		expect(job().thread.checkout).toBe("/code/shop");
	});

	it("only a local git project works in its checkout: a URL, a plain folder or no project is refused", async () => {
		repo = { ...repo, sourceKind: "url", url: "https://example.com/a/b.git" };
		await expect(start({ workIn: "checkout" })).rejects.toThrow(/local git repository/);
		repo = { ...repo, sourceKind: "folder", plain: true };
		await expect(start({ workIn: "checkout" })).rejects.toThrow(/local git repository/);
		// A remembered choice never forces a URL project into a checkout it does not have.
		repo = { ...repo, sourceKind: "url", plain: false, workIn: "checkout" };
		await start();
		expect(lease.checkoutRoot).not.toHaveBeenCalled();
		await expect(
			new ThreadsService(
				prisma as never,
				{} as never,
				dispatch as never,
				{} as never,
				{} as never,
				{} as never,
				{} as never,
				{} as never,
				{} as never,
			).start({ subject: { kind: "none" }, text: "hi", workIn: "checkout" }),
		).rejects.toThrow(/local git repository/);
	});

	it("a checkout that is gone is refused before the thread starts", async () => {
		lease.checkoutRoot.mockResolvedValueOnce(null);
		await expect(start({ workIn: "checkout" })).rejects.toThrow(
			/gone or is not a git repository/,
		);
		expect(dispatch.addInvestigationJob).not.toHaveBeenCalled();
	});
});
