// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { HostReadError } from "./pr-hosts.js";
import { describe, expect, it, vi } from "vitest";
import { PrFeedService } from "./pr-feed.service.js";
import type { PullRequest } from "@prismalens/contracts";

interface MemInvestigation {
	id: string;
	settledAt: Date | null;
	lastActivityAt: Date | null;
	updatedAt: Date;
	teardownAt: Date | null;
	autoPause: string | null;
}

interface MemPullRequest {
	id: string;
	url: string;
	repo: string;
	number: number;
	title: string;
	source: "branch" | "agent" | "user";
	state: "open" | "closed" | "merged";
	headSha: string | null;
	investigationId: string;
	checks?: string;
}

interface MemPrFeed {
	prId: string;
	investigationId: string;
	auto: boolean;
	state: string;
	reason: string | null;
	cursor: string | null;
	pending: string | null;
	since: Date;
	until: Date | null;
	guardFailures: number;
}

interface MemPrPoll {
	url: string;
	headSha: string | null;
	etag: string | null;
	nextPollAt: Date;
	failures: number;
	lastError: string | null;
}

interface MemPrWatch {
	prId: string;
	investigationId: string;
	expiresAt: Date;
}

interface MemWake {
	id: string;
	investigationId: string;
	kind: string;
	at: Date;
	reason: string;
	payload: Record<string, unknown>;
	state: "pending" | "done" | "cancelled";
	doneAt?: Date;
}

