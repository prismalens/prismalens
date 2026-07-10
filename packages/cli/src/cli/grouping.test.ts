// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GroupRecord, SessionManager } from "../core/session.js";
import { createGroupingLayer } from "./grouping.js";

describe("Grouping layer", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	function setup() {
		const logs: string[] = [];
		const records = new Map<string, GroupRecord>();
		const lateAlerts = new Map<string, Record<string, unknown>[]>();

		const sessions = {
			writeGroupRecord: async (runId: string, rec: GroupRecord) => {
				records.set(runId, rec);
			},
			appendGroupAlert: async (
				runId: string,
				alert: Record<string, unknown>,
			) => {
				const existing = lateAlerts.get(runId) ?? [];
				existing.push(alert);
				lateAlerts.set(runId, existing);
			},
		} as unknown as SessionManager;

		const runs: { runId: string; alerts: Record<string, unknown>[] }[] = [];
		let gate: Promise<void> | undefined;

		const runInvestigation = vi.fn(
			async (runId: string, alerts: Record<string, unknown>[]) => {
				runs.push({ runId, alerts });
				if (gate) await gate;
			},
		);

		const grouping = createGroupingLayer({
			windowMs: 60000,
			sessions,
			runInvestigation,
			log: (msg) => logs.push(msg),
		});

		return {
			grouping,
			sessions,
			runs,
			logs,
			records,
			lateAlerts,
			runInvestigation,
			setGate: (p: Promise<void>) => {
				gate = p;
			},
		};
	}

	it("AC1: buffers alerts with same group key inside window into one investigation", async () => {
		const { grouping, runs, records } = setup();
		const alert1 = {
			status: "firing",
			labels: { alertname: "A", service: "web" },
			startsAt: "t1",
		};
		const alert2 = {
			status: "firing",
			labels: { alertname: "A", service: "web" },
			startsAt: "t2",
		};
		const payload = {};

		expect(grouping.newGroupCount([alert1], payload)).toBe(1);
		grouping.admit([alert1], payload);
		expect(grouping.pendingGroups()).toBe(1);

		grouping.admit([alert2], payload);

		expect(runs.length).toBe(0);

		await vi.advanceTimersByTimeAsync(60000);
		expect(runs.length).toBe(1);
		expect(runs[0].alerts).toEqual([alert1, alert2]);

		const rec = records.get(runs[0].runId);
		expect(rec).toBeDefined();
		expect(rec?.formedBy).toBe("window");
		expect(rec?.alerts).toEqual([alert1, alert2]);
		expect(rec?.groupKey).toBe("A\0web");
	});

	it("opens a second window for a different group key concurrently", async () => {
		const { grouping, runs } = setup();
		const alert1 = {
			status: "firing",
			labels: { alertname: "A", service: "web" },
			startsAt: "t1",
		};
		const alert2 = {
			status: "firing",
			labels: { alertname: "B", service: "db" },
			startsAt: "t2",
		};

		grouping.admit([alert1], {});
		await vi.advanceTimersByTimeAsync(30000);
		grouping.admit([alert2], {});

		await vi.advanceTimersByTimeAsync(30000);
		// Window A fires
		expect(runs.length).toBe(1);
		expect(runs[0].alerts).toEqual([alert1]);

		await vi.advanceTimersByTimeAsync(30000);
		// Window B fires
		expect(runs.length).toBe(2);
		expect(runs[1].alerts).toEqual([alert2]);
	});

	it("AC2: late alert attaches to RUNNING group without re-dispatching", async () => {
		const { grouping, runs, lateAlerts, setGate } = setup();
		let resolveGate!: () => void;
		setGate(
			new Promise((r) => {
				resolveGate = r;
			}),
		);

		const alert1 = {
			status: "firing",
			labels: { alertname: "A", service: "web" },
			startsAt: "t1",
		};
		const alert2 = {
			status: "firing",
			labels: { alertname: "A", service: "web" },
			startsAt: "t2",
		};

		grouping.admit([alert1], {});
		await vi.advanceTimersByTimeAsync(60000);

		expect(runs.length).toBe(1);

		grouping.admit([alert2], {});
		await vi.advanceTimersByTimeAsync(0);

		expect(runs.length).toBe(1); // No new run
		expect(lateAlerts.get(runs[0].runId)).toEqual([alert2]);

		resolveGate();
		await vi.runAllTimersAsync();
	});

	it("late alert after run completes starts NEW window", async () => {
		const { grouping, runs } = setup();

		const alert1 = {
			status: "firing",
			labels: { alertname: "A", service: "web" },
			startsAt: "t1",
		};
		const alert2 = {
			status: "firing",
			labels: { alertname: "A", service: "web" },
			startsAt: "t2",
		};

		grouping.admit([alert1], {});
		await vi.advanceTimersByTimeAsync(60000); // timer fires, run starts & completes

		grouping.admit([alert2], {});
		expect(grouping.pendingGroups()).toBe(1); // new window open

		await vi.advanceTimersByTimeAsync(60000);
		expect(runs.length).toBe(2);
		expect(runs[1].alerts).toEqual([alert2]);
	});

	it("The timer-fire -> run-start gap still attaches", async () => {
		const { grouping, records, lateAlerts, runInvestigation } = setup();

		// Delay the Promise.resolve() tick that the grouping uses to start the run
		let releaseInvestigationQueue!: () => void;
		const blockInvestigation = new Promise<void>((r) => {
			releaseInvestigationQueue = r;
		});
		runInvestigation.mockImplementation(async () => {
			await blockInvestigation;
		});

		const alert1 = {
			status: "firing",
			labels: { alertname: "A", service: "web" },
			startsAt: "t1",
		};
		const alert2 = {
			status: "firing",
			labels: { alertname: "A", service: "web" },
			startsAt: "t2",
		};

		grouping.admit([alert1], {});
		vi.advanceTimersByTime(60000); // fire timer, but don't await async tasks yet

		// groupKey is now in `running` map SYNCHRONOUSLY, but runInvestigation has not actually started execution!
		grouping.admit([alert2], {}); // Should attach

		// Let the tick proceed
		await vi.advanceTimersByTimeAsync(0);

		// We expect 1 writeGroupRecord and 1 appendGroupAlert to be queued
		const runIds = Array.from(records.keys());
		expect(runIds.length).toBe(1);

		expect(lateAlerts.get(runIds[0])).toEqual([alert2]);

		releaseInvestigationQueue();
		await vi.runAllTimersAsync();
	});

	it("Dedupe: identical alert is dropped in both window and running phases", async () => {
		const { grouping, runs, lateAlerts, setGate } = setup();
		let resolveGate!: () => void;
		setGate(
			new Promise((r) => {
				resolveGate = r;
			}),
		);

		const alert1 = {
			fingerprint: "xyz",
			status: "firing",
			labels: { alertname: "A", service: "web" },
		};
		const alert2 = {
			fingerprint: "xyz",
			status: "firing",
			labels: { alertname: "A", service: "web" },
		}; // Identical

		// Buffer phase dedupe
		grouping.admit([alert1], {});
		grouping.admit([alert2], {});
		await vi.advanceTimersByTimeAsync(60000);

		expect(runs[0].alerts.length).toBe(1);

		// Running phase dedupe
		const alert3 = {
			fingerprint: "xyz",
			status: "firing",
			labels: { alertname: "A", service: "web" },
		}; // Still identical
		const alert4 = {
			fingerprint: "abc",
			status: "firing",
			labels: { alertname: "A", service: "web" },
		}; // Different

		grouping.admit([alert3], {});
		grouping.admit([alert4], {});
		await vi.advanceTimersByTimeAsync(0);

		const lates = lateAlerts.get(runs[0].runId);
		expect(lates?.length).toBe(1);
		expect(lates?.[0].fingerprint).toBe("abc");

		resolveGate();
		await vi.runAllTimersAsync();
	});

	it("shutdown clears timers and logs dropped count", () => {
		const { grouping, logs } = setup();

		grouping.admit([{ status: "firing", labels: { alertname: "A" } }], {});
		grouping.admit([{ status: "firing", labels: { alertname: "B" } }], {});

		grouping.shutdown();

		// Timers should be cleared, no runs executed
		vi.advanceTimersByTime(100000);

		expect(logs.some((l) => l.includes("dropped 2 pending"))).toBe(true);
	});
});
