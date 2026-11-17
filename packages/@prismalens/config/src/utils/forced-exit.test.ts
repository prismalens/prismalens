// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterEach, describe, expect, it, vi } from "vitest";
import { armForcedExitOnSecondSignal, requestStop } from "./workspace-lock.js";

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

	it("a stop request starts one shutdown and never counts as the forcing second signal (#717)", () => {
		const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
		const shutdowns: string[] = [];
		const hook = () => shutdowns.push("hook");
		process.on("SIGUSR2", hook);
		const disarm = armForcedExitOnSecondSignal(["SIGUSR2"], 60_000);

		expect(requestStop("SIGUSR2")).toBe(true);
		expect(requestStop("SIGUSR2")).toBe(false);
		process.emit("SIGUSR2");
		expect(exit).not.toHaveBeenCalled();
		process.emit("SIGUSR2");
		expect(exit).toHaveBeenCalledWith(128 + 15);
		expect(shutdowns).toEqual(["hook", "hook", "hook"]);
		disarm();
		process.removeListener("SIGUSR2", hook);
	});

	it("a request after the signal itself is dropped", () => {
		const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
		const disarm = armForcedExitOnSecondSignal(["SIGUSR2"], 60_000);
		process.emit("SIGUSR2");
		expect(requestStop("SIGUSR2")).toBe(false);
		expect(exit).not.toHaveBeenCalled();
		disarm();
	});
});
