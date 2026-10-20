// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineSourceTool, type SourceTool } from "@prismalens/integrations";
import { z } from "zod";
import {
	LIMITS,
	type QuerySources,
	querySource,
	sourceArg,
	timeArg,
} from "../source-tools.js";

export function lokiTools(
	sources: QuerySources,
	now: () => Date = () => new Date(),
): SourceTool[] {
	return [
		defineSourceTool({
			name: "loki_query_range",
			title: "Loki log query",
			description: `LogQL query over a time range against a connected Loki, newest first. start/end are RFC 3339 or unix seconds (default: the last hour). limit 1-${LIMITS.logLines}, default 100; lines over ${LIMITS.logLineChars} characters are cut.`,
			input: z.object({
				query: z.string().trim().min(1).max(2_000),
				start: timeArg.optional(),
				end: timeArg.optional(),
				limit: z.number().int().min(1).max(LIMITS.logLines).default(100),
				source: sourceArg,
			}),
			category: "logs",
			sideEffect: "read_only",
			openWorld: true,
			run: ({ query, start, end, limit, source }, ctx) => {
				const endS = end ?? String(Math.floor(now().getTime() / 1000));
				const startS = start ?? String(Number(endS) - 3600);
				return querySource(
					sources,
					ctx,
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
							? (d.result as {
									stream?: unknown;
									values?: [string, string][];
								}[])
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
		}),
	];
}
