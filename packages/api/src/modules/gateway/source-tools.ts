// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { McpServer } from "@modelcontextprotocol/server";
import type { AuthenticatedRequestFn } from "@prismalens/integrations";
import { z } from "zod";
import {
	OffHostRedirectError,
	SourceConfigError,
	scrubSecrets,
	TRUNCATED_HEADER,
} from "../integrations/source-request.js";

export type QueryKind = "prometheus" | "alertmanager" | "loki";
export const QUERY_KINDS: readonly QueryKind[] = [
	"prometheus",
	"alertmanager",
	"loki",
];

/** A connected source the gateway can query; the agent sees only id, label and kind. */
export interface QuerySource {
	id: string;
	label: string;
	kind: QueryKind;
	request?: AuthenticatedRequestFn;
	/** Every secret its credential holds, scrubbed from anything returned. */
	secrets: string[];
	/** Why it cannot be queried, in PrismaLens's own words. */
	unusable?: string;
}

export const LIMITS = {
	/** Bytes read from an upstream response. */
	responseBytes: 4 * 1024 * 1024,
	/** Characters of JSON one tool result returns. */
	resultChars: 32_000,
	series: 50,
	pointsPerSeries: 200,
	alerts: 100,
	logLines: 500,
	logLineChars: 2_000,
};

export const SOURCE_TOOL_NAMES = [
	"prometheus_query",
	"prometheus_query_range",
	"prometheus_alerts",
	"alertmanager_alerts",
	"loki_query_range",
] as const;

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };

function result(value: unknown, secrets: string[], isError = false): Result {
	let text = scrubSecrets(JSON.stringify(value, null, 1), secrets);
	if (text.length > LIMITS.resultChars)
		text = `${text.slice(0, LIMITS.resultChars)}\n…[truncated at ${LIMITS.resultChars} characters; narrow the query]`;
	return {
		content: [{ type: "text", text }],
		...(isError ? { isError: true } : {}),
	};
}

/** Why a request failed, without upstream text that may echo a credential. */
export function failureReason(e: unknown): string {
	if (e instanceof OffHostRedirectError)
		return "the source redirected to another host; PrismaLens does not follow it with your credential";
	if (e instanceof Error && e.name === "TimeoutError")
		return "the source did not answer in time";
	if (e instanceof SourceConfigError) return e.message;
	return "could not connect to the source";
}

function cap<T>(items: T[], max: number): { items: T[]; dropped: number } {
	return {
		items: items.slice(0, max),
		dropped: Math.max(0, items.length - max),
	};
}

const sourceArg = z
	.string()
	.trim()
	.max(200)
	.optional()
	.describe(
		"Source id or label from sources_list; defaults to the first connected one.",
	);
const timeArg = z
	.string()
	.trim()
	.max(40)
	.regex(/^[0-9TZ:.+-]+$/, "RFC 3339 or unix seconds");

