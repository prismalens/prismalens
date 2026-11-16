// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { NO_CHECKS, type PullRequest } from "@prismalens/contracts";
import { ORPCError } from "@orpc/nest";
import { describe, expect, it, vi } from "vitest";
import { watchTools } from "../gateway/tools/watches.js";
import {
	ThreadWatchesService,
	WAKES_PER_DAY,
	WATCHES_PER_THREAD,
	watchMet,
} from "./thread-watches.service.js";

const THREAD = "6a3b1c2d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const pr = (over: Partial<PullRequest> = {}): PullRequest => ({
	id: "pr1",
	url: "https://github.com/acme/shop/pull/12",
	host: "github",
	repo: "acme/shop",
	number: 12,
	title: "Fix pool",
	state: "open",
	review: "review_required",
	checks: { ...NO_CHECKS, state: "pending", total: 2, pending: 2 },
	conflicts: false,
	tone: "attention",
	source: "agent",
	fetchedAt: null,
	...over,
});

/** The service over in-memory watches, wakes and events. */
function harness(opts: { prStatus?: boolean; prs?: PullRequest[] } = {}) {
	let watches: { prId: string; investigationId: string; until: string; expiresAt: Date }[] = [];
	const events: Record<string, unknown>[] = [];
	const wakes: { kind: string; at: Date; reason: string; state: string; payload?: Record<string, unknown> }[] = [];
	const prs = opts.prs ?? [pr()];
	const prisma = {
		setting: { findUnique: vi.fn(async () => ({ value: JSON.stringify({ prStatus: opts.prStatus ?? true }) })) },
		investigation: { findUnique: vi.fn(async () => ({ id: THREAD })) },
		threadWake: {
			count: vi.fn(async ({ where }: { where: { kind: { in: string[] } } }) => wakes.filter((w) => where.kind.in.includes(w.kind)).length),
		},
		prFeed: {
			updateMany: vi.fn(async () => ({ count: 0 })),
		},
		prWatch: {
			upsert: vi.fn(async ({ create }: { create: (typeof watches)[number] }) => {
				watches = [...watches.filter((w) => !(w.prId === create.prId && w.investigationId === create.investigationId)), create];
			}),
			findUnique: vi.fn(async ({ where }: { where: { prId_investigationId: { prId: string; investigationId: string } } }) =>
				watches.find((w) => w.prId === where.prId_investigationId.prId && w.investigationId === where.prId_investigationId.investigationId) ?? null,
			),
			findMany: vi.fn(async () =>
				watches.map((w) => ({
					...w,
					investigation: {
						settledAt: null as Date | null,
						lastActivityAt: null as Date | null,
						updatedAt: new Date(),
					},
				})),
			),
			delete: vi.fn(async ({ where }: { where: { prId_investigationId: { prId: string; investigationId: string } } }) => {
				const k = where.prId_investigationId;
				watches = watches.filter((w) => !(w.prId === k.prId && w.investigationId === k.investigationId));
			}),
			deleteMany: vi.fn(async ({ where }: { where: { prId: string; investigationId: string; until: string; expiresAt: Date } }) => {
				const before = watches.length;
				watches = watches.filter((w) => !(w.prId === where.prId && w.investigationId === where.investigationId && w.until === where.until && w.expiresAt.getTime() === where.expiresAt.getTime()));
				return { count: before - watches.length };
			}),
		},
		$transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
			const beforeWatches = [...watches];
			const beforeWakes = structuredClone(wakes);
			try { return await fn({
				prWatch: prisma.prWatch,
				threadWake: prisma.threadWake,
				investigationEvent: {
					aggregate: async () => ({ _max: { seq: events.length - 1 } }),
					create: async ({ data }: { data: { event: string } }) => events.push(JSON.parse(data.event)),
				},
			}); } catch (error) {
				watches = beforeWatches;
				wakes.splice(0, wakes.length, ...beforeWakes);
				throw error;
			}
		}),
	};
	const wakeSvc = {
		latest: vi.fn(async (_t: string, kind: string) => [...wakes].reverse().find((w) => w.kind === kind) ?? null),
		schedule: vi.fn(async (_t: string, kind: string, at: Date, reason: string) => {
			for (const w of wakes) if (w.kind === kind && w.state === "pending") w.state = "cancelled";
			wakes.push({ kind, at, reason, state: "pending", payload: {} });
			return "w";
		}),
	};
	const prSvc = {
		stored: vi.fn(async () => prs),
		refreshForWatch: vi.fn(async (_thread?: string): Promise<{ pullRequests: PullRequest[]; failed: boolean }> => ({ pullRequests: prs, failed: false })),
		linkFromUser: vi.fn(async (_t: string, url: string) => {
			if (!url.includes("acme")) throw new ORPCError("BAD_REQUEST", { message: "not on a repository PrismaLens knows" });
			return prs[0] as PullRequest;
		}),
	};
	const bus = { publish: vi.fn() };
	const svc = new ThreadWatchesService(prisma as never, prSvc as never, wakeSvc as never, bus as never);
	return { svc, watches: () => watches, events, wakes, prs, prSvc, wakeSvc, bus, prisma };
}

