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
type TreePlacement = import("./threads.service.js").TreePlacement;

const REPO = "11111111-1111-4111-8111-111111111111";
const RUN = "44444444-4444-4444-8444-444444444444";
const TX = {
	repository: { findUnique: vi.fn(async () => ({ plain: false, url: "/code/shop" })) },
	investigation: { findMany: vi.fn(async () => []), update: vi.fn(async () => ({})) },
	checkoutLease: { findMany: vi.fn(async () => []) },
};

describe("Work in: This checkout or New worktree (#1024)", () => {
	let repo: Record<string, unknown>;
	let settings: string | null;
	let prisma: Record<string, Record<string, ReturnType<typeof vi.fn>>>;
	let dispatch: Record<string, ReturnType<typeof vi.fn>>;
	const start = (over: Record<string, unknown> = {}, tree?: TreePlacement) =>
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
			{} as never,
		).start(
			{
				subject: { kind: "project", repositoryId: REPO },
				text: "Rename the retry helper",
				...over,
			},
			tree,
		);
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
			abandonUnstarted: vi.fn(async () => {}),
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

	it("a checkout that cannot be read right now is retryable, not reported gone", async () => {
		const { CheckoutUnreadable } = await import(
			"../../infrastructure/dispatch/checkout-lease.js"
		);
		lease.checkoutRoot.mockRejectedValueOnce(new CheckoutUnreadable("Try again in a moment."));
		await expect(start({ workIn: "checkout" })).rejects.toMatchObject({
			code: "SERVICE_UNAVAILABLE",
			message: "Try again in a moment.",
		});
		expect(dispatch.addInvestigationJob).not.toHaveBeenCalled();
	});

	it("a start that dies before a job is stored fails the run and frees its checkout, then says why", async () => {
		dispatch.threadRunOf?.mockRejectedValueOnce(new Error("disk gone"));
		await expect(start({ workIn: "checkout" })).rejects.toThrow("disk gone");
		expect(dispatch.abandonUnstarted).toHaveBeenCalledWith(
			RUN,
			expect.stringContaining("could not be started"),
		);
		expect(dispatch.addInvestigationJob).not.toHaveBeenCalled();
	});

	it("a job that could not be queued fails the run too, and a queued one does not", async () => {
		dispatch.addInvestigationJob?.mockResolvedValueOnce(null);
		const failed = await start({ workIn: "checkout" });
		expect(failed.queued).toBe(false);
		expect(dispatch.abandonUnstarted).toHaveBeenCalledTimes(1);
		await start({ workIn: "checkout" });
		expect(dispatch.abandonUnstarted).toHaveBeenCalledTimes(1);
	});

	it("a thread an agent starts is marked byAgent and never takes, leases or remembers the checkout", async () => {
		repo.workIn = "checkout";
		settings = JSON.stringify({ settleAfterDays: 3, newThreadsWorkIn: "checkout" });
		await start(
			{ workIn: "checkout" },
			{
				parentId: "55555555-5555-4555-8555-555555555555",
				rootId: "55555555-5555-4555-8555-555555555555",
				role: "child",
				depth: 1,
				title: "Look at the retry helper",
				actionId: "66666666-6666-4666-8666-666666666666",
			},
		);
		expect(job().thread.byAgent).toBe(true);
		expect(job().thread.checkout).toBeUndefined();
		expect(lease.checkoutRoot).not.toHaveBeenCalled();
		expect(lease.takeLease).not.toHaveBeenCalled();
		expect(dispatch.freeCheckout).not.toHaveBeenCalled();
		expect(prisma.repository?.update).not.toHaveBeenCalled();
	});

	it("a person's thread carries no byAgent mark", async () => {
		await start({ workIn: "checkout" });
		expect(job().thread.byAgent).toBeUndefined();
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
