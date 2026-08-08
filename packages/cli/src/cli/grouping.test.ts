// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GroupRecord, SessionManager } from "../core/session.js";
import { createGroupingLayer, deriveDedupeKey } from "./grouping.js";

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
});

describe("deriveGroupKey", () => {
	it("returns 'default' when no grouping keys apply", async () => {
		const { deriveGroupKey } = await import("./grouping.js");
		const key = deriveGroupKey({}, {});
		expect(key).toBe("default");
	});
});

/**
 * #231 — dedup / flap-suppression semantics, PINNED AS-IS.
 *
 * These tests document what the CLI grouping path does today. Several of them
 * pin behaviour that is arguably wrong; each such case says so and points at
 * the follow-up issue. Do not "fix" the behaviour by editing these assertions —
 * change the code and the assertion together, deliberately.
 *
 * See docs/alert-dedup-and-grouping.md for the prose + tables.
 */
describe("#231 dedup identity: deriveDedupeKey", () => {
	it("collapses a re-fire onto the same key when a fingerprint is present, even though startsAt moved", () => {
		// Alertmanager stamps `fingerprint` on every alert, so this — not the
		// startsAt-sensitive fallback — is the branch that runs in production.
		const first = {
			fingerprint: "fp-1",
			labels: { alertname: "HighLatency", service: "web" },
			startsAt: "2026-01-01T00:00:00Z",
		};
		const reFire = {
			fingerprint: "fp-1",
			labels: { alertname: "HighLatency", service: "web" },
			startsAt: "2026-01-01T00:10:00Z",
		};

		expect(deriveDedupeKey(reFire)).toBe(deriveDedupeKey(first));
	});

	it("ignores labels entirely when a fingerprint is present", () => {
		// The fingerprint short-circuit means two alerts with nothing else in
		// common are the same alert as far as suppression is concerned.
		const web = {
			fingerprint: "fp-shared",
			labels: { alertname: "HighLatency", service: "web" },
		};
		const database = {
			fingerprint: "fp-shared",
			labels: { alertname: "DiskFull", service: "database" },
		};

		expect(deriveDedupeKey(database)).toBe(deriveDedupeKey(web));
	});

	it("splits an UNfingerprinted re-fire into a new key the moment startsAt moves", () => {
		// The fallback key is `alertname + sha256(labels) + startsAt`, so a
		// sender that omits `fingerprint` gets no cross-episode dedup at all.
		const first = {
			labels: { alertname: "HighLatency", service: "web" },
			startsAt: "2026-01-01T00:00:00Z",
		};
		const reFire = {
			labels: { alertname: "HighLatency", service: "web" },
			startsAt: "2026-01-01T00:10:00Z",
		};

		expect(deriveDedupeKey(reFire)).not.toBe(deriveDedupeKey(first));
	});

	it("keeps an UNfingerprinted alert on one key while startsAt holds still", () => {
		const first = {
			labels: { service: "web", alertname: "HighLatency" },
			startsAt: "2026-01-01T00:00:00Z",
		};
		const repeat = {
			// Same labels, declared in a different order — label order must not
			// change identity (the key sorts label names before hashing).
			labels: { alertname: "HighLatency", service: "web" },
			startsAt: "2026-01-01T00:00:00Z",
		};

		expect(deriveDedupeKey(repeat)).toBe(deriveDedupeKey(first));
	});
});

