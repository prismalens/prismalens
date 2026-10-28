// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { invalidateTopics, reconnectAsOf } from "./live-refresh";
import { orpc } from "./orpc-client";

describe("invalidateTopics (walk f27)", () => {
	it("re-reads the incident lists when an alert or a run changes, once each", () => {
		const queryClient = new QueryClient();
		const invalidate = vi.spyOn(queryClient, "invalidateQueries");

		invalidateTopics(queryClient, ["alerts", "investigations"]);

		const keys = invalidate.mock.calls.map(([f]) => JSON.stringify(f?.queryKey));
		expect(keys).toEqual([
			JSON.stringify(orpc.alerts.key()),
			JSON.stringify(orpc.incidents.key()),
			JSON.stringify(orpc.setup.key()),
			JSON.stringify(orpc.webhooks.lastDelivery.key()),
			JSON.stringify(orpc.investigations.key()),
			JSON.stringify(orpc.schedules.key()),
		]);
	});

	it("re-reads schedules when one changes or a run it started moves (#979)", () => {
		const queryClient = new QueryClient();
		const invalidate = vi.spyOn(queryClient, "invalidateQueries");

		invalidateTopics(queryClient, ["schedules"]);

		const keys = invalidate.mock.calls.map(([f]) => JSON.stringify(f?.queryKey));
		expect(keys).toEqual([JSON.stringify(orpc.schedules.key())]);
	});

	it("invalidates incidents, setup, recommendations and timeline keys in order (#673 walk 4)", () => {
		const queryClient = new QueryClient();
		const invalidate = vi.spyOn(queryClient, "invalidateQueries");

		invalidateTopics(queryClient, ["incidents"]);

		const keys = invalidate.mock.calls.map(([f]) => JSON.stringify(f?.queryKey));
		expect(keys).toEqual([
			JSON.stringify(orpc.incidents.key()),
			JSON.stringify(orpc.setup.key()),
			JSON.stringify(orpc.recommendations.key()),
			JSON.stringify(orpc.timeline.key()),
		]);
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
