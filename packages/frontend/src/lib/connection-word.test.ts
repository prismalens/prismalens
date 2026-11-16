// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	CONNECTING_MS,
	connectionWord,
	UNREACHABLE_AFTER_MS,
} from "./connection-word";

describe("connection-word", () => {
	it("exports expected constants", () => {
		expect(CONNECTING_MS).toBe(3000);
		expect(UNREACHABLE_AFTER_MS).toBe(45000);
	});

	it("connectionWord returns Connected when connected", () => {
		const res = connectionWord({ connected: true, lostAt: 0 }, 1000);
		expect(res).toEqual({
			state: "connected",
			word: "Connected",
			reason: null,
			asOf: null,
		});
	});

	it("connectionWord returns Host unreachable when device is offline", () => {
		const lostAt = 10000;
		const now = 12000;
		const clock = (at: number) => `${at}ms`;
		const res = connectionWord(
			{ connected: false, lostAt },
			now,
			false, // online = false
			clock,
		);
		expect(res).toEqual({
			state: "unreachable",
			word: "Host unreachable",
			reason: "This phone is offline; reconnects when it's back.",
			asOf: "What you see is as of 10000ms.",
		});
	});

	it("connectionWord returns Connecting when down < CONNECTING_MS", () => {
		const lostAt = 10000;
		const now = 12000; // down = 2000 < 3000
		const res = connectionWord({ connected: false, lostAt }, now, true);
		expect(res).toEqual({
			state: "connecting",
			word: "Connecting",
			reason: null,
			asOf: null,
		});
	});

	it("connectionWord returns Reconnecting when down is between CONNECTING_MS and UNREACHABLE_AFTER_MS", () => {
		const lostAt = 10000;
		const now = 20000; // down = 10000
		const clock = () => "2:02 PM";
		const res = connectionWord({ connected: false, lostAt }, now, true, clock);
		expect(res).toEqual({
			state: "reconnecting",
			word: "Reconnecting (as of 2:02 PM)",
			reason: "Connection lost, retrying.",
			asOf: "What you see is as of 2:02 PM.",
		});
	});

	it("connectionWord returns Host unreachable when down >= UNREACHABLE_AFTER_MS", () => {
		const lostAt = 10000;
		const now = 60000; // down = 50000 >= 45000
		const clock = () => "2:02 PM";
		const res = connectionWord({ connected: false, lostAt }, now, true, clock);
		expect(res).toEqual({
			state: "unreachable",
			word: "Host unreachable",
			reason: "Your computer may be asleep; reconnects when it's back.",
			asOf: "What you see is as of 2:02 PM.",
		});
	});
});
