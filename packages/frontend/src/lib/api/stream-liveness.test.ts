// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { STREAM_SILENT_MS } from "@prismalens/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STALL_MS, TICK_MS, watchSilence } from "./stream-liveness";

/** A clock the test moves, and the watch's tick, run by hand: a stall is time with no tick. */
function harness() {
	let now = 0;
	let tick: () => void = () => {};
	vi.spyOn(performance, "now").mockImplementation(() => now);
	vi.spyOn(globalThis, "setInterval").mockImplementation(((fn: () => void) => {
		tick = fn;
		return 1;
	}) as typeof setInterval);
	vi.spyOn(globalThis, "clearInterval").mockImplementation(() => {});
	return {
		/** Ticks every TICK_MS up to `to`. */
		runTo(to: number) {
			while (now + TICK_MS <= to) {
				now += TICK_MS;
				tick();
			}
		},
		/** The page is busy until `to`, then one late tick runs. */
		stallTo(to: number) {
			now = to;
			tick();
		},
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("watchSilence (#1181)", () => {
	it("ticks every 100 ms and fires on the first tick past 1,200 ms of silence, not before", () => {
		expect(TICK_MS).toBe(100);
		expect(STREAM_SILENT_MS).toBe(1200);
		const h = harness();
		const onSilent = vi.fn();
		watchSilence(onSilent).open();
		h.runTo(1200);
		expect(onSilent).not.toHaveBeenCalled();
		h.runTo(1300);
		expect(onSilent).toHaveBeenCalledTimes(1);
	});

	it("a 1,200 ms stall 800 ms into a silence counts the 800 ms before it and fires at 2,400 ms, not at 2,300 ms", () => {
		const h = harness();
		const onSilent = vi.fn();
		watchSilence(onSilent).open();
		h.runTo(800);
		h.stallTo(2000);
		expect(onSilent).not.toHaveBeenCalled();
		h.runTo(2300);
		expect(onSilent).not.toHaveBeenCalled();
		h.runTo(2400);
		expect(onSilent).toHaveBeenCalledTimes(1);
	});

	it("a tick 900 ms late is under the 1,000 ms stall line, so none of the wait is forgiven and it fires at 1,300 ms", () => {
		expect(STALL_MS).toBe(1000);
		const h = harness();
		const onSilent = vi.fn();
		watchSilence(onSilent).open();
		h.runTo(400);
		h.stallTo(1300);
		expect(onSilent).toHaveBeenCalledTimes(1);
	});

	it("a beat right after a 1,400 ms stall keeps a live stream from firing for the next 1,200 ms", () => {
		const h = harness();
		const onSilent = vi.fn();
		const watch = watchSilence(onSilent);
		watch.open();
		h.runTo(400);
		h.stallTo(1800);
		watch.beat();
		h.runTo(3000);
		expect(onSilent).not.toHaveBeenCalled();
	});
});
