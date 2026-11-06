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
		watch: vi.fn(async () => ({ expiresAt: "2026-01-01T12:00:00.000Z", pr: "acme/api#7" })),
		unwatch: vi.fn(async () => ({ stopped: true })),
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
	it("wakeup_schedule passes the delay and reason with the run's id and says what it scheduled", async () => {
		const { data, call } = tools();
		const r = await call("wakeup_schedule", { delaySeconds: 600, reason: "check the rollout" });
		expect(data.wakeup).toHaveBeenCalledWith("run-1", 600, "check the rollout");
		expect(r.body).toEqual({ scheduled: "2026-01-01T01:00:00.000Z", replacedEarlier: false });
	});

	it("wakeup_schedule answers limit_reached past the budget, and run_ended for any other refusal", async () => {
		const over = tools({ wakeup: async () => ({ error: "12 wakes in a day", limit: true }) });
		const limited = await over.call("wakeup_schedule", { delaySeconds: 60, reason: "again" });
		expect(limited.isError).toBe(true);
		expect(limited.body.error).toBe("limit_reached");
		const ended = tools({ wakeup: async () => ({ error: "the thread has ended" }) });
		const r = await ended.call("wakeup_schedule", { delaySeconds: 60, reason: "again" });
		expect(r.isError).toBe(true);
		expect(r.body.error).toBe("run_ended");
	});

	it("wakeup_schedule refuses a delay outside 60 to 86,400 seconds", async () => {
		const { data, call } = tools();
		expect((await call("wakeup_schedule", { delaySeconds: 59, reason: "x" })).isError).toBe(true);
		expect((await call("wakeup_schedule", { delaySeconds: 86_401, reason: "x" })).isError).toBe(true);
		expect(data.wakeup).not.toHaveBeenCalled();
	});

	it("pr_link answers the PR's id and state, or invalid_input when it cannot link", async () => {
		const { data, call } = tools();
		const ok = await call("pr_link", { url: "https://github.com/acme/api/pull/7" });
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
		const r = await bad.call("pr_link", { url: "https://github.com/other/repo/pull/1" });
		expect(r.isError).toBe(true);
		expect(r.body.error).toBe("invalid_input");
	});

	it("pr_watch answers what it watches and when it gives up, limit_reached past the cap, invalid_input for an unlinked PR", async () => {
		const { data, call } = tools();
		const ok = await call("pr_watch", { prId: "pr-1", until: "merged" });
		expect(data.watch).toHaveBeenCalledWith("run-1", "pr-1", "merged");
		expect(ok.body).toEqual({
			watching: "acme/api#7",
			until: "merged",
			givesUpAt: "2026-01-01T12:00:00.000Z",
		});
		const capped = tools({ watch: async () => ({ error: "5 watches", limit: true }) });
		const full = await capped.call("pr_watch", { prId: "pr-2", until: "review" });
		expect(full.isError).toBe(true);
		expect(full.body.error).toBe("limit_reached");
		const unlinked = tools({ watch: async () => ({ error: "not linked" }) });
		const r = await unlinked.call("pr_watch", { prId: "nope", until: "checks_done" });
		expect(r.isError).toBe(true);
		expect(r.body.error).toBe("invalid_input");
	});

	it("pr_unwatch answers whether anything watched the PR", async () => {
		const { data, call } = tools();
		expect((await call("pr_unwatch", { prId: "pr-1" })).body).toEqual({ stopped: true });
		expect(data.unwatch).toHaveBeenCalledWith("run-1", "pr-1");
		const none = tools({ unwatch: async () => ({ stopped: false }) });
		expect((await none.call("pr_unwatch", { prId: "pr-9" })).body).toEqual({ stopped: false });
	});

	it("serves the two wake-causing tools to attended runs only", () => {
		const served = Object.fromEntries(
			watchTools({} as WatchesData).map((t) => [t.name, t.serves]),
		);
		expect(served.wakeup_schedule).toMatchObject({ attended: true });
		expect(served.pr_watch).toMatchObject({ attended: true });
		expect(served.pr_link).not.toHaveProperty("attended");
		expect(served.pr_unwatch).not.toHaveProperty("attended");
	});
});
