// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import { withBeat } from "./beat.js";

describe("withBeat (#1181)", () => {
	it("calls beat factory for the first beat and for each quiet beat", async () => {
		const controller = new AbortController();
		let pushItem: (val: string) => void = () => {};
		const itemPromise = new Promise<string>((resolve) => {
			pushItem = resolve;
		});

		async function* source() {
			const item = await itemPromise;
			yield item;
			await new Promise(() => {});
		}

		let count = 0;
		const stream = withBeat(source(), 20, controller.signal, () => {
			count++;
			return { beat: true, count };
		});

		// First beat is synchronous / on startup
		const first = await stream.next();
		expect(first.value).toEqual({ beat: true, count: 1 });

		// A quiet beat comes after the 20 ms the source stays silent
		const secondNext = stream.next();
		await vi.advanceTimersByTimeAsync(20);
		const second = await secondNext;
		expect(second.value).toEqual({ beat: true, count: 2 });

		// Source yields an item
		pushItem("data-1");
		const third = await stream.next();
		expect(third.value).toBe("data-1");

		// Another quiet beat
		const fourthNext = stream.next();
		await vi.advanceTimersByTimeAsync(20);
		const fourth = await fourthNext;
		expect(fourth.value).toEqual({ beat: true, count: 3 });

		controller.abort();
	});

	it("reading a mutable holder shows the updated cursor", async () => {
		const controller = new AbortController();
		async function* hangingSource() {
			await new Promise(() => {});
		}

		const holder = { cursor: "epoch.1" };
		const stream = withBeat(hangingSource(), 20, controller.signal, () => ({
			beat: true,
			cursor: holder.cursor,
		}));

		const first = await stream.next();
		expect(first.value).toEqual({ beat: true, cursor: "epoch.1" });

		holder.cursor = "epoch.2";
		const secondNext = stream.next();
		await vi.advanceTimersByTimeAsync(20);

		const second = await secondNext;
		expect(second.value).toEqual({ beat: true, cursor: "epoch.2" });

		controller.abort();
	});
});
