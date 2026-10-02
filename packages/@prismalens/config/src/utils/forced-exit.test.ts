// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterEach, describe, expect, it, vi } from "vitest";
import { armForcedExitOnSecondSignal } from "./workspace-lock.js";

describe("armForcedExitOnSecondSignal", () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("exits once the first signal's shutdown outlasts the deadline (walk f20)", () => {
		vi.useFakeTimers();
		const exit = vi
			.spyOn(process, "exit")
			.mockImplementation((() => undefined) as never);
		const disarm = armForcedExitOnSecondSignal(["SIGUSR2"], 5_000);

		process.emit("SIGUSR2");
		vi.advanceTimersByTime(4_999);
		expect(exit).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(exit).toHaveBeenCalledWith(128 + 15);
		disarm();
	});

	it("never fires the deadline once the shutdown finished and disarmed", () => {
		vi.useFakeTimers();
		const exit = vi
			.spyOn(process, "exit")
			.mockImplementation((() => undefined) as never);
		const disarm = armForcedExitOnSecondSignal(["SIGUSR2"], 5_000);

		process.emit("SIGUSR2");
		disarm();
		vi.advanceTimersByTime(10_000);
		expect(exit).not.toHaveBeenCalled();
	});
});