describe("pl_wakeup_schedule, pl_pr_link, pl_pr_watch and pl_pr_unwatch (#1024 spec B)", () => {
	it("tells when a watch ends: checks finished, a review decision, the merge, or a closed PR for any of them", () => {
		expect(watchMet(pr(), "checks_done")).toBeNull();
		expect(watchMet(pr({ checks: { ...NO_CHECKS, state: "failing", total: 2, failed: 1 } }), "checks_done")).toBe("checks failing (1 failed)");
		expect(watchMet(pr({ checks: { ...NO_CHECKS, state: "passing", total: 2 } }), "checks_done")).toBe("checks passing");
		expect(watchMet(pr(), "review")).toBeNull();
		expect(watchMet(pr({ review: "approved" }), "review")).toBe("approved");
		expect(watchMet(pr({ review: "changes_requested" }), "review")).toBe("changes requested");
		expect(watchMet(pr({ review: "approved" }), "merged")).toBeNull();
		expect(watchMet(pr({ state: "merged" }), "checks_done")).toBe("merged");
		expect(watchMet(pr({ state: "closed" }), "merged")).toBe("closed without merging");
	});

	it("a row the host never answered for is not 'no checks': the watch waits for a real read", () => {
		const none = { ...NO_CHECKS, state: "none" as const };
		expect(watchMet(pr({ checks: none, fetchedAt: null }), "checks_done")).toBeNull();
		expect(watchMet(pr({ checks: none, fetchedAt: "2026-01-01T00:00:00.000Z" }), "checks_done")).toBe("checks none");
	});

	it("one thread's failed pass never stops the other threads' watches", async () => {
		const OTHER = "0b3c2f1e-1111-4222-8333-444455556666";
		const h = harness();
		await h.svc.watch(THREAD, "pr1", "review");
		await h.svc.watch(OTHER, "pr1", "review");
		h.prs[0] = pr({ review: "approved" });
		h.prSvc.refreshForWatch.mockImplementation(async (t: string) => {
			if (t === THREAD) throw new Error("db busy");
			return { pullRequests: h.prs, failed: false };
		});
		h.prSvc.stored.mockRejectedValueOnce(new Error("db busy"));
		await h.svc.tick();
		expect(h.wakeSvc.schedule).toHaveBeenCalledTimes(1);
		expect(h.wakeSvc.schedule).toHaveBeenCalledWith(OTHER, "pr_watch", expect.any(Date), expect.stringContaining("approved"), expect.anything(), 1, expect.anything());
	});

	it("a watch stays until its wake is stored, so a failed handoff is retried on the next pass", async () => {
		const h = harness();
		await h.svc.watch(THREAD, "pr1", "review");
		h.prs[0] = pr({ review: "approved" });
		h.wakeSvc.schedule.mockRejectedValueOnce(new Error("db busy"));
		await h.svc.tick();
		expect(h.watches()).toHaveLength(1);
		expect(h.wakes).toEqual([]);
		await h.svc.tick();
		expect(h.watches()).toEqual([]);
		expect(h.wakes).toEqual([expect.objectContaining({ kind: "pr_watch", reason: expect.stringContaining("approved") })]);
	});

	it("a failed watch deletion stores no wake; retry after delivery never repeats it", async () => {
		const h = harness();
		await h.svc.watch(THREAD, "pr1", "review");
		h.prs[0] = pr({ review: "approved" });
		h.prisma.prWatch.deleteMany.mockRejectedValueOnce(new Error("db busy"));
		await h.svc.tick();
		expect(h.wakes).toEqual([]);
		expect(h.watches()).toHaveLength(1);
		await h.svc.tick();
		expect(h.wakes).toHaveLength(1);
		h.wakes[0]!.state = "done";
		await h.svc.tick();
		expect(h.wakes).toHaveLength(1);
		expect(h.watches()).toEqual([]);
	});

	it("an unwatch during refresh wins over the pass's stale snapshot", async () => {
		const h = harness();
		await h.svc.watch(THREAD, "pr1", "review");
		h.prSvc.refreshForWatch.mockImplementationOnce(async () => {
			await h.svc.unwatch(THREAD, "pr1");
			return { pullRequests: [pr({ review: "approved" })], failed: false };
		});
		await h.svc.tick();
		expect(h.wakes).toEqual([]);
		expect(h.events.at(-1)).toMatchObject({ phase: "stopped" });
	});

	it("a renewed watch is not consumed by an older snapshot", async () => {
		const h = harness();
		await h.svc.watch(THREAD, "pr1", "review");
		h.prSvc.refreshForWatch.mockImplementationOnce(async () => {
			await h.svc.watch(THREAD, "pr1", "merged");
			return { pullRequests: [pr({ review: "approved" })], failed: false };
		});
		await h.svc.tick();
		expect(h.wakes).toEqual([]);
		expect(h.watches()).toEqual([expect.objectContaining({ until: "merged" })]);
	});

	it("Given a wake, Then one agent wake is pending with the agent's reason, a second replaces it, and the thread records each", async () => {
		const h = harness();
		expect(await h.svc.wakeup(THREAD, 120, "Check the rollout")).toMatchObject({ replaced: false });
		const second = await h.svc.wakeup(THREAD, 600, "Check again");
		expect(second).toMatchObject({ replaced: true });
		expect(h.wakes.filter((w) => w.state === "pending")).toEqual([
			expect.objectContaining({ kind: "agent", reason: "The wake you scheduled (pl_wakeup_schedule) is due: Check again" }),
		]);
		expect(h.events.map((e) => [e.kind, e.reason, e.replaced ?? false, e.branchId])).toEqual([
			["wake_scheduled", "Check the rollout", false, "watches"],
			["wake_scheduled", "Check again", true, "watches"],
		]);
		expect(h.bus.publish).toHaveBeenCalledTimes(2);
	});

	it("Given a watch, When its PR's checks finish, Then the thread is woken once with what happened and the watch ends", async () => {
		const h = harness();
		expect(await h.svc.watch(THREAD, "pr1", "checks_done")).toMatchObject({ pr: "acme/shop#12" });
		await h.svc.tick();
		expect(h.wakes).toEqual([]);
		h.prs[0] = pr({ checks: { ...NO_CHECKS, state: "passing", total: 2 } });
		await h.svc.tick();
		expect(h.wakes).toEqual([
			expect.objectContaining({ kind: "pr_watch", reason: expect.stringContaining("acme/shop#12: checks passing") }),
		]);
		expect(h.watches()).toEqual([]);
		expect(h.events.map((e) => [e.kind, e.phase])).toEqual([
			["pr_watch", "started"],
			["pr_watch", "met"],
		]);
	});

	it("Given two watches that end in one pass, Then their wake carries both reasons rather than losing one", async () => {
		const h = harness({ prs: [pr({ id: "a", number: 1 }), pr({ id: "b", number: 2 })] });
		await h.svc.watch(THREAD, "a", "merged");
		await h.svc.watch(THREAD, "b", "review");
		h.prs[0] = pr({ id: "a", number: 1, state: "merged" });
		h.prs[1] = pr({ id: "b", number: 2, review: "approved" });
		await h.svc.tick();
		const pending = h.wakes.filter((w) => w.state === "pending");
		expect(pending).toHaveLength(1);
		expect(pending[0]?.reason).toContain("acme/shop#1: merged");
		expect(pending[0]?.reason).toContain("acme/shop#2: approved");
	});

	it("Given a watch past 12 hours, Then it ends expired and the thread hears it gave up", async () => {
		const h = harness();
		await h.svc.watch(THREAD, "pr1", "merged");
		await h.svc.tick(new Date(Date.now() + 13 * 60 * 60_000));
		expect(h.wakes[0]?.reason).toContain("after 12 hours");
		expect(h.events.at(-1)).toMatchObject({ kind: "pr_watch", phase: "expired" });
	});

	it("Given PR status off or an unlinked PR, Then a watch is refused; an unwatch stops one and says when there was none", async () => {
		expect(await harness({ prStatus: false }).svc.watch(THREAD, "pr1", "merged")).toMatchObject({ error: expect.stringContaining("Show pull request status") });
		const h = harness();
		expect(await h.svc.watch(THREAD, "nope", "merged")).toMatchObject({ error: expect.stringContaining("No pull request") });
		await h.svc.watch(THREAD, "pr1", "review");
		expect(await h.svc.unwatch(THREAD, "pr1")).toEqual({ stopped: true });
		expect(h.prisma.prFeed.updateMany).toHaveBeenCalledWith({
			where: {
				prId: "pr1",
				investigationId: THREAD,
				state: { in: ["watching", "disconnected"] },
			},
			data: { state: "stopped", reason: "Stopped by the agent", pending: null },
		});
		expect(await h.svc.unwatch(THREAD, "pr1")).toEqual({ stopped: false });
		expect(h.events.at(-1)).toMatchObject({ kind: "pr_watch", phase: "stopped" });
	});

	it("Given pl_pr_link, Then a known PR is linked as the agent's and an unknown one comes back as the tool's failure", async () => {
		const h = harness();
		expect(await h.svc.link(THREAD, "https://github.com/acme/shop/pull/12")).toMatchObject({ pr: { id: "pr1" } });
		expect(h.prSvc.linkFromUser).toHaveBeenCalledWith(THREAD, expect.any(String), "agent");
		const [, link, watch] = watchTools(h.svc);
		const ctx = { runId: THREAD, signal: new AbortController().signal };
		expect(await link?.run({ url: "https://example.com/other/pull/1" }, ctx)).toMatchObject({ failure: { error: "invalid_input" } });
		expect(await watch?.run({ prId: "nope", until: "merged" }, ctx)).toMatchObject({ failure: { error: "invalid_input" } });
		expect(watchTools(h.svc)[0]?.input.safeParse({ delaySeconds: 30, reason: "x" }).success).toBe(false);
		expect(watchTools(h.svc)[0]?.input.safeParse({ delaySeconds: 86_401, reason: "x" }).success).toBe(false);
	});

	it("Given an agent that keeps waking its thread, Then past the day's budget the wake is refused as limit_reached", async () => {
		const h = harness();
		for (let i = 0; i < WAKES_PER_DAY; i++) expect(await h.svc.wakeup(THREAD, 60, `again ${i}`)).not.toHaveProperty("error");
		expect(await h.svc.wakeup(THREAD, 60, "once more")).toMatchObject({ limit: true });
		const [tool] = watchTools(h.svc);
		expect(await tool?.run({ delaySeconds: 60, reason: "x" }, { runId: THREAD, signal: new AbortController().signal })).toMatchObject({ failure: { error: "limit_reached" } });
		expect(tool?.serves.attended).toBe(true);
	});

	it("Given five watches on a thread, Then a sixth is refused as limit_reached, and watching one again still works", async () => {
		const prs = Array.from({ length: 6 }, (_, i) => pr({ id: `p${i}`, number: i + 1 }));
		const h = harness({ prs });
		for (let i = 0; i < WATCHES_PER_THREAD; i++) expect(await h.svc.watch(THREAD, `p${i}`, "merged")).not.toHaveProperty("error");
		expect(await h.svc.watch(THREAD, "p5", "merged")).toMatchObject({ limit: true });
		expect(await h.svc.watch(THREAD, "p0", "review")).not.toHaveProperty("error");
	});

	it("Given PR status turned off after a watch began, Then the pass reads no host and the watch waits quietly", async () => {
		const h = harness();
		await h.svc.watch(THREAD, "pr1", "merged");
		h.prisma.setting.findUnique.mockResolvedValue({ value: JSON.stringify({ prStatus: false }) });
		h.prs[0] = pr({ state: "merged" });
		await h.svc.tick();
		expect(h.prSvc.refreshForWatch).not.toHaveBeenCalled();
		expect(h.watches()).toHaveLength(1);
		expect(h.wakes).toEqual([]);
	});

	it("Given a host that does not answer, Then the next passes back off before it is read again", async () => {
		const h = harness();
		await h.svc.watch(THREAD, "pr1", "merged");
		h.prSvc.refreshForWatch.mockResolvedValue({ pullRequests: h.prs, failed: true });
		const t0 = Date.now();
		await h.svc.tick(new Date(t0));
		await h.svc.tick(new Date(t0 + 2 * 60_000));
		expect(h.prSvc.refreshForWatch).toHaveBeenCalledTimes(1);
		await h.svc.tick(new Date(t0 + 5 * 60_000));
		expect(h.prSvc.refreshForWatch).toHaveBeenCalledTimes(2);
		h.prSvc.refreshForWatch.mockResolvedValue({ pullRequests: [pr({ state: "merged" })], failed: false });
		await h.svc.tick(new Date(t0 + 60 * 60_000));
		expect(h.wakes).toHaveLength(1);
	});

	it("Given a pending pl_pr_watch wake already handed to the agent, Then a later end starts a new wake rather than repeating it", async () => {
		const h = harness({ prs: [pr({ id: "a", number: 1 })] });
		h.wakes.push({ kind: "pr_watch", at: new Date(), reason: "old news", state: "pending", payload: { sentTo: THREAD } });
		await h.svc.watch(THREAD, "a", "merged");
		h.prs[0] = pr({ id: "a", number: 1, state: "merged" });
		await h.svc.tick();
		const pending = h.wakes.filter((w) => w.state === "pending");
		expect(pending).toHaveLength(1);
		expect(pending[0]?.reason).not.toContain("old news");
	});

	it("Given a PR whose condition already holds, Then the watch is refused, so watching a merged PR again never wakes the thread", async () => {
		const h = harness({ prs: [pr({ state: "merged" })] });
		expect(await h.svc.watch(THREAD, "pr1", "checks_done")).toMatchObject({ error: expect.stringContaining("already merged") });
		const [, , watch] = watchTools(h.svc);
		expect(await watch?.run({ prId: "pr1", until: "merged" }, { runId: THREAD, signal: new AbortController().signal })).toMatchObject({ failure: { error: "invalid_input" } });
		expect(h.watches()).toEqual([]);
	});

	it("Given a day of PR-watch wakes, Then they count in the budget: no more wakes or watches", async () => {
		const h = harness({ prs: [pr({ id: "x" })] });
		for (let i = 0; i < WAKES_PER_DAY; i++) h.wakes.push({ kind: "pr_watch", at: new Date(), reason: `r${i}`, state: "done", payload: {} });
		expect(await h.svc.wakeup(THREAD, 60, "again")).toMatchObject({ limit: true });
		expect(await h.svc.watch(THREAD, "x", "merged")).toMatchObject({ limit: true });
	});

	it("Given a host that never answers, Then its backoff entry goes once the thread watches nothing", async () => {
		const h = harness();
		await h.svc.watch(THREAD, "pr1", "merged");
		h.prSvc.refreshForWatch.mockResolvedValue({ pullRequests: h.prs, failed: true });
		const t0 = Date.now();
		await h.svc.tick(new Date(t0));
		await h.svc.unwatch(THREAD, "pr1");
		await h.svc.tick(new Date(t0 + 60_000));
		await h.svc.watch(THREAD, "pr1", "merged");
		h.prSvc.refreshForWatch.mockClear();
		await h.svc.tick(new Date(t0 + 61_000));
		expect(h.prSvc.refreshForWatch).toHaveBeenCalledTimes(1);
	});

	it("Given a waiting wake that already holds the line, Then the pass leaves it as it is, its other lines kept", async () => {
		const h = harness({ prs: [pr({ id: "a", number: 1 })] });
		await h.svc.watch(THREAD, "a", "merged");
		const line = "Pull request acme/shop#1: merged. You asked to hear when it was merged.";
		h.wakes.push({ kind: "pr_watch", at: new Date(), reason: `Another PR ended.\n${line}`, state: "pending", payload: {} });
		const scheduled = vi.mocked(h.svc["wakes"].schedule).mock.calls.length;
		h.prs[0] = pr({ id: "a", number: 1, state: "merged" });
		await h.svc.tick();
		expect(vi.mocked(h.svc["wakes"].schedule).mock.calls.length).toBe(scheduled);
		expect(h.wakes.filter((w) => w.state === "pending").map((w) => w.reason)).toEqual([`Another PR ended.\n${line}`]);
	});

	it("tick skips settled threads", async () => {
		const h = harness();
		const stamp = new Date("2026-11-11T12:00:00.000Z");
		h.prisma.prWatch.findMany.mockResolvedValueOnce([
			{
				prId: "pr1",
				investigationId: THREAD,
				until: "checks_done",
				expiresAt: new Date(stamp.getTime() + 10_000),
				investigation: {
					settledAt: stamp,
					lastActivityAt: null,
					updatedAt: stamp,
				},
			},
		]);
		await h.svc.tick(stamp);
		expect(h.prSvc.refreshForWatch).not.toHaveBeenCalled();
	});
});

