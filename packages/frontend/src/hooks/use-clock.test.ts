// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clockNow, subscribeClock, useSecondClock } from "./use-clock";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("use-clock (#874)", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("aligns to the next whole second and updates clockNow on tick", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T10:00:00.400Z"));

		const listener = vi.fn();
		const unsubscribe = subscribeClock(listener);

		expect(listener).not.toHaveBeenCalled();

		vi.advanceTimersByTime(599);
		expect(listener).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1);
		expect(listener).toHaveBeenCalledTimes(1);
		expect(clockNow()).toBe(new Date("2026-01-01T10:00:01.000Z").getTime());

		unsubscribe();
	});

	it("shares one timer across multiple subscribers", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T10:00:00.000Z"));

		const listenerA = vi.fn();
		const listenerB = vi.fn();
		const unsubA = subscribeClock(listenerA);
		const unsubB = subscribeClock(listenerB);

		expect(vi.getTimerCount()).toBe(1);

		vi.advanceTimersByTime(3000);
		expect(listenerA).toHaveBeenCalledTimes(3);
		expect(listenerB).toHaveBeenCalledTimes(3);

		unsubA();
		unsubB();
	});

	it("clears the timer when the last listener unsubscribes", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T10:00:00.000Z"));

		const listener = vi.fn();
		const unsubscribe = subscribeClock(listener);
		expect(vi.getTimerCount()).toBe(1);

		unsubscribe();
		expect(vi.getTimerCount()).toBe(0);

		vi.advanceTimersByTime(5000);
		expect(listener).not.toHaveBeenCalled();
	});

	it("keeps ticking when one of two listeners unsubscribes", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T10:00:00.000Z"));

		const listenerA = vi.fn();
		const listenerB = vi.fn();
		const unsubA = subscribeClock(listenerA);
		const unsubB = subscribeClock(listenerB);

		unsubA();
		expect(vi.getTimerCount()).toBe(1);

		vi.advanceTimersByTime(2000);
		expect(listenerA).not.toHaveBeenCalled();
		expect(listenerB).toHaveBeenCalledTimes(2);

		unsubB();
	});

	describe("useSecondClock component", () => {
		let container: HTMLDivElement;
		let root: Root;

		beforeEach(() => {
			container = document.createElement("div");
			document.body.appendChild(container);
			root = createRoot(container);
		});

		afterEach(async () => {
			await act(async () => root.unmount());
			container.remove();
		});

		it("renders current second, updates on advance, and cleans up on unmount", async () => {
			vi.useFakeTimers();
			const startTime = new Date("2026-01-01T10:00:00.000Z").getTime();
			vi.setSystemTime(startTime);

			function ClockDisplay() {
				const time = useSecondClock();
				return createElement("span", { "data-testid": "clock" }, time ?? "null");
			}

			await act(async () => {
				root.render(createElement(ClockDisplay));
			});

			const el = container.querySelector('[data-testid="clock"]');
			expect(el?.textContent).toBe(String(startTime));

			await act(async () => {
				vi.advanceTimersByTime(1000);
			});

			expect(el?.textContent).toBe(String(startTime + 1000));

			await act(async () => {
				root.unmount();
			});

			expect(vi.getTimerCount()).toBe(0);
		});
	});
});
