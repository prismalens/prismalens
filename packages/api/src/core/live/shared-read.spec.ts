// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Request } from "express";
import { describe, expect, it, vi } from "vitest";
import { liveChanges } from "./live-changes.js";
import { sharedRead } from "./shared-read.js";

describe("sharedRead (#1181)", () => {
	it("single flight: two concurrent calls result in one run", async () => {
		const run = vi.fn().mockImplementation(async () => {
			await new Promise((r) => setTimeout(r, 10));
			return { data: "single-flight" };
		});

		const p1 = sharedRead("route-concurrent", { id: "1" }, run);
		const p2 = sharedRead("route-concurrent", { id: "1" }, run);

		const [r1, r2] = await Promise.all([p1, p2]);
		expect(r1).toEqual({ data: "single-flight" });
		expect(r2).toEqual({ data: "single-flight" });
		expect(run).toHaveBeenCalledTimes(1);
	});

	it("hit within 1 s at the same topicVersion", async () => {
		vi.useFakeTimers();
		try {
			const run = vi.fn().mockResolvedValue("hit-data");
			await sharedRead("route-hit", { id: "2" }, run);
			expect(run).toHaveBeenCalledTimes(1);

			// Advance by 500ms -> within 1s
			vi.advanceTimersByTime(500);
			const r2 = await sharedRead("route-hit", { id: "2" }, run);
			expect(r2).toBe("hit-data");
			expect(run).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("miss after 1 s or after liveChanges.noteTopic", async () => {
		vi.useFakeTimers();
		try {
			const run = vi.fn().mockResolvedValue("data");
			await sharedRead("route-miss", { id: "3" }, run);
			expect(run).toHaveBeenCalledTimes(1);

			// Miss after 1s
			vi.advanceTimersByTime(1001);
			await sharedRead("route-miss", { id: "3" }, run);
			expect(run).toHaveBeenCalledTimes(2);

			// Hit within 1s
			vi.advanceTimersByTime(200);
			await sharedRead("route-miss", { id: "3" }, run);
			expect(run).toHaveBeenCalledTimes(2);

			// Miss after liveChanges.noteTopic
			liveChanges.noteTopic("alerts");
			await sharedRead("route-miss", { id: "3" }, run);
			expect(run).toHaveBeenCalledTimes(3);
		} finally {
			vi.useRealTimers();
		}
	});

	it("a rejection is evicted from memo", async () => {
		const failing = vi.fn().mockRejectedValue(new Error("failure"));
		await expect(
			sharedRead("route-err", { id: "4" }, failing),
		).rejects.toThrow("failure");

		const recovered = vi.fn().mockResolvedValue("recovered");
		await expect(
			sharedRead("route-err", { id: "4" }, recovered),
		).resolves.toBe("recovered");
		expect(recovered).toHaveBeenCalledTimes(1);
	});

	it("different inputs are separate cache entries", async () => {
		const runA = vi.fn().mockResolvedValue("val-A");
		const runB = vi.fn().mockResolvedValue("val-B");

		const [rA, rB] = await Promise.all([
			sharedRead("route-inputs", ["id-1", true], runA),
			sharedRead("route-inputs", ["id-1", false], runB),
		]);

		expect(rA).toBe("val-A");
		expect(rB).toBe("val-B");
		expect(runA).toHaveBeenCalledTimes(1);
		expect(runB).toHaveBeenCalledTimes(1);
	});

	it("server-timing header set via fake request.res.setHeader", async () => {
		const setHeader = vi.fn();
		const fakeReq = { res: { setHeader } } as unknown as Request;

		await sharedRead("route-header", 1, async () => "ok", fakeReq);
		expect(setHeader).toHaveBeenCalledWith(
			"server-timing",
			'shared;desc="miss"',
		);

		setHeader.mockClear();
		await sharedRead("route-header", 1, async () => "ok", fakeReq);
		expect(setHeader).toHaveBeenCalledWith(
			"server-timing",
			'shared;desc="hit"',
		);
	});
});
