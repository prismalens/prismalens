// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	agentName,
	bucketLabel,
	cacheHitRate,
	costPerMillion,
	countOf,
	formatCost,
	formatShare,
	formatTokens,
	formatUntil,
	listNames,
	paceElapsed,
	paceWord,
	percentLeft,
	share,
	warnHint,
	warnWindow,
	windowLabel,
} from "./usage-math";

describe("usage-math", () => {
	it("agentName returns known agent label or id when unknown", () => {
		expect(agentName("claude-code")).toBe("Claude Code");
		expect(agentName("codex")).toBe("Codex");
		expect(agentName("unknown-agent")).toBe("unknown-agent");
	});

	it("listNames formats names with conjunction", () => {
		expect(listNames(["Codex"])).toBe("Codex");
		expect(listNames(["Codex", "OpenCode"])).toBe("Codex and OpenCode");
		expect(listNames(["A", "B", "C"])).toBe("A, B, and C");
	});

	it("formatTokens formats token counts", () => {
		expect(formatTokens(840)).toBe("840");
		expect(formatTokens(12300)).toBe("12.3K");
		expect(formatTokens(1200000)).toBe("1.2M");
		expect(formatTokens(3000000000)).toBe("3B");
	});

	it("formatCost handles null, tiny amounts, and normal currency", () => {
		expect(formatCost(null)).toBe("Unpriced");
		expect(formatCost(0.005, "USD")).toBe("<$0.01");
		expect(formatCost(12.34, "USD")).toBe("$12.34");
	});

	it("share and formatShare compute and format proportions", () => {
		expect(share(0, 0)).toBe(0);
		expect(share(25, 100)).toBe(0.25);

		expect(formatShare(0)).toBe("0%");
		expect(formatShare(0.005)).toBe("<1%");
		expect(formatShare(0.42)).toBe("42%");
	});

	it("cacheHitRate calculates proportion of cache reads over total input", () => {
		expect(
			cacheHitRate({
				input: 100,
				output: 50,
				cacheRead: 0,
				cacheWrite: 0,
				total: 150,
			}),
		).toBe(null);

		expect(
			cacheHitRate({
				input: 100,
				output: 50,
				cacheRead: 100,
				cacheWrite: 0,
				total: 250,
			}),
		).toBe(0.5);
	});

	it("costPerMillion calculates cost per 1M tokens", () => {
		expect(costPerMillion(null, 1000)).toBe(null);
		expect(costPerMillion(10, 0)).toBe(null);
		expect(costPerMillion(5, 1_000_000)).toBe(5);
		expect(costPerMillion(15, 3_000_000)).toBe(5);
	});

	it("percentLeft clamps 100 - usedPercent to [0, 100]", () => {
		expect(percentLeft(null)).toBe(null);
		expect(percentLeft(30)).toBe(70);
		expect(percentLeft(-10)).toBe(100);
		expect(percentLeft(120)).toBe(0);
	});

	it("paceElapsed computes elapsed proportion with fixed now", () => {
		const now = Date.parse("2026-11-12T12:00:00.000Z");
		expect(paceElapsed(null, "2026-11-12T13:00:00.000Z", now)).toBe(null);
		expect(paceElapsed("daily", null, now)).toBe(null);

		// Daily window is 24 hours. Resets in 6 hours means 18 hours elapsed (75%).
		const resetsIn6Hours = new Date(now + 6 * 3600 * 1000).toISOString();
		expect(paceElapsed("daily", resetsIn6Hours, now)).toBe(0.75);
	});

	it("paceWord evaluates pace against elapsed time", () => {
		expect(paceWord(null, 0.5)).toBe(null);
		expect(paceWord(50, null)).toBe(null);
		// 55 used vs 50 elapsed (0.5 * 100): ahead by 5
		expect(paceWord(55, 0.5)).toBe("Ahead of pace");
		// 54 used vs 50 elapsed: on pace
		expect(paceWord(54, 0.5)).toBe("On pace");
	});

	it("formatUntil produces human readable remaining duration", () => {
		const now = Date.parse("2026-11-12T12:00:00.000Z");
		const past = new Date(now - 1000).toISOString();
		expect(formatUntil(past, now)).toBe("now");

		const in12m = new Date(now + 12 * 60 * 1000).toISOString();
		expect(formatUntil(in12m, now)).toBe("12m");

		const in2h39m = new Date(now + (2 * 60 + 39) * 60 * 1000).toISOString();
		expect(formatUntil(in2h39m, now)).toBe("2h 39m");

		const in3d4h = new Date(
			now + (3 * 24 * 60 + 4 * 60) * 60 * 1000,
		).toISOString();
		expect(formatUntil(in3d4h, now)).toBe("3d 4h");
	});

	it("windowLabel returns formatted window name", () => {
		expect(windowLabel({ window: "session", type: null })).toBe(
			"Session, 5 hours",
		);
		expect(windowLabel({ window: "daily", type: null })).toBe("Daily");
		expect(
			windowLabel({ window: "model", type: "seven_day_claude_3_7_sonnet" }),
		).toBe("Weekly, Claude 3 7 sonnet");
		expect(windowLabel({ window: "model", type: null })).toBe("Weekly");
		expect(windowLabel({ window: null, type: "custom_quota" })).toBe(
			"Custom quota",
		);
	});

	it("bucketLabel formats day in UTC and hour locally", () => {
		// The runner's locale orders day and month; the UTC day must not shift.
		const utcDay = new Intl.DateTimeFormat(undefined, {
			day: "numeric",
			month: "short",
			timeZone: "UTC",
		}).format(Date.UTC(2026, 10, 12));
		expect(bucketLabel("2026-11-12", "day")).toBe(utcDay);
		expect(utcDay.split(/\W+/)).toContain("12");
		expect(utcDay).toMatch(/Nov/);
		// For hour, verify it parses and formats non-empty string
		const hourStr = bucketLabel("2026-11-12T14:00:00.000Z", "hour");
		expect(hourStr).toMatch(/^\d{2}:\d{2}$/);
	});

	it("countOf pluralizes words based on count", () => {
		expect(countOf(1, "turn")).toBe("1 turn");
		expect(countOf(3, "turn")).toBe("3 turns");
	});
});

