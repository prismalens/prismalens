// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ImpactChart, MetricUnit } from "@prismalens/contracts";

const DAY = 86_400_000;
const WEEK = 7 * DAY;

/** A firing span's place on the 7-day strip, in percent of its width. */
export function stripSpan(
	span: { start: string; end: string | null },
	now: number,
): { left: number; width: number } {
	const from = now - WEEK;
	const start = Date.parse(span.start);
	const end = span.end ? Date.parse(span.end) : now;
	const left = Math.max(0, ((start - from) / WEEK) * 100);
	const right = Math.min(100, ((end - from) / WEEK) * 100);
	const width = Math.max(0.6, right - left);
	return { left: Math.min(left, 100 - width), width };
}

/** Day names under the strip: the seven days before now, then Now. */
export function stripDays(now: number): string[] {
	const fmt = new Intl.DateTimeFormat(undefined, { weekday: "short" });
	return [
		...Array.from({ length: 7 }, (_, i) =>
			fmt.format(new Date(now - (7 - i) * DAY)),
		),
		"Now",
	];
}

/** Up to three round y ticks covering 0 to `max`. */
export function yTicks(max: number): number[] {
	if (!(max > 0)) return [0];
	const raw = max / 3;
	const mag = 10 ** Math.floor(Math.log10(raw));
	const step =
		[1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
	const ticks: number[] = [];
	for (let v = step; v <= max + step * 1e-9 && ticks.length < 3; v += step)
		ticks.push(Number(v.toPrecision(6)));
	return ticks;
}

const BYTES = ["B", "kB", "MB", "GB", "TB"];

function bytes(v: number): string {
	let i = 0;
	while (Math.abs(v) >= 1000 && i < BYTES.length - 1) {
		v /= 1000;
		i++;
	}
	return `${trim(v)} ${BYTES[i]}`;
}

/** A value as the chart prints it in the metric's unit: 2.4s, 120ms, 1.5 MB, 5%, 12/s; no unit: 2.4, 12.5k. */
export function formatValue(v: number, unit?: MetricUnit | null): string {
	switch (unit) {
		case "s":
			return v !== 0 && Math.abs(v) < 1 ? `${trim(v * 1000)}ms` : `${trim(v)}s`;
		case "bytes":
			return bytes(v);
		case "bytes/s":
			return `${bytes(v)}/s`;
		case "ratio":
			return `${trim(v * 100)}%`;
		case "percent":
			return `${trim(v)}%`;
		case "count/s":
			return `${plain(v)}/s`;
		default:
			return plain(v);
	}
}

function plain(v: number): string {
	const abs = Math.abs(v);
	if (abs >= 1e6) return `${trim(v / 1e6)}M`;
	if (abs >= 1e4) return `${trim(v / 1e3)}k`;
	return trim(v);
}

function trim(v: number): string {
	const abs = Math.abs(v);
	const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : abs >= 1 ? 2 : 3;
	return String(Number(v.toFixed(digits)));
}

export const CHART_W = 720;
export const CHART_H = 200;

/** SVG geometry for the chart in a 720 x 200 box, y from 0 up past the data and the threshold. */
export function chartGeometry(
	impact: Pick<ImpactChart, "window" | "series" | "metric" | "deploys">,
): {
	lines: string[];
	area: string | null;
	ticks: { value: number; y: number }[];
	thresholdY: number | null;
	deploys: { x: number; label: string }[];
	xLabels: { x: number; label: string }[];
} {
	const t0 = Date.parse(impact.window.start);
	const t1 = Date.parse(impact.window.end);
	const span = Math.max(1, t1 - t0);
	const threshold = impact.metric?.threshold?.value ?? null;
	const values = impact.series.flatMap((s) =>
		s.points.flatMap((p) =>
			p[1] !== null && Number.isFinite(p[1]) ? [p[1]] : [],
		),
	);
	const top = Math.max(0, ...values, threshold ?? 0) * 1.15 || 1;
	const ticks = yTicks(top);
	const max = Math.max(top, ticks.at(-1) ?? top);
	const x = (ms: number) => ((ms - t0) / span) * CHART_W;
	const y = (v: number) => CHART_H - (v / max) * (CHART_H - 4);
	const lines = impact.series.map((s) =>
		s.points
			.flatMap((p) =>
				p[1] !== null && Number.isFinite(p[1])
					? [`${x(p[0] * 1000).toFixed(1)},${y(p[1]).toFixed(1)}`]
					: [],
			)
			.join(" "),
	);
	const only = impact.series.length === 1 && lines[0] ? lines[0] : null;
	const first = only?.split(" ")[0]?.split(",")[0];
	const last = only?.split(" ").at(-1)?.split(",")[0];
	const fmt = new Intl.DateTimeFormat(undefined, {
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});
	return {
		lines,
		area: only ? `${first},${CHART_H} ${only} ${last},${CHART_H}` : null,
		ticks: ticks.map((v) => ({ value: v, y: y(v) })),
		thresholdY: threshold === null ? null : y(threshold),
		deploys: impact.deploys
			.map((d) => ({
				x: x(Date.parse(d.at)),
				label: d.tag
					? `Deploy ${d.tag}`
					: `Deploy ${d.sha?.slice(0, 7) ?? ""}`.trim(),
			}))
			.filter((d) => d.x >= 0 && d.x <= CHART_W),
		xLabels: [0, 0.25, 0.5, 0.75].map((f) => ({
			x: f * 100,
			label: fmt.format(new Date(t0 + f * span)),
		})),
	};
}