function harness(now: Date = new Date("2026-11-11T12:00:00.000Z")) {
	let wakeSeq = 1;
	const investigations = new Map<string, MemInvestigation>();
	const pullRequests = new Map<string, MemPullRequest>();
	const prFeeds = new Map<string, MemPrFeed>();
	const prPolls = new Map<string, MemPrPoll>();
	const prWatches = new Map<string, MemPrWatch>();
	const wakes: MemWake[] = [];
	const events: Array<{ investigationId: string; body: Record<string, unknown> }> = [];

	const sharedResult: {
		read: {
			state: "open" | "closed" | "merged";
			headSha: string | null;
			headRef: string | null;
			headRepo: string | null;
			baseRef: string | null;
			title: string | null;
			review: "none" | "review_required" | "changes_requested" | "approved";
			conflicts: boolean;
			detail: { checkRuns: Array<{ id: string; appId: number | null; headSha: string; name: string; state: "failing" | "passing" | "pending"; url: string | null }> };
		};
		activity: Array<{ id: number; source: "review" | "comment"; login: string; body: string; verdict?: string }>;
	} = {
		read: {
			state: "open",
			headSha: "c111111",
			headRef: "feat-work",
			headRepo: "acme/shop",
			baseRef: "main",
			title: "Fix checkout",
			review: "none",
			conflicts: false,
			detail: { checkRuns: [] },
		},
		activity: [],
	};

	let readSharedError: Error | null = null;
	let readSharedCalls = 0;

	const prs = {
		readShared: vi.fn(async (_url: string, _cache?: unknown) => {
			readSharedCalls++;
			if (readSharedError) throw readSharedError;
			return sharedResult;
		}),
		threadBranches: vi.fn(async (id: string) => {
			return [{ repo: "acme/shop", branch: "feat-work" }];
		}),
		stored: vi.fn(async (id: string) => {
			return [...pullRequests.values()]
				.filter((p) => p.investigationId === id)
				.map((p) => ({
					id: p.id,
					url: p.url,
					host: "github" as const,
					repo: p.repo,
					number: p.number,
					title: p.title,
					state: p.state,
					review: "review_required" as const,
					checks: { state: "none" as const, total: 0, failed: 0, pending: 0 },
					conflicts: false,
					tone: "open" as const,
					source: p.source,
					fetchedAt: null,
				} satisfies PullRequest));
		}),
	};

	const prisma = {
		setting: {
			findUnique: vi.fn(async ({ where }: { where: { key: string } }) => {
				if (where.key === "threads.context") return { value: JSON.stringify({ prStatus: true }) };
				return null;
			}),
		},
		investigation: {
			findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
				const inv = investigations.get(where.id);
				return inv ? { ...inv } : null;
			}),
			update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<MemInvestigation> }) => {
				const inv = investigations.get(where.id);
				if (!inv) throw new Error(`Thread ${where.id} not found`);
				Object.assign(inv, data);
				return { ...inv };
			}),
			updateMany: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<MemInvestigation> }) => {
				const inv = investigations.get(where.id);
				if (inv) Object.assign(inv, data);
				return { count: inv ? 1 : 0 };
			}),
		},
		pullRequest: {
			findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
				const p = pullRequests.get(where.id);
				return p ? { ...p } : null;
			}),
			findMany: vi.fn(async (args?: { where?: { feed?: { is: null }; state?: { notIn?: string[] }; investigation?: { teardownAt?: null } } }) => {
				const list = [...pullRequests.values()].filter((p) => {
					if (args?.where?.feed?.is === null && prFeeds.has(p.id)) return false;
					if (args?.where?.state?.notIn && args.where.state.notIn.includes(p.state)) return false;
					const inv = investigations.get(p.investigationId);
					if (args?.where?.investigation?.teardownAt === null && inv?.teardownAt !== null) return false;
					return true;
				});
				return list.map((p) => {
					const inv = investigations.get(p.investigationId) ?? {
						settledAt: null,
						lastActivityAt: null,
						updatedAt: now,
					};
					return {
						id: p.id,
						url: p.url,
						repo: p.repo,
						source: p.source,
						investigationId: p.investigationId,
						investigation: {
							settledAt: inv.settledAt,
							lastActivityAt: inv.lastActivityAt,
							updatedAt: inv.updatedAt,
						},
					};
				});
			}),
		},
		prFeed: {
			findMany: vi.fn(async (args?: { where?: { state?: { in?: string[] }; pending?: { not: null }; investigationId?: string } }) => {
				let list = [...prFeeds.values()];
				if (args?.where?.state?.in) {
					const allowed = args.where.state.in;
					list = list.filter((f) => allowed.includes(f.state));
				}
				if (args?.where?.pending && args.where.pending.not === null) {
					list = list.filter((f) => f.pending !== null);
				}
				if (args?.where?.investigationId) {
					list = list.filter((f) => f.investigationId === args.where!.investigationId);
				}
				return list.map((f) => {
					const pr = pullRequests.get(f.prId);
					const inv = investigations.get(f.investigationId);
					return {
						...f,
						pullRequest: {
							url: pr?.url ?? "",
							number: pr?.number ?? 1,
							title: pr?.title ?? "",
							headSha: pr?.headSha ?? "c111111",
						},
						investigation: {
							settledAt: inv?.settledAt ?? null,
							lastActivityAt: inv?.lastActivityAt ?? null,
							updatedAt: inv?.updatedAt ?? now,
							teardownAt: inv?.teardownAt ?? null,
						},
					};
				});
			}),
			findUnique: vi.fn(async ({ where }: { where: { prId: string } }) => {
				const f = prFeeds.get(where.prId);
				return f ? { ...f } : null;
			}),
			create: vi.fn(async ({ data }: { data: Omit<MemPrFeed, "guardFailures" | "reason" | "pending" | "since" | "until"> }) => {
				const row: MemPrFeed = {
					guardFailures: 0,
					reason: null,
					pending: null,
					since: now,
					until: null,
					...data,
					state: data.state ?? "watching",
				};
				prFeeds.set(row.prId, row);
				return { ...row };
			}),
			update: vi.fn(async ({ where, data }: { where: { prId: string }; data: Partial<MemPrFeed> & { guardFailures?: { increment: number } } }) => {
				const f = prFeeds.get(where.prId);
				if (!f) throw new Error(`Feed for ${where.prId} not found`);
				const { guardFailures, ...rest } = data;
				Object.assign(f, rest);
				if (guardFailures?.increment) f.guardFailures += guardFailures.increment;
				return { ...f };
			}),
			updateMany: vi.fn(async ({ where, data }: { where: { prId?: string | { in: string[] } }; data: Partial<MemPrFeed> }) => {
				let count = 0;
				for (const f of prFeeds.values()) {
					if (where.prId) {
						if (typeof where.prId === "string" && f.prId !== where.prId) continue;
						if (typeof where.prId === "object" && "in" in where.prId && !where.prId.in.includes(f.prId)) continue;
					}
					Object.assign(f, data);
					count++;
				}
				return { count };
			}),
			upsert: vi.fn(async ({ where, create, update }: { where: { prId: string }; create: Partial<MemPrFeed>; update: Partial<MemPrFeed> }) => {
				const had = prFeeds.get(where.prId);
				if (had) {
					Object.assign(had, update);
					return { ...had };
				}
				const created: MemPrFeed = {
					prId: where.prId,
					investigationId: create.investigationId ?? "",
					auto: create.auto ?? false,
					state: create.state ?? "watching",
					reason: null,
					cursor: null,
					pending: null,
					since: now,
					until: null,
					guardFailures: 0,
					...create,
				};
				prFeeds.set(where.prId, created);
				return { ...created };
			}),
		},
		prPoll: {
			findUnique: vi.fn(async ({ where }: { where: { url: string } }) => {
				const p = prPolls.get(where.url);
				return p ? { ...p } : null;
			}),
			upsert: vi.fn(async ({ where, create, update }: { where: { url: string }; create: Partial<MemPrPoll>; update: Partial<MemPrPoll> }) => {
				const had = prPolls.get(where.url);
				if (had) {
					Object.assign(had, update);
					return { ...had };
				}
				const row: MemPrPoll = {
					url: where.url,
					headSha: null,
					etag: null,
					nextPollAt: now,
					failures: 0,
					lastError: null,
					...create,
				};
				prPolls.set(where.url, row);
				return { ...row };
			}),
		},
		prWatch: {
			findMany: vi.fn(async ({ where }: { where: { investigationId: string } }) => {
				return [...prWatches.values()].filter((w) => w.investigationId === where.investigationId);
			}),
			deleteMany: vi.fn(async ({ where }: { where: { prId: string; investigationId: string } }) => {
				let count = 0;
				for (const [k, w] of prWatches.entries()) {
					if (w.prId === where.prId && w.investigationId === where.investigationId) {
						prWatches.delete(k);
						count++;
					}
				}
				return { count };
			}),
		},
		investigationEvent: {
			aggregate: vi.fn(async () => ({ _max: { seq: events.length - 1 } })),
			create: vi.fn(async ({ data }: { data: { investigationId: string; event: string } }) => {
				events.push({ investigationId: data.investigationId, body: JSON.parse(data.event) });
				return { id: "ev", ...data };
			}),
		},
		$transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
	};

	const wakesSvc = {
		latest: vi.fn(async (threadId: string, kind: string) => {
			return [...wakes].reverse().find((w) => w.investigationId === threadId && w.kind === kind) ?? null;
		}),
		schedule: vi.fn(async (
			threadId: string,
			kind: string,
			at: Date,
			reason: string,
			payload: Record<string, unknown>,
			_attempts = 1,
			_tx?: unknown,
		) => {
			const existing = wakes.find((w) => w.investigationId === threadId && w.kind === kind && w.state === "pending");
			if (existing) existing.state = "cancelled";
			const id = `wake-${wakeSeq++}`;
			const row: MemWake = { id, investigationId: threadId, kind, at, reason, payload, state: "pending" };
			wakes.push(row);
			return id;
		}),
	};

	const bus = { publish: vi.fn() };
	const svc = new PrFeedService(prisma as never, prs as never, wakesSvc as never, bus as never);

	return {
		svc,
		prisma,
		prs,
		wakesSvc,
		bus,
		investigations,
		pullRequests,
		prFeeds,
		prPolls,
		prWatches,
		wakes,
		events,
		sharedResult,
		setReadSharedError: (err: Error | null) => {
			readSharedError = err;
		},
		getReadSharedCalls: () => readSharedCalls,
	};
}

