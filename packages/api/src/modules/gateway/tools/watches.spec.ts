// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PullRequest } from "@prismalens/contracts";
import { executeTool, resultValue } from "@prismalens/integrations/harness";
import { describe, expect, it, vi } from "vitest";
import { type WatchesData, watchTools } from "./watches.js";

const ctx = { runId: "run-1", signal: new AbortController().signal };

function tools(over: Partial<WatchesData> = {}) {
	const data = {
		wakeup: vi.fn(async () => ({ at: "2026-01-01T01:00:00.000Z", replaced: false })),
		link: vi.fn(async () => ({
			pr: {
				id: "pr-1",
				repo: "acme/api",
				number: 7,
				title: "Fix the pool",
				state: "open",
				review: "none",
				checks: "pending",
			} as unknown as PullRequest,
		})),
		subscribe: vi.fn(async () => ({ value: { id: "sub-1", subscribed: true } })),
		unsubscribe: vi.fn(async () => ({ value: { stopped: true } })),
		subscriptions: vi.fn(async () => ({ value: { subscriptions: [] } })),
		...over,
	} satisfies WatchesData;
	const byName = Object.fromEntries(watchTools(data).map((t) => [t.name, t]));
	const call = async (name: string, args: unknown) => {
		const c = await executeTool(byName[name] as never, args, ctx);
		return { isError: c.isError, body: resultValue(c.output) };
	};
	return { data, call };
}

describe("the wake and PR tools (#1024 spec B)", () => {
	it("pl_wakeup_schedule passes the delay and reason with the run's id and says what it scheduled", async () => {
		const { data, call } = tools();
		const r = await call("pl_wakeup_schedule", { delaySeconds: 600, reason: "check the rollout" });
		expect(data.wakeup).toHaveBeenCalledWith("run-1", 600, "check the rollout");
		expect(r.body).toEqual({ scheduled: "2026-01-01T01:00:00.000Z", replacedEarlier: false });
	});

	it("pl_wakeup_schedule answers limit_reached past the budget, and run_ended for any other refusal", async () => {
		const over = tools({ wakeup: async () => ({ error: "12 wakes in a day", limit: true }) });
		const limited = await over.call("pl_wakeup_schedule", { delaySeconds: 60, reason: "again" });
		expect(limited.isError).toBe(true);
		expect(limited.body.error).toBe("limit_reached");
		const ended = tools({ wakeup: async () => ({ error: "the thread has ended" }) });
		const r = await ended.call("pl_wakeup_schedule", { delaySeconds: 60, reason: "again" });
		expect(r.isError).toBe(true);
		expect(r.body.error).toBe("run_ended");
	});

	it("pl_wakeup_schedule refuses a delay outside 60 to 86,400 seconds", async () => {
		const { data, call } = tools();
		expect((await call("pl_wakeup_schedule", { delaySeconds: 59, reason: "x" })).isError).toBe(true);
		expect((await call("pl_wakeup_schedule", { delaySeconds: 86_401, reason: "x" })).isError).toBe(true);
		expect(data.wakeup).not.toHaveBeenCalled();
	});

	it("pl_pr_link answers the PR's id and state, or invalid_input when it cannot link", async () => {
		const { data, call } = tools();
		const ok = await call("pl_pr_link", { url: "https://github.com/acme/api/pull/7" });
		expect(data.link).toHaveBeenCalledWith("run-1", "https://github.com/acme/api/pull/7");
		expect(ok.body).toEqual({
			id: "pr-1",
			pr: "acme/api#7",
			title: "Fix the pool",
			state: "open",
			review: "none",
			checks: "pending",
		});
		const bad = tools({ link: async () => ({ error: "PrismaLens does not know that repository" }) });
		const r = await bad.call("pl_pr_link", { url: "https://github.com/other/repo/pull/1" });
		expect(r.isError).toBe(true);
		expect(r.body.error).toBe("invalid_input");
	});

	it("pl_pr_subscribe answers the subscription, limit_reached past the cap, invalid_input for an unlinked PR", async () => {
		const { data, call } = tools();
		const ok = await call("pl_pr_subscribe", { pr: "https://github.com/acme/api/pull/7" });
		expect(data.subscribe).toHaveBeenCalledWith("run-1", expect.objectContaining({ pr: "https://github.com/acme/api/pull/7" }));
		expect(ok.body).toEqual({ id: "sub-1", subscribed: true });
		const capped = tools({ subscribe: async () => ({ error: "limit_reached", message: "10 subscriptions", next: "Cancel one" }) });
		const full = await capped.call("pl_pr_subscribe", { pr: "https://github.com/acme/api/pull/8" });
		expect(full.isError).toBe(true);
		expect(full.body.error).toBe("limit_reached");
		const unlinked = tools({ subscribe: async () => ({ error: "invalid_input", message: "not linked", next: "Link it" }) });
		const r = await unlinked.call("pl_pr_subscribe", { pr: "nope" });
		expect(r.isError).toBe(true);
		expect(r.body.error).toBe("invalid_input");
	});

	it("pl_pr_unsubscribe passes the subscription or PR and answers whether it stopped", async () => {
		const { data, call } = tools();
		expect((await call("pl_pr_unsubscribe", { pr: "https://github.com/acme/api/pull/7" })).body).toEqual({ stopped: true });
		expect(data.unsubscribe).toHaveBeenCalledWith("run-1", { pr: "https://github.com/acme/api/pull/7" });
		const none = tools({ unsubscribe: async () => ({ value: { stopped: false } }) });
		expect((await none.call("pl_pr_unsubscribe", { pr: "https://github.com/acme/api/pull/9" })).body).toEqual({ stopped: false });
	});

	it("pl_pr_subscriptions returns the thread's subscriptions", async () => {
		const { data, call } = tools();
		expect((await call("pl_pr_subscriptions", {})).body).toEqual({ subscriptions: [] });
		expect(data.subscriptions).toHaveBeenCalledWith("run-1");
	});

	it("serves the two wake-causing tools to attended runs only", () => {
		const served = Object.fromEntries(
			watchTools({} as WatchesData).map((t) => [t.name, t.serves]),
		);
		expect(served.pl_wakeup_schedule).toMatchObject({ attended: true });
		expect(served.pl_pr_subscribe).toMatchObject({ attended: true });
		expect(served.pl_pr_link).not.toHaveProperty("attended");
		expect(served.pl_pr_unsubscribe).not.toHaveProperty("attended");
		expect(served.pl_pr_subscriptions).not.toHaveProperty("attended");
	});
});
