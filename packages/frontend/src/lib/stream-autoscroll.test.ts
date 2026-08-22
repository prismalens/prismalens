// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	AT_BOTTOM_THRESHOLD_PX,
	INITIAL_TAIL_FOLLOW,
	isAtBottom,
	nextTailFollow,
} from "./stream-autoscroll";

const VIEWPORT = 192;

/** Geometry for a list `scrollHeight` tall, scrolled to `scrollTop`. */
function at(scrollTop: number, scrollHeight: number) {
	return { scrollTop, clientHeight: VIEWPORT, scrollHeight };
}

describe("isAtBottom", () => {
	it("is true for content that does not overflow its viewport", () => {
		expect(isAtBottom(at(0, VIEWPORT))).toBe(true);
	});

	it("is true when pinned to the tail", () => {
		expect(isAtBottom(at(808, 1000))).toBe(true);
	});

	// Browsers report fractional scrollTop/clientHeight at non-100% zoom.
	it("tolerates sub-pixel rounding at the tail", () => {
		expect(
			isAtBottom({
				scrollTop: 807.3125,
				clientHeight: 191.6875,
				scrollHeight: 1000,
			}),
		).toBe(true);
	});

	it("is false once the reader has scrolled up by a row", () => {
		expect(isAtBottom(at(808 - AT_BOTTOM_THRESHOLD_PX - 12, 1000))).toBe(false);
	});

	it("is false at the top of a long list", () => {
		expect(isAtBottom(at(0, 1000))).toBe(false);
	});
});

describe("nextTailFollow", () => {
	it("starts out following", () => {
		expect(INITIAL_TAIL_FOLLOW.following).toBe(true);
	});

	// The whole point: an auto-scroll's own scroll event lands after the next
	// row has already grown the list past it.
	it("keeps following when the list grew out from under the auto-scroll", () => {
		const after = nextTailFollow({ lastTop: 500, following: true }, at(600, 1000));

		expect(after.following).toBe(true);
		expect(after.lastTop).toBe(600);
	});

	it("stops following when the reader scrolls up", () => {
		const after = nextTailFollow({ lastTop: 808, following: true }, at(0, 1000));

		expect(after.following).toBe(false);
	});

	it("stays stopped while the list keeps growing beneath the reader", () => {
		const after = nextTailFollow({ lastTop: 0, following: false }, at(0, 1400));

		expect(after.following).toBe(false);
	});

	it("resumes following once the reader returns to the tail", () => {
		const after = nextTailFollow({ lastTop: 0, following: false }, at(808, 1000));

		expect(after.following).toBe(true);
	});
});
