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

	it("joins a read still pending after 1.5 s, hits within 1 s after settling, and misses after 1 s", async () => {
		// A pending flight joins regardless of elapsed time; settled cache is bounded to 1 s.
		vi.useFakeTimers();
		try {
			let resolveRun!: (value: string) => void;
			const run = vi.fn().mockImplementation(
				() =>
					new Promise<string>((resolve) => {
						resolveRun = resolve;
					}),
			);

			const p1 = sharedRead("route-long-pending", { id: "p1" }, run);
			expect(run).toHaveBeenCalledTimes(1);

			vi.advanceTimersByTime(1500);
			const p2 = sharedRead("route-long-pending", { id: "p1" }, run);
			expect(run).toHaveBeenCalledTimes(1);
			expect(p2).toBe(p1);

			resolveRun("settled-data");
			await vi.advanceTimersByTimeAsync(0);
			expect(await p1).toBe("settled-data");
			expect(await p2).toBe("settled-data");

			vi.advanceTimersByTime(800);
			const p3 = await sharedRead("route-long-pending", { id: "p1" }, run);
			expect(p3).toBe("settled-data");
			expect(run).toHaveBeenCalledTimes(1);

			run.mockResolvedValue("new-data");
			vi.advanceTimersByTime(300);
			const p4 = await sharedRead("route-long-pending", { id: "p1" }, run);
			expect(p4).toBe("new-data");
			expect(run).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it("evicts a rejected read from memo under fake timers", async () => {
		// A failed promise removes itself from memo so subsequent calls re-run.
		vi.useFakeTimers();
		try {
			let rejectRun!: (err: Error) => void;
			const failing = vi.fn().mockImplementation(
				() =>
					new Promise((_, reject) => {
						rejectRun = reject;
					}),
			);

			const p1 = sharedRead("route-pending-reject", { id: "rej" }, failing);
			rejectRun(new Error("failure"));
			await expect(p1).rejects.toThrow("failure");

			const recovered = vi.fn().mockResolvedValue("recovered");
			const p2 = await sharedRead(
				"route-pending-reject",
				{ id: "rej" },
				recovered,
			);
			expect(p2).toBe("recovered");
			expect(recovered).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("starts a new read on topic version bump even while one is pending", async () => {
		// A write clearing the topicVersion evicts in-flight reads immediately.
		vi.useFakeTimers();
		try {
			let resolveFirst!: (value: string) => void;
			const run1 = vi.fn().mockImplementation(
				() =>
					new Promise<string>((resolve) => {
						resolveFirst = resolve;
					}),
			);
			const p1 = sharedRead("route-version-bump", { id: "vb" }, run1);
			expect(run1).toHaveBeenCalledTimes(1);

			liveChanges.noteTopic("alerts");

			const run2 = vi.fn().mockResolvedValue("bumped-data");
			const p2 = await sharedRead("route-version-bump", { id: "vb" }, run2);
			expect(p2).toBe("bumped-data");
			expect(run2).toHaveBeenCalledTimes(1);

			resolveFirst("first-done");
			expect(await p1).toBe("first-done");
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

	it("a pending read survives 64 other keys and is still joined", async () => {
		let finish: (v: string) => void = () => undefined;
		const slow = vi.fn(
			() => new Promise<string>((r) => (finish = r)),
		);
		const first = sharedRead("route-cap", { id: "pending" }, slow);
		await Promise.all(
			Array.from({ length: 70 }, (_, i) =>
				sharedRead("route-cap", { id: `other-${i}` }, async () => i),
			),
		);
		const joined = sharedRead("route-cap", { id: "pending" }, slow);
		finish("done");
		expect(await Promise.all([first, joined])).toEqual(["done", "done"]);
		expect(slow).toHaveBeenCalledTimes(1);
	});
});
