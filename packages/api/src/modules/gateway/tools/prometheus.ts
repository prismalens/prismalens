// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineSourceTool, type SourceTool } from "@prismalens/integrations";
import { z } from "zod";
import {
	cap,
	LIMITS,
	type QuerySources,
	querySource,
	sourceArg,
	timeArg,
	toUnixSeconds,
} from "../source-tools.js";

const promData = (data: unknown) => {
	const d = (data as { data?: { resultType?: string; result?: unknown } }).data;
	if (!Array.isArray(d?.result))
		return { resultType: d?.resultType, result: d?.result };
	const { items, dropped } = cap(
		d.result as Record<string, unknown>[],
		LIMITS.series,
	);
	let pointsDropped = 0;
	const result = items.map((s) => {
		if (!Array.isArray(s.values)) return s;
		const values = s.values as unknown[];
		pointsDropped += Math.max(0, values.length - LIMITS.pointsPerSeries);
		return { ...s, values: values.slice(-LIMITS.pointsPerSeries) };
	});
	return {
		resultType: d.resultType,
		result,
		...(dropped ? { seriesDropped: dropped } : {}),
		...(pointsDropped ? { pointsDropped } : {}),
	};
};

const base = {
	category: "metrics",
	sideEffect: "read_only",
	openWorld: true,
} as const;

export function prometheusTools(
	sources: QuerySources,
	now: () => Date = () => new Date(),
): SourceTool[] {
	const query = z.object({
		query: z.string().trim().min(1).max(2_000),
		time: timeArg.optional(),
		source: sourceArg,
	});
	const range = z.object({
		query: z.string().trim().min(1).max(2_000),
		start: timeArg.optional(),
		end: timeArg.optional(),
		step: z
			.string()
			.trim()
			.max(20)
			.regex(/^[0-9.]+[smhd]?$/, "seconds or a duration like 30s")
			.optional(),
		source: sourceArg,
	});
	const alerts = z.object({ source: sourceArg });
	return [
		defineSourceTool({
			...base,
			name: "prometheus_query",
			title: "Prometheus instant query",
			description: `PromQL instant query against a connected Prometheus-compatible source. At most ${LIMITS.series} series are returned.`,
			input: query,
			run: ({ query, time, source }, ctx) =>
				querySource(
					sources,
					ctx,
					"prometheus",
					source,
					"api/v1/query",
					{ query, ...(time ? { time } : {}) },
					promData,
				),
		}),
		defineSourceTool({
			...base,
			name: "prometheus_query_range",
			title: "Prometheus range query",
			description: `PromQL range query. start/end are RFC 3339 or unix seconds (default: the last hour); step defaults to about ${LIMITS.pointsPerSeries} points. At most ${LIMITS.series} series and ${LIMITS.pointsPerSeries} points each.`,
			input: range,
			run: ({ query, start, end, step, source }, ctx) => {
				const endS = end ?? String(Math.floor(now().getTime() / 1000));
				const startS = start ?? String(toUnixSeconds(endS) - 3600);
				const span = toUnixSeconds(endS) - toUnixSeconds(startS);
				const autoStep = Number.isFinite(span)
					? `${Math.max(15, Math.ceil(span / LIMITS.pointsPerSeries))}s`
					: "60s";
				return querySource(
					sources,
					ctx,
					"prometheus",
					source,
					"api/v1/query_range",
					{ query, start: startS, end: endS, step: step ?? autoStep },
					promData,
				);
			},
		}),
		defineSourceTool({
			...base,
			name: "prometheus_alerts",
			title: "Prometheus alerts",
			description: `Alerts the Prometheus rule evaluator holds (pending and firing). At most ${LIMITS.alerts}.`,
			input: alerts,
			run: ({ source }, ctx) =>
				querySource(
					sources,
					ctx,
					"prometheus",
					source,
					"api/v1/alerts",
					{},
					(data) => {
						const list =
							(data as { data?: { alerts?: unknown[] } }).data?.alerts ?? [];
						const { items, dropped } = cap(list, LIMITS.alerts);
						return {
							alerts: items,
							...(dropped ? { alertsDropped: dropped } : {}),
						};
					},
				),
		}),
	];
}
