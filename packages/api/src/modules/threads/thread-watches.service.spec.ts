// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { NO_CHECKS, type PullRequest } from "@prismalens/contracts";
import { ORPCError } from "@orpc/nest";
import { describe, expect, it, vi } from "vitest";
import { watchTools } from "../gateway/tools/watches.js";
import {
	ThreadWatchesService,
	WAKES_PER_DAY,
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

/** The service over in-memory wakes and events. */
function harness(opts: { prs?: PullRequest[] } = {}) {
	const events: Record<string, unknown>[] = [];
	const wakes: { kind: string; at: Date; reason: string; state: string; payload?: Record<string, unknown> }[] = [];
	const prs = opts.prs ?? [pr()];
	const prisma = {
		investigation: { findUnique: vi.fn(async () => ({ id: THREAD })) },
		threadWake: {
			count: vi.fn(async ({ where }: { where: { kind: { in: string[] } } }) =>
				wakes.filter((w) => where.kind.in.includes(w.kind)).length,
			),
		},
		$transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
			const beforeWakes = structuredClone(wakes);
			try {
				return await fn({
					threadWake: prisma.threadWake,
					investigationEvent: {
						aggregate: async () => ({ _max: { seq: events.length - 1 } }),
						create: async ({ data }: { data: { event: string } }) =>
							events.push(JSON.parse(data.event)),
					},
				});
			} catch (error) {
				wakes.splice(0, wakes.length, ...beforeWakes);
				throw error;
			}
		}),
	};
	const wakeSvc = {
		latest: vi.fn(async (_t: string, kind: string) =>
			[...wakes].reverse().find((w) => w.kind === kind) ?? null,
		),
		schedule: vi.fn(async (_t: string, kind: string, at: Date, reason: string) => {
			for (const w of wakes)
				if (w.kind === kind && w.state === "pending") w.state = "cancelled";
			wakes.push({ kind, at, reason, state: "pending", payload: {} });
			return "w";
		}),
	};
	const prSvc = {
		stored: vi.fn(async () => prs),
		linkFromUser: vi.fn(async (_t: string, url: string) => {
			if (!url.includes("acme"))
				throw new ORPCError("BAD_REQUEST", { message: "not on a repository PrismaLens knows" });
			return prs[0] as PullRequest;
		}),
	};
	const subs = {
		subscribe: vi.fn(async () => ({ ok: true })),
		unsubscribe: vi.fn(async () => ({ ok: true })),
		forTool: vi.fn(async () => ({ ok: true })),
	};
	const bus = { publish: vi.fn() };
	const svc = new ThreadWatchesService(
		prisma as never,
		prSvc as never,
		wakeSvc as never,
		subs as never,
		bus as never,
	);
	return { svc, events, wakes, prs, prSvc, wakeSvc, subs, bus, prisma };
}

describe("pl_wakeup_schedule, pl_pr_link and subscriptions (#1024 spec B, #1179)", () => {
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

	it("Given pl_pr_link, Then a known PR is linked as the agent's and an unknown one comes back as the tool's failure", async () => {
		const h = harness();
		expect(await h.svc.link(THREAD, "https://github.com/acme/shop/pull/12")).toMatchObject({ pr: { id: "pr1" } });
		expect(h.prSvc.linkFromUser).toHaveBeenCalledWith(THREAD, expect.any(String), "agent");
		const [wakeup, link] = watchTools(h.svc);
		const ctx = { runId: THREAD, signal: new AbortController().signal };
		expect(await link?.run({ url: "https://example.com/other/pull/1" }, ctx)).toMatchObject({ failure: { error: "invalid_input" } });
		expect(wakeup?.input.safeParse({ delaySeconds: 30, reason: "x" }).success).toBe(false);
		expect(wakeup?.input.safeParse({ delaySeconds: 86_401, reason: "x" }).success).toBe(false);
	});

	it("Given an agent that keeps waking its thread, Then past the day's budget the wake is refused as limit_reached", async () => {
		const h = harness();
		for (let i = 0; i < WAKES_PER_DAY; i++) expect(await h.svc.wakeup(THREAD, 60, `again ${i}`)).not.toHaveProperty("error");
		expect(await h.svc.wakeup(THREAD, 60, "once more")).toMatchObject({ limit: true });
		const [tool] = watchTools(h.svc);
		expect(await tool?.run({ delaySeconds: 60, reason: "x" }, { runId: THREAD, signal: new AbortController().signal })).toMatchObject({ failure: { error: "limit_reached" } });
		expect(tool?.serves.attended).toBe(true);
	});

	it("Given a day of PR-watch wakes, Then they count in the budget: no more wakes", async () => {
		const h = harness();
		for (let i = 0; i < WAKES_PER_DAY; i++) h.wakes.push({ kind: "pr_watch", at: new Date(), reason: `r${i}`, state: "done", payload: {} });
		expect(await h.svc.wakeup(THREAD, 60, "again")).toMatchObject({ limit: true });
	});

	it("delegates subscribe, unsubscribe and subscriptions to PrSubscriptionsService", async () => {
		const h = harness();
		await h.svc.subscribe(THREAD, { pr: "https://github.com/acme/shop/pull/12" });
		expect(h.subs.subscribe).toHaveBeenCalledWith(THREAD, { pr: "https://github.com/acme/shop/pull/12" });

		await h.svc.unsubscribe(THREAD, { pr: "https://github.com/acme/shop/pull/12" });
		expect(h.subs.unsubscribe).toHaveBeenCalledWith(THREAD, { pr: "https://github.com/acme/shop/pull/12" });

		await h.svc.subscriptions(THREAD);
		expect(h.subs.forTool).toHaveBeenCalledWith(THREAD);
	});
});
