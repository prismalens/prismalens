// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The dispatch-time run-budget gate for `pl listen` (issue #62). Concurrency +
 * per-hour ONLY gate dispatch here; `max_turns` is threaded to the engine harness
 * (not a dispatch decision) and is deliberately absent from {@link DispatchCaps}.
 * Pure and clock-injected: state lives in the closure, the clock is a caller arg, so
 * the per-hour window is deterministically testable with a fake clock.
 */
export interface DispatchCaps {
	/** Max investigations running at once. Unset ⇒ concurrency unbounded. */
	maxConcurrent?: number;
	/** Max investigations STARTED in the trailing hour. Unset ⇒ rate unbounded. */
	maxPerHour?: number;
}

export type CapReason = "concurrency" | "per_hour";
export type CapDecision = { allow: true } | { allow: false; reason: CapReason };

export interface CapsGate {
	/**
	 * Evaluate the caps and, on allow, ATOMICALLY record the start (active++ and push
	 * `nowMs` into the hourly window). The caller MUST invoke this with NO `await`
	 * between reading the caps and this call — the single-threaded event loop then
	 * makes check-and-commit atomic, so two window timers cannot both pass a
	 * concurrency=1 gate (the dispatch race the scout flagged).
	 */
	tryDispatch(caps: DispatchCaps, nowMs: number): CapDecision;
	/** Release one active slot when a dispatched run finishes. Call exactly once per `allow`. */
	release(): void;
	/** Live active count (inspection/tests). */
	readonly activeCount: number;
}

const HOUR_MS = 3_600_000;

export function createCapsGate(): CapsGate {
	let active = 0;
	// Rolling window of dispatched-run START times (ms). Per-hour is a rate on
	// STARTS, so entries are pruned by age, never by release.
	const startsMs: number[] = [];

	return {
		get activeCount() {
			return active;
		},
		tryDispatch(caps, nowMs) {
			// Concurrency FIRST (cheapest, trips most often), then per-hour. The FIRST
			// cap that trips is the recorded reason.
			if (caps.maxConcurrent !== undefined && active >= caps.maxConcurrent) {
				return { allow: false, reason: "concurrency" };
			}
			const cutoff = nowMs - HOUR_MS;
			while (startsMs.length > 0 && (startsMs[0] as number) <= cutoff) {
				startsMs.shift();
			}
			if (caps.maxPerHour !== undefined && startsMs.length >= caps.maxPerHour) {
				return { allow: false, reason: "per_hour" };
			}
			active++;
			startsMs.push(nowMs);
			return { allow: true };
		},
		release() {
			if (active > 0) active--;
		},
	};
}