/** Phase 1's read-only query tools (#848): Prometheus, Alertmanager, Loki through the api. */
export function registerSourceTools(
	server: McpServer,
	sources: (kind: QueryKind) => Promise<QuerySource[]>,
	now: () => Date = () => new Date(),
): void {
	async function run(
		kind: QueryKind,
		pick: string | undefined,
		path: string,
		params: Record<string, string>,
		shape: (data: unknown) => unknown,
	): Promise<Result> {
		const all = await sources(kind);
		if (!all.length)
			return result(
				{
					status: "not-configured",
					howToConnect: `No ${kind} source is connected. Connect one in PrismaLens under Settings, Integrations.`,
				},
				[],
			);
		const src = pick
			? all.find((s) => s.id === pick || s.label === pick)
			: (all.find((s) => !s.unusable) ?? all[0]);
		if (!src)
			return result(
				{
					error: `No ${kind} source named "${pick}"`,
					sources: all.map((s) => ({ id: s.id, label: s.label })),
				},
				[],
				true,
			);
		if (!src.request || src.unusable)
			return result(
				{ source: src.label, status: "unreachable", reason: src.unusable },
				[],
				true,
			);
		const qs = new URLSearchParams(params).toString();
		try {
			const res = await src.request("GET", qs ? `${path}?${qs}` : path, {
				headers: { Accept: "application/json" },
			});
			if (res.headers.get(TRUNCATED_HEADER))
				return result(
					{
						source: src.label,
						error: `the response is larger than ${LIMITS.responseBytes} bytes; narrow the query or shorten the range`,
					},
					src.secrets,
					true,
				);
			const text = await res.text();
			if (!res.ok)
				return result(
					{
						source: src.label,
						httpStatus: res.status,
						detail: text.slice(0, 500),
					},
					src.secrets,
					true,
				);
			return result(
				{ source: src.label, ...(shape(JSON.parse(text)) as object) },
				src.secrets,
			);
		} catch (e) {
			return result(
				{ source: src.label, error: failureReason(e) },
				src.secrets,
				true,
			);
		}
	}

	const promData = (data: unknown) => {
		const d = (data as { data?: { resultType?: string; result?: unknown } })
			.data;
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
	const ro = { readOnlyHint: true, openWorldHint: true } as const;

	server.registerTool(
		"prometheus_query",
		{
			title: "Prometheus instant query",
			description: `PromQL instant query against a connected Prometheus-compatible source. At most ${LIMITS.series} series are returned.`,
			inputSchema: z.object({
				query: z.string().trim().min(1).max(2_000),
				time: timeArg.optional(),
				source: sourceArg,
			}),
			annotations: ro,
		},
		({ query, time, source }) =>
			run(
				"prometheus",
				source,
				"api/v1/query",
				{ query, ...(time ? { time } : {}) },
				promData,
			),
	);
	server.registerTool(
		"prometheus_query_range",
		{
			title: "Prometheus range query",
			description: `PromQL range query. start/end are RFC 3339 or unix seconds (default: the last hour); step defaults to about ${LIMITS.pointsPerSeries} points. At most ${LIMITS.series} series and ${LIMITS.pointsPerSeries} points each.`,
			inputSchema: z.object({
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
			}),
			annotations: ro,
		},
		({ query, start, end, step, source }) => {
			const endS = end ?? String(Math.floor(now().getTime() / 1000));
			const startS = start ?? String(Number(endS) - 3600);
			const span = Number(endS) - Number(startS);
			const autoStep = Number.isFinite(span)
				? `${Math.max(15, Math.ceil(span / LIMITS.pointsPerSeries))}s`
				: "60s";
			return run(
				"prometheus",
				source,
				"api/v1/query_range",
				{ query, start: startS, end: endS, step: step ?? autoStep },
				promData,
			);
		},
	);
	server.registerTool(
		"prometheus_alerts",
		{
			title: "Prometheus alerts",
			description: `Alerts the Prometheus rule evaluator holds (pending and firing). At most ${LIMITS.alerts}.`,
			inputSchema: z.object({ source: sourceArg }),
			annotations: ro,
		},
		({ source }) =>
			run("prometheus", source, "api/v1/alerts", {}, (data) => {
				const alerts =
					(data as { data?: { alerts?: unknown[] } }).data?.alerts ?? [];
				const { items, dropped } = cap(alerts, LIMITS.alerts);
				return {
					alerts: items,
					...(dropped ? { alertsDropped: dropped } : {}),
				};
			}),
	);
	server.registerTool(
		"alertmanager_alerts",
		{
			title: "Alertmanager alerts",
			description: `Alerts in a connected Alertmanager, active only by default. filter takes matchers like severity="critical". At most ${LIMITS.alerts}.`,
			inputSchema: z.object({
				filter: z.array(z.string().trim().min(1).max(200)).max(10).optional(),
				includeSilenced: z.boolean().default(false),
				source: sourceArg,
			}),
			annotations: ro,
		},
		({ filter, includeSilenced, source }) => {
			const params = new URLSearchParams({
				active: "true",
				silenced: String(includeSilenced),
				inhibited: String(includeSilenced),
			});
			for (const f of filter ?? []) params.append("filter", f);
			return run(
				"alertmanager",
				source,
				`api/v2/alerts?${params.toString()}`,
				{},
				(data) => {
					const { items, dropped } = cap(
						Array.isArray(data) ? data : [],
						LIMITS.alerts,
					);
					return {
						alerts: items,
						...(dropped ? { alertsDropped: dropped } : {}),
					};
				},
			);
		},
	);
	server.registerTool(
		"loki_query_range",
		{
			title: "Loki log query",
			description: `LogQL query over a time range against a connected Loki, newest first. start/end are RFC 3339 or unix seconds (default: the last hour). limit 1-${LIMITS.logLines}, default 100; lines over ${LIMITS.logLineChars} characters are cut.`,
			inputSchema: z.object({
				query: z.string().trim().min(1).max(2_000),
				start: timeArg.optional(),
				end: timeArg.optional(),
				limit: z.number().int().min(1).max(LIMITS.logLines).default(100),
				source: sourceArg,
			}),
			annotations: ro,
		},
		({ query, start, end, limit, source }) => {
			const endS = end ?? String(Math.floor(now().getTime() / 1000));
			const startS = start ?? String(Number(endS) - 3600);
			return run(
				"loki",
				source,
				"loki/api/v1/query_range",
				{
					query,
					start: startS,
					end: endS,
					limit: String(limit),
					direction: "backward",
				},
				(data) => {
					const d = (
						data as { data?: { resultType?: string; result?: unknown } }
					).data;
					const streams = Array.isArray(d?.result)
						? (d.result as { stream?: unknown; values?: [string, string][] }[])
						: [];
					let budget = limit;
					const out: { stream: unknown; values: string[][] }[] = [];
					for (const s of streams) {
						if (budget <= 0) break;
						const values = (s.values ?? [])
							.slice(0, budget)
							.map(([ts, line]) => [
								ts,
								line.length > LIMITS.logLineChars
									? `${line.slice(0, LIMITS.logLineChars)}…`
									: line,
							]);
						budget -= values.length;
						out.push({ stream: s.stream, values });
					}
					return { resultType: d?.resultType, result: out };
				},
			);
		},
	);
}
