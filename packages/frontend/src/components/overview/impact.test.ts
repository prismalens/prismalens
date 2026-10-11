// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	CHART_H,
	chartGeometry,
	formatValue,
	stripSpan,
	yTicks,
} from "./impact";

const NOW = Date.parse("2026-10-11T12:00:00Z");
const H = 3_600_000;
const iso = (t: number) => new Date(t).toISOString();

describe("strip", () => {
	it("places a span still firing at the right end", () => {
		const s = stripSpan({ start: iso(NOW - 12 * H), end: null }, NOW);
		expect(s.left + s.width).toBeCloseTo(100);
		expect(s.width).toBeCloseTo((12 / 168) * 100);
	});

	it("keeps a span that just began visible at the right end", () => {
		const s = stripSpan({ start: iso(NOW - 1000), end: null }, NOW);
		expect(s.left + s.width).toBeLessThanOrEqual(100);
		expect(s.width).toBeGreaterThan(0.5);
	});
});

describe("chart", () => {
	it("picks round ticks", () => {
		expect(yTicks(2.76)).toEqual([1, 2]);
		expect(yTicks(0.3)).toEqual([0.1, 0.2, 0.3]);
	});

	it("formats values", () => {
		expect(formatValue(2.4)).toBe("2.4");
		expect(formatValue(12_500)).toBe("12.5k");
		expect(formatValue(0.1234)).toBe("0.123");
	});

	it("formats values in the metric's unit (#811)", () => {
		expect(formatValue(2.4, "s")).toBe("2.4s");
		expect(formatValue(0.25, "s")).toBe("250ms");
		expect(formatValue(1_536_000, "bytes")).toBe("1.54 MB");
		expect(formatValue(2048, "bytes/s")).toBe("2.05 kB/s");
		expect(formatValue(0.05, "ratio")).toBe("5%");
		expect(formatValue(37.5, "percent")).toBe("37.5%");
		expect(formatValue(12, "count/s")).toBe("12/s");
		expect(formatValue(12_500, "count")).toBe("12.5k");
		expect(formatValue(2.4, null)).toBe("2.4");
	});

	it("charts more points than a call can take as arguments", () => {
		const points = Array.from(
			{ length: 500_000 },
			(_, i): [number, number] => [(NOW - 24 * H) / 1000 + i, i === 7 ? 9 : 1],
		);
		const g = chartGeometry({
			window: { start: iso(NOW - 24 * H), end: iso(NOW) },
			series: [{ labels: {}, points }],
			metric: null,
			deploys: [],
		});
		expect(g.ticks.at(-1)?.value).toBeGreaterThanOrEqual(9);
	});

	it("draws the threshold inside the box, skips gaps and puts the deploy at its time", () => {
		const g = chartGeometry({
			window: { start: iso(NOW - 24 * H), end: iso(NOW) },
			series: [
				{
					labels: {},
					points: [
						[(NOW - 24 * H) / 1000, 0.5],
						[(NOW - 12 * H) / 1000, null],
						[NOW / 1000, 2.4],
					],
				},
			],
			metric: {
				source: "alert",
				query: "p99 > 1",
				threshold: { op: ">", value: 1 },
			},
			deploys: [
				{
					id: "d",
					kind: "deployment",
					at: iso(NOW - 12 * H),
					title: "x",
					sha: "3f9a2c1d",
					tag: "v1.42",
					pr: null,
					author: null,
					files: null,
					url: null,
					repo: null,
					service: null,
					source: "git",
				},
			],
		});
		expect(g.thresholdY).toBeGreaterThan(0);
		expect(g.thresholdY).toBeLessThan(CHART_H);
		expect(g.deploys[0]).toMatchObject({ label: "Deploy v1.42" });
		expect(g.deploys[0]?.x).toBeCloseTo(360);
		expect(g.lines[0]?.split(" ")).toHaveLength(2);
		expect(g.area).not.toBeNull();
	});
});