describe("PrFeedService (#1024 surface F)", () => {
	it("Three threads whose PR rows share one URL, each with a prFeed row: one tick calls PullRequestsService.readShared exactly once (count calls)", async () => {
		const h = harness();
		const url = "https://github.com/acme/shop/pull/100";
		for (let i = 1; i <= 3; i++) {
			const threadId = `thread-${i}`;
			const prId = `pr-${i}`;
			h.investigations.set(threadId, {
				id: threadId,
				settledAt: null,
				lastActivityAt: null,
				updatedAt: new Date("2026-11-11T12:00:00.000Z"),
				teardownAt: null,
				autoPause: null,
			});
			h.pullRequests.set(prId, {
				id: prId,
				url,
				repo: "acme/shop",
				number: 100,
				title: "Fix bug",
				source: "branch",
				state: "open",
				headSha: "c111111",
				investigationId: threadId,
			});
			h.prFeeds.set(prId, {
				prId,
				investigationId: threadId,
				auto: true,
				state: "watching",
				reason: null,
				cursor: null,
				pending: null,
				since: new Date("2026-11-11T12:00:00.000Z"),
				until: null,
				guardFailures: 0,
			});
		}

		await h.svc.tick(new Date("2026-11-11T12:00:00.000Z"));
		expect(h.getReadSharedCalls()).toBe(1);
	});

	it("A readShared that throws HostReadError(…, 503): prPoll.failures becomes 1 and nextPollAt = now + 4 min; a second failure gives 8 min; a 401 sets each feed state: 'disconnected', reason: 'The git host refused the credential'. A new service instance reading the same stored prPoll row skips the URL until nextPollAt (persisted backoff)", async () => {
		const now = new Date("2026-11-11T12:00:00.000Z");
		const h = harness(now);
		const url = "https://github.com/acme/shop/pull/200";
		const threadId = "thread-err";
		const prId = "pr-err";

		h.investigations.set(threadId, {
			id: threadId,
			settledAt: null,
			lastActivityAt: null,
			updatedAt: now,
			teardownAt: null,
			autoPause: null,
		});
		h.pullRequests.set(prId, {
			id: prId,
			url,
			repo: "acme/shop",
			number: 200,
			title: "Network error PR",
			source: "branch",
			state: "open",
			headSha: "c111111",
			investigationId: threadId,
		});
		h.prFeeds.set(prId, {
			prId,
			investigationId: threadId,
			auto: true,
			state: "watching",
			reason: null,
			cursor: null,
			pending: null,
			since: now,
			until: null,
			guardFailures: 0,
		});

		// 1st failure: 503
		h.setReadSharedError(new HostReadError("unavailable", 503));
		await h.svc.tick(now);

		const poll1 = h.prPolls.get(url);
		expect(poll1?.failures).toBe(1);
		expect(poll1?.nextPollAt.toISOString()).toBe("2026-11-11T12:04:00.000Z");

		// 2nd failure: 503 at now + 4 min
		const now2 = new Date("2026-11-11T12:04:00.000Z");
		await h.svc.tick(now2);
		const poll2 = h.prPolls.get(url);
		expect(poll2?.failures).toBe(2);
		expect(poll2?.nextPollAt.toISOString()).toBe("2026-11-11T12:12:00.000Z"); // now2 + 8 min

		// 401: unauthorized at now2 + 8 min
		const now3 = new Date("2026-11-11T12:12:00.000Z");
		h.setReadSharedError(new HostReadError("unauthorized", 401));
		await h.svc.tick(now3);
		const feedAfter401 = h.prFeeds.get(prId);
		expect(feedAfter401?.state).toBe("disconnected");
		expect(feedAfter401?.reason).toBe("The git host refused the credential");

		// A new service instance reading the same stored prPoll row skips the URL until nextPollAt
		const callsBefore = h.getReadSharedCalls();
		const newSvc = new PrFeedService(h.prisma as never, h.prs as never, h.wakesSvc as never, h.bus as never);
		const pollTimeBeforeNext = new Date("2026-11-11T12:13:00.000Z"); // before nextPollAt
		await newSvc.tick(pollTimeBeforeNext);
		expect(h.getReadSharedCalls()).toBe(callsBefore);
	});

	it("A thread whose lastActivityAt is 8 days old: its feed ends expired with the event line Stopped watching PR #123: thread idle 7 days", async () => {
		const now = new Date("2026-11-11T12:00:00.000Z");
		const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60_000);
		const h = harness(now);
		const threadId = "thread-idle";
		const prId = "pr-idle";

		h.investigations.set(threadId, {
			id: threadId,
			settledAt: null,
			lastActivityAt: eightDaysAgo,
			updatedAt: eightDaysAgo,
			teardownAt: null,
			autoPause: null,
		});
		h.pullRequests.set(prId, {
			id: prId,
			url: "https://github.com/acme/shop/pull/123",
			repo: "acme/shop",
			number: 123,
			title: "Idle PR",
			source: "branch",
			state: "open",
			headSha: "c111111",
			investigationId: threadId,
		});
		h.prFeeds.set(prId, {
			prId,
			investigationId: threadId,
			auto: true,
			state: "watching",
			reason: null,
			cursor: null,
			pending: null,
			since: eightDaysAgo,
			until: null,
			guardFailures: 0,
		});

		await h.svc.tick(now);

		const feed = h.prFeeds.get(prId);
		expect(feed?.state).toBe("expired");
		expect(feed?.reason).toBe("thread idle 7 days");
		const ev = h.events.find((e) => e.investigationId === threadId && e.body.kind === "pr_status");
		expect(ev?.body.phase).toBe("ended");
		expect(ev?.body.lines).toEqual(["Stopped watching PR #123: thread idle 7 days"]);
	});

	it("A branch-source PR with no feed row gets an auto: true feed on the first tick and no message (baseline). An agent-source PR in a configured repo whose headRef is not the thread's branch gets no feed row; a user-source PR likewise", async () => {
		const now = new Date("2026-11-11T12:00:00.000Z");
		const h = harness(now);
		const threadId = "thread-auto";
		h.investigations.set(threadId, {
			id: threadId,
			settledAt: null,
			lastActivityAt: null,
			updatedAt: now,
			teardownAt: null,
			autoPause: null,
		});

		// 1. branch-source PR
		const branchPrId = "pr-branch";
		h.pullRequests.set(branchPrId, {
			id: branchPrId,
			url: "https://github.com/acme/shop/pull/301",
			repo: "acme/shop",
			number: 301,
			title: "Branch PR",
			source: "branch",
			state: "open",
			headSha: "c111111",
			investigationId: threadId,
		});

		// 2. agent-source PR whose headRef is not the thread's branch
		const agentPrId = "pr-agent";
		h.pullRequests.set(agentPrId, {
			id: agentPrId,
			url: "https://github.com/acme/shop/pull/302",
			repo: "acme/shop",
			number: 302,
			title: "Agent PR",
			source: "agent",
			state: "open",
			headSha: "c222222",
			investigationId: threadId,
		});

		// 3. user-source PR whose headRef is not the thread's branch
		const userPrId = "pr-user";
		h.pullRequests.set(userPrId, {
			id: userPrId,
			url: "https://github.com/acme/shop/pull/303",
			repo: "acme/shop",
			number: 303,
			title: "User PR",
			source: "user",
			state: "open",
			headSha: "c333333",
			investigationId: threadId,
		});

		// Shared host response returns headRef "other-branch" (thread's branch is "feat-work")
		h.sharedResult.read.headRef = "other-branch";

		await h.svc.tick(now);

		// branchPrId gets auto: true
		const branchFeed = h.prFeeds.get(branchPrId);
		expect(branchFeed?.auto).toBe(true);
		expect(branchFeed?.state).toBe("watching");
		// baseline sets cursor, no wake scheduled
		expect(h.wakes.length).toBe(0);

		// agentPrId and userPrId get no feed row
		expect(h.prFeeds.has(agentPrId)).toBe(false);
		expect(h.prFeeds.has(userPrId)).toBe(false);
	});

	it("A failing check on the current head: after tick and flush, one pr_status wake exists with at = first line + 60 s, payload units: 1, and its reason contains CI failed: build on; a recovery-only diff creates no wake and leaves the line pending; the next waking line carries both", async () => {
		const now = new Date("2026-11-11T12:00:00.000Z");
		const h = harness(now);
		const threadId = "thread-failing";
		const prId = "pr-failing";
		const headSha = "a1b2c3d";

		h.investigations.set(threadId, {
			id: threadId,
			settledAt: null,
			lastActivityAt: null,
			updatedAt: now,
			teardownAt: null,
			autoPause: null,
		});
		h.pullRequests.set(prId, {
			id: prId,
			url: "https://github.com/acme/shop/pull/400",
			repo: "acme/shop",
			number: 400,
			title: "CI PR",
			source: "branch",
			state: "open",
			headSha,
			investigationId: threadId,
		});
		h.prFeeds.set(prId, {
			prId,
			investigationId: threadId,
			auto: true,
			state: "watching",
			reason: null,
			cursor: JSON.stringify({ checks: {}, headSha, reviews: {}, comments: [] }),
			pending: null,
			since: now,
			until: null,
			guardFailures: 0,
		});

		// 1. Failing check on current head
		h.sharedResult.read.headSha = headSha;
		h.sharedResult.read.detail.checkRuns = [
			{ id: "10", appId: 1, headSha, name: "build", state: "failing", url: "https://ci/log" },
		];

		await h.svc.tick(now);
		await h.svc.flush(threadId, now);

		const pendingWakes1 = h.wakes.filter((w) => w.state === "pending");
		expect(pendingWakes1.length).toBe(1);
		const wake1 = pendingWakes1[0]!;
		expect(wake1.kind).toBe("pr_status");
		expect(wake1.at.toISOString()).toBe("2026-11-11T12:01:00.000Z"); // first line + 60s
		expect(wake1.payload.units).toBe(1);
		expect(wake1.reason).toContain("CI failed: build on");

		// Simulate delivering wake1 so wake1 is no longer pending/unsent
		wake1.state = "done";

		// 2. Recovery-only diff: check recovered to success on same SHA
		const t2 = new Date("2026-11-11T12:05:00.000Z");
		h.sharedResult.read.detail.checkRuns = [
			{ id: "11", appId: 1, headSha, name: "build", state: "passing", url: "https://ci/log" },
		];
		await h.svc.tick(t2);
		await h.svc.flush(threadId, t2);

		// No new wake created
		const pendingWakes = h.wakes.filter((w) => w.state === "pending");
		expect(pendingWakes.length).toBe(0);
		// Line stays pending in prFeed
		const feed = h.prFeeds.get(prId);
		expect(feed?.pending).toContain("Check recovered: build on");

		// 3. Next waking line arrives: new failing test check
		const t3 = new Date("2026-11-11T12:08:00.000Z");
		h.sharedResult.read.detail.checkRuns = [
			{ id: "11", appId: 1, headSha, name: "build", state: "passing", url: "https://ci/log" },
			{ id: "12", appId: 1, headSha, name: "test", state: "failing", url: "https://ci/test-log" },
		];
		await h.svc.tick(t3);
		await h.svc.flush(threadId, t3);

		// Wake now scheduled carrying both lines
		const pendingWakesAfter = h.wakes.filter((w) => w.state === "pending");
		expect(pendingWakesAfter.length).toBe(1);
		const combinedWake = pendingWakesAfter[0]!;
		expect(combinedWake.reason).toContain("Check recovered: build on");
		expect(combinedWake.reason).toContain("CI failed: test on");
	});

	it("watch() after a loop-guard stop sets state watching and clears the thread's autoPause when its prId matches; unwatch() sets stopped with reason Stopped by you and deletes the agent's prWatch row", async () => {
		const now = new Date("2026-11-11T12:00:00.000Z");
		const h = harness(now);
		const threadId = "thread-guard";
		const prId = "pr-guard";

		h.investigations.set(threadId, {
			id: threadId,
			settledAt: null,
			lastActivityAt: null,
			updatedAt: now,
			teardownAt: null,
			autoPause: JSON.stringify({ reason: "loop_guard", prId, since: now.toISOString() }),
		});
		h.pullRequests.set(prId, {
			id: prId,
			url: "https://github.com/acme/shop/pull/500",
			repo: "acme/shop",
			number: 500,
			title: "Loop guard PR",
			source: "branch",
			state: "open",
			headSha: "c111111",
			investigationId: threadId,
		});
		h.prFeeds.set(prId, {
			prId,
			investigationId: threadId,
			auto: true,
			state: "stopped",
			reason: "build still failing after 3 tries",
			cursor: JSON.stringify({ guard: { check: "build", failures: 3 } }),
			pending: null,
			since: now,
			until: null,
			guardFailures: 3,
		});
		h.prWatches.set(prId, {
			prId,
			investigationId: threadId,
			expiresAt: new Date(now.getTime() + 12 * 60 * 60_000),
		});

		// Call watch()
		const watchedPr = await h.svc.watch(threadId, prId);
		expect(watchedPr.watch?.state).toBe("watching");
		const feedAfterWatch = h.prFeeds.get(prId);
		expect(feedAfterWatch?.state).toBe("watching");
		expect(feedAfterWatch?.reason).toBeNull();
		const threadAfterWatch = h.investigations.get(threadId);
		expect(threadAfterWatch?.autoPause).toBeNull();

		// Call unwatch()
		const unwatchedPr = await h.svc.unwatch(threadId, prId, "user");
		expect(unwatchedPr.watch?.state).toBe("stopped");
		expect(unwatchedPr.watch?.reason).toBe("Stopped by you");
		const feedAfterUnwatch = h.prFeeds.get(prId);
		expect(feedAfterUnwatch?.state).toBe("stopped");
		expect(feedAfterUnwatch?.reason).toBe("Stopped by you");
		expect(h.prWatches.has(prId)).toBe(false);
	});

	it("Merged: the feed ends stopped with reason merged, an event phase: 'ended' with the line Merged, and no wake", async () => {
		const now = new Date("2026-11-11T12:00:00.000Z");
		const h = harness(now);
		const threadId = "thread-merge";
		const prId = "pr-merge";

		h.investigations.set(threadId, {
			id: threadId,
			settledAt: null,
			lastActivityAt: null,
			updatedAt: now,
			teardownAt: null,
			autoPause: null,
		});
		h.pullRequests.set(prId, {
			id: prId,
			url: "https://github.com/acme/shop/pull/600",
			repo: "acme/shop",
			number: 600,
			title: "Merged PR",
			source: "branch",
			state: "open",
			headSha: "c111111",
			investigationId: threadId,
		});
		h.prFeeds.set(prId, {
			prId,
			investigationId: threadId,
			auto: true,
			state: "watching",
			reason: null,
			cursor: JSON.stringify({ state: "open", headSha: "c111111" }),
			pending: null,
			since: now,
			until: null,
			guardFailures: 0,
		});

		h.sharedResult.read.state = "merged";

		await h.svc.tick(now);

		const feed = h.prFeeds.get(prId);
		expect(feed?.state).toBe("stopped");
		expect(feed?.reason).toBe("merged");

		const ev = h.events.find((e) => e.investigationId === threadId && e.body.kind === "pr_status");
		expect(ev?.body.phase).toBe("ended");
		expect(ev?.body.lines).toEqual(["Merged"]);

		expect(h.wakes.length).toBe(0);
	});

	it("A settled thread (settledAt after lastActivityAt) is not polled", async () => {
		const now = new Date("2026-11-11T12:00:00.000Z");
		const h = harness(now);
		const threadId = "thread-settled";
		const prId = "pr-settled";

		h.investigations.set(threadId, {
			id: threadId,
			settledAt: now,
			lastActivityAt: new Date(now.getTime() - 60_000),
			updatedAt: new Date(now.getTime() - 60_000),
			teardownAt: null,
			autoPause: null,
		});
		h.pullRequests.set(prId, {
			id: prId,
			url: "https://github.com/acme/shop/pull/700",
			repo: "acme/shop",
			number: 700,
			title: "Settled PR",
			source: "branch",
			state: "open",
			headSha: "c111111",
			investigationId: threadId,
		});
		h.prFeeds.set(prId, {
			prId,
			investigationId: threadId,
			auto: true,
			state: "watching",
			reason: null,
			cursor: null,
			pending: null,
			since: now,
			until: null,
			guardFailures: 0,
		});

		await h.svc.tick(now);
		expect(h.getReadSharedCalls()).toBe(0);
	});

	it("A pr_status event written by a pass carries the PR's tone (e.g. failing for a PR whose checks fail)", async () => {
		const now = new Date("2026-11-11T12:00:00.000Z");
		const h = harness(now);
		const threadId = "thread-tone";
		const prId = "pr-tone";
		const headSha = "sha-tone-1";

		h.investigations.set(threadId, {
			id: threadId,
			settledAt: null,
			lastActivityAt: null,
			updatedAt: now,
			teardownAt: null,
			autoPause: null,
		});
		h.pullRequests.set(prId, {
			id: prId,
			url: "https://github.com/acme/shop/pull/800",
			repo: "acme/shop",
			number: 800,
			title: "Failing PR",
			source: "branch",
			state: "open",
			headSha,
			investigationId: threadId,
			checks: JSON.stringify({ state: "failing", total: 2, failed: 1, pending: 0 }),
		});
		h.prFeeds.set(prId, {
			prId,
			investigationId: threadId,
			auto: true,
			state: "watching",
			reason: null,
			cursor: JSON.stringify({ checks: {}, headSha, reviews: {}, comments: [] }),
			pending: null,
			since: now,
			until: null,
			guardFailures: 0,
		});

		h.sharedResult.read.headSha = headSha;
		h.sharedResult.read.detail.checkRuns = [
			{ id: "101", appId: 1, headSha, name: "lint", state: "failing", url: "https://ci/lint" },
		];

		await h.svc.tick(now);

		const ev = h.events.find(
			(e) => e.investigationId === threadId && e.body.kind === "pr_status",
		);
		expect(ev).toBeDefined();
		expect(ev?.body.tone).toBe("failing");
		expect(ev?.body.pr).toBe("acme/shop#800");
		expect(ev?.body.phase).toBe("noted");
	});
});