describe("the composer's usage warning (#1101)", () => {
	const NOW = Date.parse("2026-11-12T10:00:00Z");
	const w = (
		window: "session" | "weekly",
		usedPercent: number | null,
		status: string | null,
		resetsInMin: number | null,
	) => ({
		window,
		type: window === "session" ? "five_hour" : "seven_day",
		usedPercent,
		status,
		resetsAt:
			resetsInMin === null
				? null
				: new Date(NOW + resetsInMin * 60_000).toISOString(),
	});

	it("warns on nothing while every window is under 90%", () => {
		expect(
			warnWindow([w("session", 89, "allowed", 60), w("weekly", 40, null, 3000)], NOW),
		).toBeNull();
	});

	it("warns at 90% and on the agent's own warning below it", () => {
		const near = w("weekly", 90, null, 3000);
		expect(warnWindow([w("session", 50, null, 60), near], NOW)).toBe(near);
		const warned = w("session", 70, "allowed_warning", 60);
		expect(warnWindow([warned], NOW)).toBe(warned);
	});

	it("picks a full window over a fuller-looking near one, as the Limited stop does", () => {
		const full = w("session", 80, "rejected", 60);
		expect(warnWindow([w("weekly", 99, null, 3000), full], NOW)).toBe(full);
	});

	it("picks the more used of two near windows", () => {
		const more = w("weekly", 96, null, 3000);
		expect(warnWindow([w("session", 91, null, 60), more], NOW)).toBe(more);
	});

	it("ignores a window whose reset has already passed", () => {
		expect(warnWindow([w("session", 100, "rejected", -1)], NOW)).toBeNull();
	});

	it("says the window, the share used and when it resets", () => {
		const hint = warnHint(w("session", 93.4, null, 74), NOW);
		expect(hint.startsWith("Session, 5 hours: 93% used, resets ")).toBe(true);
		expect(hint.endsWith(" (in 1h 14m)")).toBe(true);
		expect(warnHint(w("weekly", null, "rejected", null), NOW)).toBe(
			"Weekly: limit reached",
		);
	});
});
