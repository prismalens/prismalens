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
			count: vi.fn(async ({ where }: { where: { kind: string } }) => wakes.filter((w) => w.kind === where.kind).length),
		},
		prWatch: {
			upsert: vi.fn(async ({ create }: { create: (typeof watches)[number] }) => {
				watches = [...watches.filter((w) => w.prId !== create.prId), create];
			}),
			findUnique: vi.fn(async ({ where }: { where: { prId_investigationId: { prId: string } } }) =>
				watches.find((w) => w.prId === where.prId_investigationId.prId) ?? null,
			),
			findMany: vi.fn(async () => watches),
			delete: vi.fn(async ({ where }: { where: { prId_investigationId: { prId: string } } }) => {
				watches = watches.filter((w) => w.prId !== where.prId_investigationId.prId);
			}),
			deleteMany: vi.fn(async ({ where }: { where: { prId: string } }) => {
				watches = watches.filter((w) => w.prId !== where.prId);
			}),
		},
		$transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
			fn({
				investigationEvent: {
					aggregate: async () => ({ _max: { seq: events.length - 1 } }),
					create: async ({ data }: { data: { event: string } }) => events.push(JSON.parse(data.event)),
				},
			}),
		),
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
		list: vi.fn(async (): Promise<{ pullRequests: PullRequest[]; statusEnabled: boolean }> => ({ pullRequests: prs, statusEnabled: true })),
		linkFromUser: vi.fn(async (_t: string, url: string) => {
			if (!url.includes("acme")) throw new ORPCError("BAD_REQUEST", { message: "not on a repository PrismaLens knows" });
			return prs[0] as PullRequest;
		}),
	};
	const bus = { publish: vi.fn() };
	const svc = new ThreadWatchesService(prisma as never, prSvc as never, wakeSvc as never, bus as never);
	return { svc, watches: () => watches, events, wakes, prs, prSvc, bus, prisma };
}

describe("wakeup_schedule, pr_link, pr_watch and pr_unwatch (#1024 spec B)", () => {
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

	it("Given a wake, Then one agent wake is pending with the agent's reason, a second replaces it, and the thread records each", async () => {
		const h = harness();
		expect(await h.svc.wakeup(THREAD, 120, "Check the rollout")).toMatchObject({ replaced: false });
		const second = await h.svc.wakeup(THREAD, 600, "Check again");
		expect(second).toMatchObject({ replaced: true });
		expect(h.wakes.filter((w) => w.state === "pending")).toEqual([
			expect.objectContaining({ kind: "agent", reason: "The wake you scheduled (wakeup_schedule) is due: Check again" }),
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
		const h = harness({ prs: [pr({ id: "a", number: 1, state: "merged" }), pr({ id: "b", number: 2, review: "approved" })] });
		await h.svc.watch(THREAD, "a", "merged");
		await h.svc.watch(THREAD, "b", "review");
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
		expect(await h.svc.unwatch(THREAD, "pr1")).toEqual({ stopped: false });
		expect(h.events.at(-1)).toMatchObject({ kind: "pr_watch", phase: "stopped" });
	});

	it("Given pr_link, Then a known PR is linked as the agent's and an unknown one comes back as the tool's failure", async () => {
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
		expect(h.prSvc.list).not.toHaveBeenCalled();
		expect(h.watches()).toHaveLength(1);
		expect(h.wakes).toEqual([]);
	});

	it("Given a host that does not answer, Then the next passes back off before it is read again", async () => {
		const h = harness();
		await h.svc.watch(THREAD, "pr1", "merged");
		h.prSvc.list.mockRejectedValue(new Error("ECONNREFUSED"));
		const t0 = Date.now();
		await h.svc.tick(new Date(t0));
		await h.svc.tick(new Date(t0 + 2 * 60_000));
		expect(h.prSvc.list).toHaveBeenCalledTimes(1);
		await h.svc.tick(new Date(t0 + 5 * 60_000));
		expect(h.prSvc.list).toHaveBeenCalledTimes(2);
		h.prSvc.list.mockResolvedValue({ pullRequests: [pr({ state: "merged" })], statusEnabled: true });
		await h.svc.tick(new Date(t0 + 60 * 60_000));
		expect(h.wakes).toHaveLength(1);
	});

	it("Given a pending pr_watch wake already handed to the agent, Then a later end starts a new wake rather than repeating it", async () => {
		const h = harness({ prs: [pr({ id: "a", number: 1, state: "merged" })] });
		h.wakes.push({ kind: "pr_watch", at: new Date(), reason: "old news", state: "pending", payload: { sentTo: THREAD } });
		await h.svc.watch(THREAD, "a", "merged");
		await h.svc.tick();
		const pending = h.wakes.filter((w) => w.state === "pending");
		expect(pending).toHaveLength(1);
		expect(pending[0]?.reason).not.toContain("old news");
	});
});

