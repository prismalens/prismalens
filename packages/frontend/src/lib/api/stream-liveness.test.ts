// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { STREAM_SILENT_MS } from "@prismalens/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { watchSilence } from "./stream-liveness";

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
		/** Ticks every 250 ms up to `to`. */
		runTo(to: number) {
			while (now + 250 <= to) {
				now += 250;
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
	it("fires 1,500 ms into a silence when no tick runs late", () => {
		const h = harness();
		const onSilent = vi.fn();
		watchSilence(onSilent).open();
		h.runTo(STREAM_SILENT_MS);
		expect(onSilent).not.toHaveBeenCalled();
		h.runTo(STREAM_SILENT_MS + 250);
		expect(onSilent).toHaveBeenCalledTimes(1);
	});

	it("a 1,200 ms stall 1,000 ms into a silence counts the silence before it and fires at 2,700 ms, not at 2,450 ms", () => {
		const h = harness();
		const onSilent = vi.fn();
		watchSilence(onSilent).open();
		h.runTo(1000);
		h.stallTo(2200);
		expect(onSilent).not.toHaveBeenCalled();
		h.runTo(2450);
		expect(onSilent).not.toHaveBeenCalled();
		h.runTo(2700);
		expect(onSilent).toHaveBeenCalledTimes(1);
	});

	it("a beat right after a 1,400 ms stall keeps a live stream from firing for the next 1,500 ms", () => {
		const h = harness();
		const onSilent = vi.fn();
		const watch = watchSilence(onSilent);
		watch.open();
		h.runTo(400);
		h.stallTo(1800);
		watch.beat();
		h.runTo(1800 + STREAM_SILENT_MS);
		expect(onSilent).not.toHaveBeenCalled();
	});
});
