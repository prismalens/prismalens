// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedRequestFn } from "../types.js";
import {
	PrometheusAdapter,
	PrometheusMetricsSegment,
} from "./prometheus.adapter.js";

describe("PrometheusAdapter (#633)", () => {
	it("exposes the metrics segment", () => {
		const adapter = new PrometheusAdapter();
		expect(adapter.name).toBe("prometheus");
		expect(adapter.metrics).toBeInstanceOf(PrometheusMetricsSegment);
		expect(adapter.vcs).toBeUndefined();
		expect(adapter.deployment).toBeUndefined();
	});

	describe("testConnection", () => {
		it("returns true when /-/ready is 200 OK", async () => {
			const segment = new PrometheusMetricsSegment();
			const request: AuthenticatedRequestFn = vi.fn(async (method, path) => {
				expect(method).toBe("GET");
				expect(path).toBe("/-/ready");
				return new Response("Prometheus is Ready.\n", { status: 200 });
			});

			const ok = await segment.testConnection(request);
			expect(ok).toBe(true);
		});

		it("returns false on 503", async () => {
			const segment = new PrometheusMetricsSegment();
			const request: AuthenticatedRequestFn = vi.fn(async () => {
				return new Response("Service Unavailable", { status: 503 });
			});

			const ok = await segment.testConnection(request);
			expect(ok).toBe(false);
		});

		it("returns false when request throws", async () => {
			const segment = new PrometheusMetricsSegment();
			const request: AuthenticatedRequestFn = vi.fn(async () => {
				throw new Error("Network connection refused");
			});

			const ok = await segment.testConnection(request);
			expect(ok).toBe(false);
		});
	});

	describe("rangeQuery", () => {
		it("builds the URL and maps values", async () => {
			const segment = new PrometheusMetricsSegment();
			const start = new Date(1700000000 * 1000);
			const end = new Date(1700003600 * 1000);

			let requestedPath = "";
			const request: AuthenticatedRequestFn = vi.fn(async (method, path) => {
				expect(method).toBe("GET");
				requestedPath = path;
				return new Response(
					JSON.stringify({
						status: "success",
						data: {
							resultType: "matrix",
							result: [
								{
									metric: { __name__: "up", job: "node" },
									values: [
										[1700000000, "1"],
										[1700000060, "1"],
									],
								},
							],
						},
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			});

			const series = await segment.rangeQuery(request, {
				expr: 'up{job="node"}',
				start,
				end,
				stepSeconds: 60,
			});

			expect(requestedPath).toBe(
				`/api/v1/query_range?query=${encodeURIComponent('up{job="node"}')}&start=1700000000&end=1700003600&step=60`,
			);
			expect(series).toEqual([
				{
					labels: { __name__: "up", job: "node" },
					values: [
						[1700000000, "1"],
						[1700000060, "1"],
					],
				},
			]);
		});

		it("throws through providerHttpError on non-ok status", async () => {
			const segment = new PrometheusMetricsSegment();
			const request: AuthenticatedRequestFn = vi.fn(async () => {
				return new Response("Bad Request: parse error", { status: 400 });
			});

			await expect(
				segment.rangeQuery(request, {
					expr: "invalid(expr",
					start: new Date(1000),
					end: new Date(2000),
					stepSeconds: 15,
				}),
			).rejects.toThrowError(
				"Prometheus API request failed for provider 'prometheus' (HTTP 400 Bad Request)",
			);
		});
	});
});
