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

	function setup(overrides?: { flapWindowMs?: number }) {
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
			// #231 R4 — injected so the linkage window is independent of env config.
			flapWindowMs: overrides?.flapWindowMs ?? 15 * 60_000,
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

	it("proceeds with investigation if group record write fails", async () => {
		const { grouping, runs, logs, sessions } = setup();

		sessions.writeGroupRecord = async () => {
			throw new Error("ENOSPC: no space left");
		};

		const alert1 = {
			status: "firing",
			labels: { alertname: "A", service: "web" },
			startsAt: "t1",
		};

		grouping.admit([alert1], {});
		await vi.advanceTimersByTimeAsync(60000);

		expect(runs.length).toBe(1);
		expect(runs[0].alerts).toEqual([alert1]);
		expect(
			logs.some(
				(msg) =>
					msg.includes("Failed to write group record") &&
					msg.includes("ENOSPC"),
			),
		).toBe(true);
	});

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

	it("Dedupe: identical alert is dropped in window but attached as re-page in running phase", async () => {
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

		// Buffer phase dedupe (still drops identical)
		grouping.admit([alert1], {});
		grouping.admit([alert2], {});
		await vi.advanceTimersByTimeAsync(60000);

		expect(runs[0].alerts.length).toBe(1);

		// Running phase dedupe (issue #137: suppress dispatch but attach re-page)
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
		expect(lates?.length).toBe(2);
		expect(lates?.[0].fingerprint).toBe("xyz"); // Attached re-page
		expect(lates?.[1].fingerprint).toBe("abc"); // Attached new alert

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

	it("regression #137: late attached dedupe keys are released when run completes", async () => {
		const { grouping, runs, lateAlerts, setGate } = setup();
		let resolveGate!: () => void;
		setGate(
			new Promise((r) => {
				resolveGate = r;
			}),
		);

		const alertA = {
			fingerprint: "alertA",
			status: "firing",
			labels: { alertname: "A", service: "web" },
		};
		const alertB = {
			fingerprint: "alertB",
			status: "firing",
			labels: { alertname: "A", service: "web" },
		};

		// 1. Admit A, wait for window to fire so it enters RUNNING phase
		grouping.admit([alertA], {});
		await vi.advanceTimersByTimeAsync(60000); // Window fires -> run starts and waits at gate

		// 2. Attach B to running group A
		grouping.admit([alertB], {});
		await vi.advanceTimersByTimeAsync(0);

		// 3. Complete the run
		resolveGate();
		await vi.runAllTimersAsync();

		expect(runs.length).toBe(1);
		expect(lateAlerts.get(runs[0].runId)).toEqual([alertB]);

		// 4. B re-fires later. Since the run is complete, the dedupe key should be released
		// and this should start a NEW window/run, NOT be suppressed.
		grouping.admit([alertB], {});
		await vi.advanceTimersByTimeAsync(60000);

		expect(runs.length).toBe(2);
		expect(runs[1].alerts).toEqual([alertB]);
	});

	// ==========================================================================
	// #231 R4 — a post-completion refire still starts a NEW run; the new run's
	// record just carries previousRunId when the prior run finished in-window.
	// ==========================================================================
	describe("cross-run flap linkage (#231 R4)", () => {
		const alert = {
			fingerprint: "flappy",
			status: "firing",
			labels: { alertname: "A", service: "web" },
		};

		/** Drive one alert through a full window -> run -> completion cycle. */
		async function runOnce(grouping: {
			admit: (
				firing: Record<string, unknown>[],
				payload: Record<string, unknown>,
			) => void;
		}) {
			grouping.admit([alert], {});
			await vi.runAllTimersAsync();
		}

		it("baseline: the fingerprint short-circuit still suppresses an in-flight re-page", async () => {
			const { grouping, runs, lateAlerts, setGate } = setup();
			let resolveGate!: () => void;
			setGate(
				new Promise((r) => {
					resolveGate = r;
				}),
			);

			grouping.admit([alert], {});
			await vi.advanceTimersByTimeAsync(60000);
			grouping.admit([alert], {}); // same fingerprint, run still in flight
			await vi.advanceTimersByTimeAsync(0);

			expect(runs.length).toBe(1);
			expect(lateAlerts.get(runs[0].runId)).toEqual([alert]);

			resolveGate();
			await vi.runAllTimersAsync();
		});

		it("baseline: a different fingerprint in a running group appends rather than dispatching", async () => {
			const { grouping, runs, lateAlerts, setGate } = setup();
			let resolveGate!: () => void;
			setGate(
				new Promise((r) => {
					resolveGate = r;
				}),
			);
			const sibling = {
				fingerprint: "sibling",
				status: "firing",
				labels: { alertname: "A", service: "web" },
			};

			grouping.admit([alert], {});
			await vi.advanceTimersByTimeAsync(60000);
			grouping.admit([sibling], {});
			await vi.advanceTimersByTimeAsync(0);

			expect(runs.length).toBe(1);
			expect(lateAlerts.get(runs[0].runId)).toEqual([sibling]);

			resolveGate();
			await vi.runAllTimersAsync();
		});

		it("links the new run to the completed one when the refire lands inside the flap window", async () => {
			const { grouping, runs, records, logs } = setup();

			await runOnce(grouping);
			expect(runs.length).toBe(1);

			// 5 minutes later, well inside the 15-minute window.
			await vi.advanceTimersByTimeAsync(5 * 60_000);
			await runOnce(grouping);

			expect(runs.length).toBe(2);
			expect(runs[1].runId).not.toBe(runs[0].runId);
			expect(records.get(runs[1].runId)?.previousRunId).toBe(runs[0].runId);
			expect(
				logs.some((l) => l.includes(`linked to previous run ${runs[0].runId}`)),
			).toBe(true);
		});

		it("leaves previousRunId unset when the refire lands outside the flap window", async () => {
			const { grouping, runs, records } = setup();

			await runOnce(grouping);
			await vi.advanceTimersByTimeAsync(16 * 60_000);
			await runOnce(grouping);

			expect(runs.length).toBe(2);
			expect(records.get(runs[1].runId)?.previousRunId).toBeUndefined();
		});

		it("the first run of a fingerprint has no previousRunId", async () => {
			const { grouping, runs, records } = setup();

			await runOnce(grouping);

			expect(records.get(runs[0].runId)?.previousRunId).toBeUndefined();
		});

		it("honours an injected flap window rather than a hardcoded 15 minutes", async () => {
			const { grouping, runs, records } = setup({ flapWindowMs: 60_000 });

			await runOnce(grouping);
			await vi.advanceTimersByTimeAsync(2 * 60_000);
			await runOnce(grouping);

			expect(records.get(runs[1].runId)?.previousRunId).toBeUndefined();
		});

		it("links across a chain of refires, each to its immediate predecessor", async () => {
			const { grouping, runs, records } = setup();

			await runOnce(grouping);
			await vi.advanceTimersByTimeAsync(2 * 60_000);
			await runOnce(grouping);
			await vi.advanceTimersByTimeAsync(2 * 60_000);
			await runOnce(grouping);

			expect(runs.length).toBe(3);
			expect(records.get(runs[1].runId)?.previousRunId).toBe(runs[0].runId);
			expect(records.get(runs[2].runId)?.previousRunId).toBe(runs[1].runId);
		});
	});
});

describe("deriveGroupKey", () => {
	it("returns 'default' when no grouping keys apply", async () => {
		const { deriveGroupKey } = await import("./grouping.js");
		const key = deriveGroupKey({}, {});
		expect(key).toBe("default");
	});
});
