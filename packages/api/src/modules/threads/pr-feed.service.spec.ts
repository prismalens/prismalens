// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import { ORPCError } from "@orpc/nest";
import type { PrWatch, PullRequest } from "@prismalens/contracts";
import { PrFeedService } from "./pr-feed.service.js";

const THREAD = "6a3b1c2d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const pr = (id: string = "pr1"): PullRequest => ({
	id,
	url: `https://github.com/acme/shop/pull/${id}`,
	host: "github",
	repo: "acme/shop",
	number: 12,
	title: "Fix pool",
	state: "open",
	review: "review_required",
	checks: { state: "none", total: 0, failed: 0, pending: 0 },
	conflicts: false,
	tone: "attention",
	source: "agent",
	fetchedAt: null,
	watch: null,
});

const mockWatch: PrWatch = {
	state: "watching",
	auto: false,
	until: "2026-11-11T12:00:00.000Z",
	reason: null,
	since: new Date().toISOString(),
};

function harness(storedPrs: PullRequest[] = [pr("pr1")]) {
	const watchesMap = new Map<string, PrWatch>();
	const prs = {
		stored: vi.fn(async (t: string) => (t === THREAD ? storedPrs : [])),
	};
	const subscriptions = {
		watches: vi.fn(async (_t: string) => new Map(watchesMap)),
		watchFromUser: vi.fn(async (_t: string, prId: string) => {
			watchesMap.set(prId, mockWatch);
		}),
		unwatchFromUser: vi.fn(async (_t: string, prId: string) => {
			watchesMap.delete(prId);
		}),
	};
	const svc = new PrFeedService(prs as never, subscriptions as never);
	return { svc, prs, subscriptions, watchesMap };
}

describe("PrFeedService facade (#1179 D3)", () => {
	it("watches returns each linked PR's watch from subscriptions", async () => {
		const h = harness();
		h.watchesMap.set("pr1", mockWatch);
		const result = await h.svc.watches(THREAD);
		expect(h.subscriptions.watches).toHaveBeenCalledWith(THREAD);
		expect(result.get("pr1")).toEqual(mockWatch);
	});

	it("withWatches decorates each PR in the list with its watch", async () => {
		const h = harness([pr("pr1"), pr("pr2")]);
		h.watchesMap.set("pr1", mockWatch);
		const result = await h.svc.withWatches(THREAD, { pullRequests: [pr("pr1"), pr("pr2")] });
		expect(result.pullRequests[0]?.watch).toEqual(mockWatch);
		expect(result.pullRequests[1]?.watch).toBeNull();
	});

	it("watch calls watchFromUser on subscriptions and returns PR with watch", async () => {
		const h = harness([pr("pr1")]);
		const result = await h.svc.watch(THREAD, "pr1");
		expect(h.subscriptions.watchFromUser).toHaveBeenCalledWith(THREAD, "pr1");
		expect(result.id).toBe("pr1");
		expect(result.watch).toEqual(mockWatch);
	});

	it("watch throws NOT_FOUND if PR is not linked to thread", async () => {
		const h = harness([pr("pr1")]);
		await expect(h.svc.watch(THREAD, "nope")).rejects.toThrow(ORPCError);
		expect(h.subscriptions.watchFromUser).not.toHaveBeenCalled();
	});

	it("unwatch calls unwatchFromUser on subscriptions and returns PR with null watch", async () => {
		const h = harness([pr("pr1")]);
		h.watchesMap.set("pr1", mockWatch);
		const result = await h.svc.unwatch(THREAD, "pr1");
		expect(h.subscriptions.unwatchFromUser).toHaveBeenCalledWith(THREAD, "pr1");
		expect(result.id).toBe("pr1");
		expect(result.watch).toBeNull();
	});

	it("unwatch throws NOT_FOUND if PR is not linked to thread", async () => {
		const h = harness([pr("pr1")]);
		await expect(h.svc.unwatch(THREAD, "nope")).rejects.toThrow(ORPCError);
		expect(h.subscriptions.unwatchFromUser).not.toHaveBeenCalled();
	});
});
