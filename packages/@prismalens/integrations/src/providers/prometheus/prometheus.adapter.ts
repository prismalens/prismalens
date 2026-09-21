// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { providerHttpError } from "../../engine/provider-http-error.js";
import type { MetricsQueries, RangeSeries } from "../metrics.interface.js";
import type { AuthenticatedRequestFn, ProviderAdapter } from "../types.js";

interface PrometheusRangeQueryResult {
	data?: {
		result?: Array<{
			metric?: Record<string, string>;
			values?: Array<[number, string]>;
		}>;
	};
}

async function json<T>(response: Response): Promise<T> {
	if (!response.ok) {
		throw providerHttpError({
			operation: "Prometheus API request",
			provider: "prometheus",
			response,
		});
	}
	return response.json() as Promise<T>;
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
	): Promise<RangeSeries[]> {
		const startSec = Math.floor(q.start.getTime() / 1000);
		const endSec = Math.floor(q.end.getTime() / 1000);
		const path = `/api/v1/query_range?query=${encodeURIComponent(q.expr)}&start=${encodeURIComponent(String(startSec))}&end=${encodeURIComponent(String(endSec))}&step=${encodeURIComponent(String(q.stepSeconds))}`;

		const response = await request("GET", path);
		const body = await json<PrometheusRangeQueryResult>(response);

		return (body.data?.result ?? []).map((r) => ({
			labels: r.metric ?? {},
			values: r.values ?? [],
		}));
	}
}

export class PrometheusAdapter implements ProviderAdapter {
	readonly name = "prometheus";
	readonly metrics: MetricsQueries = new PrometheusMetricsSegment();
}