describe("#231 dedup/flap semantics of the grouping layer", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	/** A grouping layer whose investigation blocks until the returned gate is opened. */
	function runningRig() {
		const logs: string[] = [];
		const records = new Map<string, GroupRecord>();
		const lateAlerts = new Map<string, Record<string, unknown>[]>();
		const appendCalls: string[] = [];

		const sessions = {
			writeGroupRecord: async (runId: string, rec: GroupRecord) => {
				records.set(runId, rec);
			},
			appendGroupAlert: async (
				runId: string,
				alert: Record<string, unknown>,
			) => {
				appendCalls.push(runId);
				const existing = lateAlerts.get(runId) ?? [];
				existing.push(alert);
				lateAlerts.set(runId, existing);
			},
		} as unknown as SessionManager;

		const runs: { runId: string; alerts: Record<string, unknown>[] }[] = [];
		let openGate!: () => void;
		const gate = new Promise<void>((r) => {
			openGate = r;
		});

		const grouping = createGroupingLayer({
			windowMs: 60000,
			sessions,
			runInvestigation: vi.fn(
				async (runId: string, alerts: Record<string, unknown>[]) => {
					runs.push({ runId, alerts });
					await gate;
				},
			),
			log: (msg) => logs.push(msg),
		});

		return {
			grouping,
			runs,
			logs,
			records,
			lateAlerts,
			appendCalls,
			openGate,
		};
	}

	it("does NOT flap-suppress: every re-page of an in-flight fingerprint appends another late alert, without bound", async () => {
		// WRONG-BUT-PINNED (#397). There is no repeat-count cap, no cooldown and
		// no per-run ceiling: an alert re-paged by Alertmanager's repeat_interval
		// for the duration of a long investigation writes one group_alerts row
		// per delivery. Suppression here means "do not dispatch a second
		// investigation" — it has never meant "do not record".
		const { grouping, runs, lateAlerts, appendCalls, openGate } = runningRig();
		const alert = {
			fingerprint: "fp-flap",
			status: "firing",
			labels: { alertname: "HighLatency", service: "web" },
		};

		grouping.admit([alert], {});
		await vi.advanceTimersByTimeAsync(60000);
		expect(runs.length).toBe(1);

		for (let i = 0; i < 5; i++) {
			grouping.admit([{ ...alert, startsAt: `2026-01-01T00:0${i}:00Z` }], {});
		}
		await vi.advanceTimersByTimeAsync(0);

		// One investigation, five recorded re-pages — one per delivery.
		expect(runs.length).toBe(1);
		expect(appendCalls).toEqual(Array(5).fill(runs[0].runId));
		expect(lateAlerts.get(runs[0].runId)?.length).toBe(5);

		openGate();
		await vi.runAllTimersAsync();
	});

	it("suppresses ACROSS group keys: a same-fingerprint alert in a different group is recorded on the FIRST group's run", async () => {
		// WRONG-BUT-PINNED (#397). The in-flight fingerprint registry is global,
		// not scoped to a group. An alert whose groupKey says "database" is
		// filed under the run investigating "web" purely because the sender
		// reused a fingerprint, and it never opens a window of its own.
		const { grouping, runs, lateAlerts, openGate } = runningRig();
		const shared = {
			fingerprint: "fp-shared",
			status: "firing",
			labels: { alertname: "HighLatency", service: "web" },
		};

		grouping.admit([shared], { groupKey: "group-web" });
		await vi.advanceTimersByTimeAsync(60000);
		expect(runs.length).toBe(1);
		expect(grouping.pendingGroups()).toBe(1);

		grouping.admit([shared], { groupKey: "group-database" });
		await vi.advanceTimersByTimeAsync(0);

		// No second window, no second investigation — filed under group-web's run.
		expect(grouping.pendingGroups()).toBe(1);
		expect(runs.length).toBe(1);
		expect(lateAlerts.get(runs[0].runId)).toEqual([shared]);
		expect(grouping.newGroupCount([shared], { groupKey: "group-database" })).toBe(
			1,
		);

		openGate();
		await vi.runAllTimersAsync();
	});

	it("drops a window-phase duplicate silently: no formative alert, no late alert, no log line", async () => {
		// Asymmetry worth knowing: the SAME duplicate is recorded as a late alert
		// once the group is running (test above) but leaves no trace at all while
		// the group is still buffering. Nothing counts how many were dropped.
		const { grouping, runs, records, lateAlerts, logs, openGate } =
			runningRig();
		const alert = {
			fingerprint: "fp-dup",
			status: "firing",
			labels: { alertname: "HighLatency", service: "web" },
		};

		grouping.admit([alert], {});
		grouping.admit([alert], {});
		grouping.admit([alert], {});
		await vi.advanceTimersByTimeAsync(60000);

		expect(runs.length).toBe(1);
		expect(runs[0].alerts).toEqual([alert]);
		expect(records.get(runs[0].runId)?.alerts).toEqual([alert]);
		expect(lateAlerts.get(runs[0].runId)).toBeUndefined();
		expect(logs).toEqual([]);

		openGate();
		await vi.runAllTimersAsync();
	});

	it("writes the formative group record with an EMPTY lateAlerts list — late arrivals only ever reach the store via appendGroupAlert", async () => {
		const { grouping, runs, records, openGate } = runningRig();
		const first = {
			fingerprint: "fp-a",
			status: "firing",
			labels: { alertname: "HighLatency", service: "web" },
		};
		const late = {
			fingerprint: "fp-b",
			status: "firing",
			labels: { alertname: "HighLatency", service: "web" },
		};

		grouping.admit([first], {});
		await vi.advanceTimersByTimeAsync(60000);
		grouping.admit([late], {});
		await vi.advanceTimersByTimeAsync(0);

		const rec = records.get(runs[0].runId);
		expect(rec?.formedBy).toBe("window");
		expect(rec?.alerts).toEqual([first]);
		// The record is written once, at window close; `lateAlerts` on it is dead
		// weight in this path. A re-write of the record would erase the appended
		// rows (writeGroupRecord DELETEs group_alerts first).
		expect(rec?.lateAlerts).toEqual([]);

		openGate();
		await vi.runAllTimersAsync();
	});

	it("re-arms after the run completes: the very next delivery of the same fingerprint dispatches a NEW investigation", async () => {
		// This is the whole of the "flap window": the in-flight registry, and
		// nothing else. Once a run ends there is no cooldown — an alert that
		// flaps on a cycle longer than its investigation gets one investigation
		// per cycle, for ever.
		const { grouping, runs, openGate } = runningRig();
		const alert = {
			fingerprint: "fp-cycle",
			status: "firing",
			labels: { alertname: "HighLatency", service: "web" },
		};

		grouping.admit([alert], {});
		await vi.advanceTimersByTimeAsync(60000);
		openGate();
		await vi.runAllTimersAsync();
		expect(runs.length).toBe(1);

		grouping.admit([alert], {});
		await vi.advanceTimersByTimeAsync(60000);

		expect(runs.length).toBe(2);
		expect(runs[1].runId).not.toBe(runs[0].runId);
	});
});
