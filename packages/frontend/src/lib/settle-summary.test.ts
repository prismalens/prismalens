// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	type SettlePreview,
	settleBlocked,
	settleConfirm,
	settleLine,
} from "./settle-summary";

const emptyPreview: SettlePreview = {
	running: 0,
	watches: 0,
	crons: 0,
	children: 0,
	worktrees: [],
};

describe("settleLine (#1024)", () => {
	it("returns Ends 2 watches and 1 cron for 2 watches + 1 cron", () => {
		const p: SettlePreview = {
			...emptyPreview,
			watches: 2,
			crons: 1,
		};
		expect(settleLine("Fix login", p)).toBe(
			"Settled Fix login. Ends 2 watches and 1 cron",
		);
	});

	it("returns Stops 1 child thread for 1 child", () => {
		const p: SettlePreview = {
			...emptyPreview,
			children: 1,
		};
		expect(settleLine("Fix login", p)).toBe(
			"Settled Fix login. Stops 1 child thread",
		);
	});

	it("returns Worktree feat-x will be removed for removed worktree feat-x", () => {
		const p: SettlePreview = {
			...emptyPreview,
			worktrees: [{ name: "feat-x", removed: true }],
		};
		expect(settleLine("Fix login", p)).toBe(
			"Settled Fix login. Worktree feat-x will be removed",
		);
	});

	it("returns Keeps worktree feat-x: 3 commits not pushed when kept with reason", () => {
		const p: SettlePreview = {
			...emptyPreview,
			worktrees: [
				{
					name: "feat-x",
					removed: false,
					reason: "3 commits not pushed",
				},
			],
		};
		expect(settleLine("Fix login", p)).toBe(
			"Settled Fix login. Keeps worktree feat-x: 3 commits not pushed",
		);
	});

	it("returns Stopped 1 agent when stopped is 1", () => {
		expect(settleLine("Fix login", emptyPreview, 1)).toBe(
			"Settled Fix login. Stopped 1 agent",
		);
	});

	it("returns Settled Fix login when there is nothing to end or stop", () => {
		expect(settleLine("Fix login", emptyPreview, 0)).toBe("Settled Fix login");
	});
});

describe("settleConfirm (#1024)", () => {
	it("returns confirmation prompt when running agent count is 1", () => {
		expect(settleConfirm({ running: 1 })).toBe(
			"Stop 1 running agent and settle?",
		);
	});

	it("returns null when running agent count is 0", () => {
		expect(settleConfirm({ running: 0 })).toBeNull();
	});
});

describe("settleBlocked (#1024)", () => {
	it("returns block message when canStop is false and ends exist", () => {
		const p: SettlePreview = {
			...emptyPreview,
			watches: 1,
		};
		expect(settleBlocked(p, false)).toBe(
			"Settle on a device that can stop runs",
		);
	});

	it("returns null when canStop is true or ends count is 0", () => {
		const pWithEnds: SettlePreview = {
			...emptyPreview,
			watches: 1,
		};
		expect(settleBlocked(pWithEnds, true)).toBeNull();
		expect(settleBlocked(emptyPreview, false)).toBeNull();
	});
});
