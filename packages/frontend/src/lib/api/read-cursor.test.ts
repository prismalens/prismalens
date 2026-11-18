// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { LIVE_CURSOR_HEADER as CONTRACT_CURSOR_HEADER } from "@prismalens/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	forgetReadCursor,
	LIVE_CURSOR_HEADER,
	missedSince,
	noteJoined,
	noteReadCursor,
	readCursor,
} from "./read-cursor";

describe("read-cursor (#1181)", () => {
	beforeEach(() => {
		forgetReadCursor();
	});

	it("keeps the smallest seq within one epoch, ignores null and malformed values, and keeps the first epoch when a later one differs", () => {
		// Tracks earliest read cursor across API responses and ignores invalid values.
		noteReadCursor(null);
		expect(readCursor()).toBeUndefined();
		noteReadCursor("");
		expect(readCursor()).toBeUndefined();
		noteReadCursor("invalid");
		expect(readCursor()).toBeUndefined();
		noteReadCursor("epoch.abc");
		expect(readCursor()).toBeUndefined();

		noteReadCursor("ep1.10");
		expect(readCursor()).toBe("ep1.10");

		noteReadCursor("ep1.15");
		expect(readCursor()).toBe("ep1.10");
		noteReadCursor("ep1.5");
		expect(readCursor()).toBe("ep1.5");
		noteReadCursor("ep1.8");
		expect(readCursor()).toBe("ep1.5");

		noteReadCursor("ep2.1");
		expect(readCursor()).toBe("ep1.5");
	});

	it("reports missedSince based on epoch match, beat boundary, and frame boundary", () => {
		// Frames missed since first read trigger catchup or replay.
		expect(missedSince("ep1.10", false)).toBe(false);
		expect(missedSince("ep1.10", true)).toBe(false);

		noteReadCursor("ep1.5");

		expect(missedSince("ep2.1", false)).toBe(true);
		expect(missedSince("ep2.1", true)).toBe(true);

		expect(missedSince("ep1.4", true)).toBe(false);
		expect(missedSince("ep1.5", true)).toBe(false);
		expect(missedSince("ep1.6", true)).toBe(true);

		expect(missedSince("ep1.5", false)).toBe(false);
		expect(missedSince("ep1.6", false)).toBe(false);
		expect(missedSince("ep1.7", false)).toBe(true);
	});

	it("matches the contracts LIVE_CURSOR_HEADER constant", () => {
		// Header name matches across contracts and frontend without loading contracts schema.
		expect(LIVE_CURSOR_HEADER).toBe(CONTRACT_CURSOR_HEADER);
	});

	it("re-reads once when a response from before the page joined the stream lands after it", () => {
		const late = vi.fn();
		noteJoined("ep1.10", false, late);
		noteReadCursor("ep1.9");
		expect(late).not.toHaveBeenCalled();
		noteReadCursor("ep1.7");
		noteReadCursor("ep1.5");
		expect(late).toHaveBeenCalledTimes(1);
	});

	it("a read at a joined beat's cursor missed nothing", () => {
		const late = vi.fn();
		noteJoined("ep1.10", true, late);
		noteReadCursor("ep1.10");
		expect(late).not.toHaveBeenCalled();
		noteReadCursor("ep0.40");
		expect(late).toHaveBeenCalledTimes(1);
	});
});
