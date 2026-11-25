// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadFeed } from "@prismalens/contracts";
import { type InfiniteData, QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { invalidateTopics, reconnectAsOf, refresh } from "./live-refresh";
import { applyActivity, applyChange } from "./live-stream";
import { orpc } from "./orpc-client";

describe("live refresh and query invalidation (#1181)", () => {
	it("a query fetching when a hint lands is not cancelled and gets exactly one trailing fetch after it settles", async () => {
		const queryClient = new QueryClient();
		let fetchCount = 0;
		let resolveFirst!: () => void;
		const firstPromise = new Promise<void>((r) => {
			resolveFirst = r;
		});
		const key = orpc.investigations.list.key();

		const queryFn = vi.fn().mockImplementation(async () => {
			fetchCount++;
			if (fetchCount === 1) {
				await firstPromise;
				return [{ id: "inv-1" }];
			}
			return [{ id: "inv-1" }, { id: "inv-2" }];
		});

		const observer = new QueryObserver(queryClient, {
			queryKey: key,
			queryFn,
		});
		const unsubscribe = observer.subscribe(() => {});

		await vi.waitFor(() => expect(fetchCount).toBe(1));
		const query = queryClient.getQueryCache().find({ queryKey: key });
		expect(query?.state.fetchStatus).toBe("fetching");

		// Hint lands while in flight
		invalidateTopics(queryClient, ["investigations"]);

		// Fetch was not cancelled
		expect(fetchCount).toBe(1);

		// Settle first fetch
		resolveFirst?.();

		// Exactly one trailing fetch after settling
		await vi.waitFor(() => expect(fetchCount).toBe(2));
		await new Promise((r) => setTimeout(r, 20));
		expect(fetchCount).toBe(2);

		unsubscribe();
	});

	it("refresh: matching idle queries are invalidated by one invalidateQueries call, fetching match re-reads once when fetch ends, and non-matching queries are untouched", async () => {
		const queryClient = new QueryClient();
		const idleKey1 = ["matched", "item-1"];
		const idleKey2 = ["matched", "item-2"];
		const nonMatchingKey = ["unrelated", "item-3"];
		const fetchingKey = ["matched", "fetching-4"];

		queryClient.setQueryData(idleKey1, { data: 1 });
		queryClient.setQueryData(idleKey2, { data: 2 });
		queryClient.setQueryData(nonMatchingKey, { data: 3 });

		let fetchCount = 0;
		let resolveFetch!: () => void;
		const fetchPromise = new Promise<void>((r) => {
			resolveFetch = r;
		});

		const observer = new QueryObserver(queryClient, {
			queryKey: fetchingKey,
			queryFn: async () => {
				fetchCount++;
				if (fetchCount === 1) {
					await fetchPromise;
					return { status: "initial" };
				}
				return { status: "trailing" };
			},
		});
		const unsubscribe = observer.subscribe(() => {});

		await vi.waitFor(() => expect(fetchCount).toBe(1));
		expect(
			queryClient.getQueryCache().find({ queryKey: fetchingKey })?.state
				.fetchStatus,
		).toBe("fetching");

		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

		refresh(queryClient, [{ queryKey: ["matched"] }]);

		expect(invalidateSpy).toHaveBeenCalledTimes(1);
		expect(queryClient.getQueryState(idleKey1)?.isInvalidated).toBe(true);
		expect(queryClient.getQueryState(idleKey2)?.isInvalidated).toBe(true);
		expect(queryClient.getQueryState(nonMatchingKey)?.isInvalidated).toBe(false);
		expect(fetchCount).toBe(1);

		resolveFetch();
		await vi.waitFor(() => expect(fetchCount).toBe(2));
		await new Promise((r) => setTimeout(r, 20));
		expect(fetchCount).toBe(2);

		unsubscribe();
	});

	it("a hint re-reads the thread list first and every other matched query only once the list lands", async () => {
		const queryClient = new QueryClient();
		const feedKey = orpc.threads.feed.key({ input: { cursor: 0 } });
		const asksKey = orpc.threads.asks.key({ input: {} });
		const order: string[] = [];
		let landList!: () => void;
		const observe = (key: unknown[], name: string, wait?: Promise<void>) => {
			let n = 0;
			const o = new QueryObserver(queryClient, {
				queryKey: key,
				queryFn: async () => {
					if (n++ > 0) {
						order.push(name);
						if (wait) await wait;
					}
					return { name };
				},
			});
			return o.subscribe(() => {});
		};
		const listLands = new Promise<void>((r) => {
			landList = r;
		});
		const offFeed = observe(feedKey, "feed", listLands);
		const offAsks = observe(asksKey, "asks");
		await vi.waitFor(() =>
			expect(queryClient.getQueryState(asksKey)?.status).toBe("success"),
		);
		await vi.waitFor(() =>
			expect(queryClient.getQueryState(feedKey)?.status).toBe("success"),
		);

		invalidateTopics(queryClient, ["threads"]);

		expect(queryClient.getQueryState(asksKey)?.isInvalidated).toBe(true);
		await vi.waitFor(() => expect(order).toEqual(["feed"]));
		await new Promise((r) => setTimeout(r, 20));
		expect(order).toEqual(["feed"]);
		landList();
		await vi.waitFor(() => expect(order).toEqual(["feed", "asks"]));
		expect(queryClient.getQueryState(asksKey)?.isInvalidated).toBe(false);

		offFeed();
		offAsks();
	});

	it("scope: hint threads/investigations scoped to ['a'] skips get({id:'b'}) and getStatus({id:'b'}) but refreshes get({id:'a'}) and non-per-thread queries", () => {
		const queryClient = new QueryClient();
		const keyGetA = orpc.investigations.get.key({ input: { id: "a" } });
		const keyGetB = orpc.investigations.get.key({ input: { id: "b" } });
		const keyStatusB = orpc.investigations.getStatus.key({ input: { id: "b" } });
		const keyList = orpc.investigations.list.key();
		const keyThreads = orpc.threads.key();

		queryClient.setQueryData(keyGetA, { id: "a" });
		queryClient.setQueryData(keyGetB, { id: "b" });
		queryClient.setQueryData(keyStatusB, { status: "running" });
		queryClient.setQueryData(keyList, []);
		queryClient.setQueryData(keyThreads, []);

		invalidateTopics(queryClient, ["investigations", "threads"], ["a"]);

		expect(queryClient.getQueryState(keyGetB)?.isInvalidated).toBe(false);
		expect(queryClient.getQueryState(keyStatusB)?.isInvalidated).toBe(false);
		expect(queryClient.getQueryState(keyGetA)?.isInvalidated).toBe(true);
		expect(queryClient.getQueryState(keyList)?.isInvalidated).toBe(true);
		expect(queryClient.getQueryState(keyThreads)?.isInvalidated).toBe(true);
	});

	it("the investigations and threads topics also re-read a thread's PR subscriptions and its thread tree (#1179)", () => {
		const reread = (topic: "investigations" | "threads") => {
			const queryClient = new QueryClient();
			const subs = orpc.prSubscriptions.list.key({ input: { id: "a" } });
			const tree = orpc.threadTree.key();
			queryClient.setQueryData(subs, []);
			queryClient.setQueryData(tree, []);
			invalidateTopics(queryClient, [topic]);
			return [
				queryClient.getQueryState(subs)?.isInvalidated,
				queryClient.getQueryState(tree)?.isInvalidated,
			];
		};
		expect(reread("investigations")).toEqual([true, true]);
		expect(reread("threads")).toEqual([true, true]);
	});

	it("applyActivity patches feed rows newer only, leaves dataUpdatedAt unchanged, never fetches, skips invalidated query, patches get session.lastActivityAt, and re-applies after non-manual fetch returns older data", async () => {
		const queryClient = new QueryClient();
		const feedKey = orpc.threads.feed.key();
		const getKey = orpc.investigations.get.key({ input: { id: "t1" } });

		const initialFeed = {
			pageParams: [undefined],
			pages: [
				{
					units: [
						{
							section: "active",
							incident: null,
							threads: [
								{
									id: "t1",
									lastActivityAt: "2026-11-18T01:00:00.000Z",
									latestText: "old text",
								},
							],
						},
					],
				},
			],
		} as unknown as InfiniteData<ThreadFeed>;

		queryClient.setQueryData(feedKey, initialFeed);
		queryClient.setQueryData(getKey, {
			id: "t1",
			session: { lastActivityAt: "2026-11-18T01:00:00.000Z" },
		});

		const beforeDataUpdatedAt = queryClient.getQueryState(feedKey)?.dataUpdatedAt;

		// 1. Patches newer only
		applyActivity(queryClient, [
			{
				id: "t1",
				at: "2026-11-18T02:00:00.000Z",
				text: "new text",
			},
		]);

		const feedAfter1 = queryClient.getQueryData<InfiniteData<ThreadFeed>>(feedKey);
		expect(feedAfter1?.pages[0]?.units[0]?.threads[0]?.lastActivityAt).toBe(
			"2026-11-18T02:00:00.000Z",
		);
		expect(feedAfter1?.pages[0]?.units[0]?.threads[0]?.latestText).toBe("new text");

		// 2. Older activity ignored
		applyActivity(queryClient, [
			{
				id: "t1",
				at: "2026-11-18T01:30:00.000Z",
				text: "stale text",
			},
		]);
		const feedAfterOlder = queryClient.getQueryData<InfiniteData<ThreadFeed>>(feedKey);
		expect(feedAfterOlder?.pages[0]?.units[0]?.threads[0]?.lastActivityAt).toBe(
			"2026-11-18T02:00:00.000Z",
		);

		// 3. Leaves dataUpdatedAt unchanged
		expect(queryClient.getQueryState(feedKey)?.dataUpdatedAt).toBe(
			beforeDataUpdatedAt,
		);

		// 4. Patches investigations.get session.lastActivityAt
		const getAfter = queryClient.getQueryData<{
			id: string;
			session?: { lastActivityAt: string };
		}>(getKey);
		expect(getAfter?.session?.lastActivityAt).toBe("2026-11-18T02:00:00.000Z");

		// 5. Skips an invalidated query
		queryClient.invalidateQueries({ queryKey: feedKey });
		applyActivity(queryClient, [
			{
				id: "t1",
				at: "2026-11-18T03:00:00.000Z",
				text: "even newer",
			},
		]);
		const feedAfterInvalidated =
			queryClient.getQueryData<InfiniteData<ThreadFeed>>(feedKey);
		expect(
			feedAfterInvalidated?.pages[0]?.units[0]?.threads[0]?.lastActivityAt,
		).toBe("2026-11-18T02:00:00.000Z");

		// 6. Re-applies after a non-manual successful fetch returns older data
		const fetchMock = vi.fn().mockResolvedValue({
			id: "t1",
			session: { lastActivityAt: "2026-11-18T01:00:00.000Z" },
		});
		await queryClient.fetchQuery({ queryKey: getKey, queryFn: fetchMock });
		const getReApplied = queryClient.getQueryData<{
			id: string;
			session?: { lastActivityAt: string };
		}>(getKey);
		expect(getReApplied?.session?.lastActivityAt).toBe(
			"2026-11-18T03:00:00.000Z",
		);
	});

	it("activity at t1 then t3 preserves latestText when a feed row has lastActivityAt t2 and latestText B, and applies text A to a row older than t1", async () => {
		// Feed row newer than text keeps its own text, older row takes earlier activity text.
		const queryClient = new QueryClient();
		const feedKey = orpc.threads.feed.key();
		const t0 = "2026-11-18T00:00:00.000Z";
		const t1 = "2026-11-18T01:00:00.000Z";
		const t2 = "2026-11-18T02:00:00.000Z";
		const t3 = "2026-11-18T03:00:00.000Z";

		applyActivity(queryClient, [{ id: "t1", at: t1, text: "A" }]);
		applyActivity(queryClient, [{ id: "t1", at: t3 }]);

		await queryClient.fetchQuery({
			queryKey: feedKey,
			queryFn: async () =>
				({
					pageParams: [undefined],
					pages: [
						{
							units: [
								{
									section: "active",
									incident: null,
									threads: [
										{
											id: "t1",
											lastActivityAt: t2,
											latestText: "B",
										},
									],
								},
							],
						},
					],
				}) as unknown as InfiniteData<ThreadFeed>,
		});

		const feed1 = queryClient.getQueryData<InfiniteData<ThreadFeed>>(feedKey);
		const row1 = feed1?.pages[0]?.units[0]?.threads[0];
		expect(row1?.lastActivityAt).toBe(t3);
		expect(row1?.latestText).toBe("B");

		await queryClient.fetchQuery({
			queryKey: feedKey,
			queryFn: async () =>
				({
					pageParams: [undefined],
					pages: [
						{
							units: [
								{
									section: "active",
									incident: null,
									threads: [
										{
											id: "t1",
											lastActivityAt: t0,
											latestText: "initial",
										},
									],
								},
							],
						},
					],
				}) as unknown as InfiniteData<ThreadFeed>,
		});

		const feed2 = queryClient.getQueryData<InfiniteData<ThreadFeed>>(feedKey);
		const row2 = feed2?.pages[0]?.units[0]?.threads[0];
		expect(row2?.lastActivityAt).toBe(t3);
		expect(row2?.latestText).toBe("A");
	});

	it("applyChange handles detail, sequence ordering, beat cursor, replay after beat, and reset", () => {
		const queryClient = new QueryClient();
		const getAKey = orpc.investigations.get.key({ input: { id: "a" } });
		const getBKey = orpc.investigations.get.key({ input: { id: "b" } });
		const listKey = orpc.investigations.list.key();
		const alertsKey = orpc.alerts.key();

		queryClient.setQueryData(getAKey, { id: "a" });
		queryClient.setQueryData(getBKey, { id: "b" });
		queryClient.setQueryData(listKey, []);
		queryClient.setQueryData(alertsKey, []);

		// detail:["a"] refreshes only get({id:"a"}) and investigations.list
		applyChange(queryClient, {
			cursor: "ep1.1",
			topics: [],
			detail: ["a"],
		});
		expect(queryClient.getQueryState(getAKey)?.isInvalidated).toBe(true);
		expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
		expect(queryClient.getQueryState(getBKey)?.isInvalidated).toBe(false);

		// Frame with seq <= last is dropped
		queryClient.setQueryData(alertsKey, []);
		expect(queryClient.getQueryState(alertsKey)?.isInvalidated).toBe(false);

		applyChange(queryClient, {
			cursor: "ep2.5",
			topics: ["alerts"],
		});
		expect(queryClient.getQueryState(alertsKey)?.isInvalidated).toBe(true);

		queryClient.setQueryData(alertsKey, []);
		applyChange(queryClient, {
			cursor: "ep2.5",
			topics: ["alerts"],
		});
		expect(queryClient.getQueryState(alertsKey)?.isInvalidated).toBe(false);

		applyChange(queryClient, {
			cursor: "ep2.4",
			topics: ["alerts"],
		});
		expect(queryClient.getQueryState(alertsKey)?.isInvalidated).toBe(false);

		// Frame replayed after a beat with lower cursor is applied (OBJ-012 regression)
		applyChange(queryClient, {
			cursor: "ep3.10",
			reset: true,
		});
		queryClient.setQueryData(alertsKey, []);
		applyChange(queryClient, {
			beat: true,
			cursor: "ep3.10",
		});
		applyChange(queryClient, {
			cursor: "ep3.11",
			topics: ["alerts"],
		});
		expect(queryClient.getQueryState(alertsKey)?.isInvalidated).toBe(true);

		// Reset refreshes all topics and marks pl:live-reset
		const markCountBefore = performance.getEntriesByName("pl:live-reset").length;
		applyChange(queryClient, {
			reset: true,
			cursor: "ep4.1",
		});
		expect(performance.getEntriesByName("pl:live-reset").length).toBe(
			markCountBefore + 1,
		);
		expect(queryClient.getQueryState(alertsKey)?.isInvalidated).toBe(true);
		expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
	});
});

describe("hintComing", () => {
	it("is true before the stream's first connect and while it is up, and false once it drops", async () => {
		vi.resetModules();
		const m = await import("./live-refresh");
		expect(m.hintComing()).toBe(true);
		m.setConnected(true);
		expect(m.hintComing()).toBe(true);
		m.setConnected(false);
		expect(m.hintComing()).toBe(false);
		m.setConnected(true);
		expect(m.hintComing()).toBe(true);
	});
});

describe("reconnectAsOf", () => {
	it("says nothing while connected or for the first ten seconds down", () => {
		expect(reconnectAsOf({ connected: true, lostAt: 0 }, 60_000)).toBeNull();
		expect(reconnectAsOf({ connected: false, lostAt: 1_000 }, 10_999)).toBeNull();
	});

	it("names when the screen was last live once the stream has been down ten seconds", () => {
		expect(reconnectAsOf({ connected: false, lostAt: 1_000 }, 11_000)).toBe(1_000);
	});
});

describe("change hints and immutable investigation queries (#874)", () => {
	const id = "d0111111-1111-4111-8111-111111111111";

	function seedQueries(queryClient: QueryClient) {
		const getKey = orpc.investigations.get.key({ input: { id } });
		const getStatusKey = orpc.investigations.getStatus.key({ input: { id } });
		const listKey = orpc.investigations.list.key({ input: {} });
		const getEventsKey = orpc.investigations.getEvents.key({ input: { id } });
		const getBlobKey = orpc.investigations.getBlob.key({
			input: { id, sha: "a".repeat(40), path: "src/a.ts" },
		});
		const incidentsListKey = orpc.incidents.list.key({ input: {} });

		queryClient.setQueryData(getKey, { id });
		queryClient.setQueryData(getStatusKey, { status: "running" });
		queryClient.setQueryData(listKey, []);
		queryClient.setQueryData(getEventsKey, []);
		queryClient.setQueryData(getBlobKey, { content: "test" });
		queryClient.setQueryData(incidentsListKey, []);

		return {
			getKey,
			getStatusKey,
			listKey,
			getEventsKey,
			getBlobKey,
			incidentsListKey,
		};
	}

	it("invalidates mutable investigation and incident queries on investigations topic", () => {
		const queryClient = new QueryClient();
		const { getKey, getStatusKey, listKey, incidentsListKey } =
			seedQueries(queryClient);

		invalidateTopics(queryClient, ["investigations"]);

		expect(queryClient.getQueryState(getKey)?.isInvalidated).toBe(true);
		expect(queryClient.getQueryState(getStatusKey)?.isInvalidated).toBe(true);
		expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
		expect(queryClient.getQueryState(incidentsListKey)?.isInvalidated).toBe(
			true,
		);
	});

	it("does not invalidate getEvents and getBlob queries on investigations topic", () => {
		const queryClient = new QueryClient();
		const { getEventsKey, getBlobKey } = seedQueries(queryClient);

		invalidateTopics(queryClient, ["investigations"]);

		expect(queryClient.getQueryState(getEventsKey)?.isInvalidated).toBe(false);
		expect(queryClient.getQueryState(getBlobKey)?.isInvalidated).toBe(false);
	});

	it("does not refetch an active getEvents observer on investigations topic", async () => {
		const queryClient = new QueryClient();
		const getEventsKey = orpc.investigations.getEvents.key({ input: { id } });
		const queryFn = vi.fn().mockResolvedValue([]);
		const observer = new QueryObserver(queryClient, {
			queryKey: getEventsKey,
			queryFn,
			staleTime: Infinity,
		});

		const unsubscribe = observer.subscribe(() => {});
		// Await the initial fetch triggered by subscribing the observer.
		await vi.waitFor(() => {
			expect(queryFn).toHaveBeenCalledTimes(1);
		});

		invalidateTopics(queryClient, ["investigations"]);

		expect(queryFn).toHaveBeenCalledTimes(1);
		expect(queryClient.getQueryState(getEventsKey)?.isInvalidated).toBe(false);
		unsubscribe();
	});

	it("leaves getEvents and getBlob untouched when invalidating incidents and alerts", () => {
		const queryClient = new QueryClient();
		const { getEventsKey, getBlobKey } = seedQueries(queryClient);

		invalidateTopics(queryClient, ["incidents", "alerts"]);

		expect(queryClient.getQueryState(getEventsKey)?.isInvalidated).toBe(false);
		expect(queryClient.getQueryState(getBlobKey)?.isInvalidated).toBe(false);
	});
});
