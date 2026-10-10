// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import { QueryBudgetExceededError } from "../metrics.interface.js";
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

describe("budgeted queries (#811)", () => {
	const segment = new PrometheusMetricsSegment();
	const ok = (data: unknown) =>
		new Response(JSON.stringify({ status: "success", data }), { status: 200 });

	it("sends limit, timeout and the caller's signal on a range query", async () => {
		const signal = new AbortController().signal;
		const request = vi.fn<AuthenticatedRequestFn>(async () =>
			ok({ result: [{ metric: { job: "a" }, values: [[1, "2"]] }] }),
		);
		const out = await segment.rangeQuery(
			request,
			{ expr: "up > 0", start: new Date(0), end: new Date(60_000), stepSeconds: 60 },
			{ limit: 50, timeout: "8s", signal, maxBytes: 1_000_000 },
		);
		expect(out).toEqual([{ labels: { job: "a" }, values: [[1, "2"]] }]);
		const [, path, opts] = request.mock.calls[0] ?? [];
		expect(path).toContain("query=up%20%3E%200");
		expect(path).toContain("limit=50");
		expect(path).toContain("timeout=8s");
		expect(opts?.signal).toBe(signal);
	});

	it("refuses a body over the byte cap", async () => {
		const request: AuthenticatedRequestFn = async () =>
			ok({ result: [{ metric: { a: "x".repeat(5000) }, values: [] }] });
		await expect(
			segment.rangeQuery(
				request,
				{ expr: "up", start: new Date(0), end: new Date(1), stepSeconds: 60 },
				{ maxBytes: 1000 },
			),
		).rejects.toBeInstanceOf(QueryBudgetExceededError);
	});

	it("refuses more series than the limit from a server that ignores it", async () => {
		const result = Array.from({ length: 3 }, (_, i) => ({
			metric: { i: String(i) },
			value: [1, "1"],
		}));
		const request: AuthenticatedRequestFn = async () => ok({ result });
		await expect(
			segment.instantQuery(request, { expr: "up", time: new Date(1000) }, { limit: 2 }),
		).rejects.toBeInstanceOf(QueryBudgetExceededError);
	});

	it("asks for one instant at an explicit time with a lookback", async () => {
		const request = vi.fn<AuthenticatedRequestFn>(async () =>
			ok({ result: [{ metric: { job: "a" }, value: [1700000000, "0.5"] }] }),
		);
		const out = await segment.instantQuery(request, {
			expr: "up",
			time: new Date(1_700_000_000_000),
			lookbackDeltaSeconds: 300,
		});
		expect(out).toEqual([{ labels: { job: "a" }, value: [1700000000, "0.5"] }]);
		const path = request.mock.calls[0]?.[1] ?? "";
		expect(path).toContain("time=1700000000");
		expect(path).toContain("lookback_delta=300s");
	});

	it("keeps only alerting rules with the exact name", async () => {
		const request = vi.fn<AuthenticatedRequestFn>(async () =>
			ok({
				groups: [
					{
						rules: [
							{ type: "alerting", name: "Slow", query: "x > 1", labels: { severity: "page" } },
							{ type: "recording", name: "Slow", query: "x" },
							{ type: "alerting", name: "Other", query: "y > 1" },
						],
					},
				],
			}),
		);
		expect(await segment.alertRules(request, "Slow")).toEqual([
			{ name: "Slow", query: "x > 1", labels: { severity: "page" } },
		]);
		expect(request.mock.calls[0]?.[1]).toBe(
			"/api/v1/rules?type=alert&rule_name%5B%5D=Slow",
		);
	});

	it("names the status, never the body, on a refused query", async () => {
		const request: AuthenticatedRequestFn = async () =>
			new Response('{"error":"secret detail"}', { status: 400 });
		await expect(
			segment.instantQuery(request, { expr: "up", time: new Date() }),
		).rejects.toThrow(/Prometheus API request failed/);
	});
});
