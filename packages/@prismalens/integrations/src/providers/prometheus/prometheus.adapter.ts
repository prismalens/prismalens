// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { providerHttpError } from "../../engine/provider-http-error.js";
import {
	type AlertRule,
	type InstantSample,
	type MetricsQueries,
	type QueryBudget,
	QueryBudgetExceededError,
	type RangeSeries,
} from "../metrics.interface.js";
import type { AuthenticatedRequestFn, ProviderAdapter } from "../types.js";

interface PrometheusQueryResult<V> {
	data?: { result?: Array<{ metric?: Record<string, string> } & V> };
}

interface PrometheusRulesResult {
	data?: {
		groups?: Array<{
			rules?: Array<{
				type?: string;
				name?: string;
				query?: string;
				labels?: Record<string, string>;
			}>;
		}>;
	};
}

/** The body as JSON, read as a stream and abandoned past `maxBytes` (#811). */
async function json<T>(response: Response, maxBytes?: number): Promise<T> {
	if (!response.ok) {
		throw providerHttpError({
			operation: "Prometheus API request",
			provider: "prometheus",
			response,
		});
	}
	if (!maxBytes || !response.body) return response.json() as Promise<T>;
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > maxBytes) {
			await reader.cancel();
			throw new QueryBudgetExceededError(
				`Prometheus answered with more than ${maxBytes} bytes`,
			);
		}
		chunks.push(value);
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function query(params: Record<string, string | number | undefined>): string {
	return Object.entries(params)
		.filter((e): e is [string, string | number] => e[1] !== undefined)
		.map(
			([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`,
		)
		.join("&");
}

/** More series than the budget allows is too broad: a truncated answer may have dropped the one that matters. */
function capSeries<T>(rows: T[], budget?: QueryBudget): T[] {
	if (budget?.limit !== undefined && rows.length > budget.limit)
		throw new QueryBudgetExceededError(
			`Prometheus returned ${rows.length} series, over the limit of ${budget.limit}`,
		);
	return rows;
}

export class PrometheusMetricsSegment implements MetricsQueries {
	readonly name = "prometheus";

	async testConnection(request: AuthenticatedRequestFn): Promise<boolean> {
		try {
			const response = await request("GET", "/-/ready");
			return response.ok;
		} catch {
			return false;
		}
	}

	async rangeQuery(
		request: AuthenticatedRequestFn,
		q: { expr: string; start: Date; end: Date; stepSeconds: number },
		budget?: QueryBudget,
	): Promise<RangeSeries[]> {
		const path = `/api/v1/query_range?${query({
			query: q.expr,
			start: Math.floor(q.start.getTime() / 1000),
			end: Math.floor(q.end.getTime() / 1000),
			step: q.stepSeconds,
			timeout: budget?.timeout,
			limit: budget?.limit,
		})}`;
		const response = await request("GET", path, { signal: budget?.signal });
		const body = await json<
			PrometheusQueryResult<{ values?: Array<[number, string]> }>
		>(response, budget?.maxBytes);
		return capSeries(
			(body.data?.result ?? []).map((r) => ({
				labels: r.metric ?? {},
				values: r.values ?? [],
			})),
			budget,
		);
	}

	async instantQuery(
		request: AuthenticatedRequestFn,
		q: { expr: string; time: Date; lookbackDeltaSeconds?: number },
		budget?: QueryBudget,
	): Promise<InstantSample[]> {
		const path = `/api/v1/query?${query({
			query: q.expr,
			time: q.time.getTime() / 1000,
			lookback_delta:
				q.lookbackDeltaSeconds === undefined
					? undefined
					: `${q.lookbackDeltaSeconds}s`,
			timeout: budget?.timeout,
			limit: budget?.limit,
		})}`;
		const response = await request("GET", path, { signal: budget?.signal });
		const body = await json<
			PrometheusQueryResult<{ value?: [number, string] }>
		>(response, budget?.maxBytes);
		return capSeries(
			(body.data?.result ?? []).flatMap((r) =>
				r.value ? [{ labels: r.metric ?? {}, value: r.value }] : [],
			),
			budget,
		);
	}

	async alertRules(
		request: AuthenticatedRequestFn,
		name: string,
		budget?: QueryBudget,
	): Promise<AlertRule[]> {
		const path = `/api/v1/rules?${query({ type: "alert", "rule_name[]": name })}`;
		const response = await request("GET", path, { signal: budget?.signal });
		const body = await json<PrometheusRulesResult>(response, budget?.maxBytes);
		return (body.data?.groups ?? []).flatMap((g) =>
			(g.rules ?? []).flatMap((r) =>
				r.type === "alerting" && r.name === name && typeof r.query === "string"
					? [{ name: r.name, query: r.query, labels: r.labels ?? {} }]
					: [],
			),
		);
	}
}

export class PrometheusAdapter implements ProviderAdapter {
	readonly name = "prometheus";
	readonly metrics: MetricsQueries = new PrometheusMetricsSegment();
}
