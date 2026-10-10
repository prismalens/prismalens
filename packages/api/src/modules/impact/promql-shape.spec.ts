// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	breaches,
	expressionShape,
	graphExpr,
	httpLink,
	isAlertsSeriesExpr,
} from "./promql-shape.js";

describe("expressionShape", () => {
	it("splits a single threshold into the series and the line", () => {
		expect(expressionShape('up{job="api"} == 0')).toEqual({
			series: 'up{job="api"}',
			threshold: { op: "==", value: 0 },
			uncheckable: null,
		});
		expect(expressionShape("(node_load1 > 4)")).toMatchObject({
			series: "node_load1",
			threshold: { op: ">", value: 4 },
			uncheckable: null,
		});
	});

	it("mirrors the op when the number is on the left", () => {
		expect(expressionShape("0.5 < queue_depth")).toEqual({
			series: "queue_depth",
			threshold: { op: ">", value: 0.5 },
			uncheckable: null,
		});
	});

	it("reads a negative or scientific threshold", () => {
		expect(expressionShape("temp < -5").threshold).toEqual({ op: "<", value: -5 });
		expect(expressionShape("bytes >= 1e9").threshold).toEqual({ op: ">=", value: 1e9 });
	});

	it("charts a range function's threshold but never checks it", () => {
		for (const expr of [
			'histogram_quantile(0.99, sum by (le) (rate(http_bucket{job="a"}[5m]))) > 0.5',
			"max_over_time(x[10m:1m]) > 2",
			"x offset 5m > 1",
			"x @ 1700000000 > 1",
		]) {
			const shape = expressionShape(expr);
			expect(shape.uncheckable, expr).toBe("range-function");
			expect(shape.threshold, expr).not.toBeNull();
		}
	});

	it("leaves every other shape whole with no threshold", () => {
		for (const expr of [
			"x > bool 1",
			"x > y",
			"absent(up{job=\"a\"})",
			"(x > 1) and y",
			"up",
			"1 > 2",
			"x >",
		]) {
			expect(expressionShape(expr), expr).toEqual({
				series: expr,
				threshold: null,
				uncheckable: "unsupported-shape",
			});
		}
	});
});

describe("breaches", () => {
	it("judges each op with the series on the left", () => {
		expect(breaches(0.6, { op: ">", value: 0.5 })).toBe(true);
		expect(breaches(0.5, { op: ">", value: 0.5 })).toBe(false);
		expect(breaches(0.5, { op: ">=", value: 0.5 })).toBe(true);
		expect(breaches(1, { op: "<", value: 2 })).toBe(true);
		expect(breaches(2, { op: "<=", value: 2 })).toBe(true);
		expect(breaches(0, { op: "==", value: 0 })).toBe(true);
		expect(breaches(1, { op: "!=", value: 0 })).toBe(true);
	});
});

describe("graph links", () => {
	it("reads g0.expr and the base before /graph, keeping a path prefix", () => {
		const url = `http://prom.local:9090/prometheus/graph?g0.expr=${encodeURIComponent("x > 1")}&g0.tab=1`;
		expect(graphExpr(url)).toEqual({ expr: "x > 1", base: "http://prom.local:9090/prometheus" });
	});

	it("gives none for a link without an expression or a non-web scheme", () => {
		expect(graphExpr("https://grafana.local/alerting/1afz/edit")).toBeNull();
		expect(graphExpr("file:///etc/passwd?g0.expr=x")).toBeNull();
		expect(graphExpr("not a url")).toBeNull();
		expect(graphExpr(null)).toBeNull();
		expect(httpLink("javascript:alert(1)")).toBeNull();
		expect(httpLink("https://grafana.local/x")).toBe("https://grafana.local/x");
	});

	it("knows the catch-up form, which is the firing series and never the metric", () => {
		expect(isAlertsSeriesExpr('ALERTS{alertname="Slow"}', "Slow")).toBe(true);
		expect(isAlertsSeriesExpr('ALERTS{alertname="Slow"} > 0', "Slow")).toBe(false);
		expect(isAlertsSeriesExpr('ALERTS{alertname="Other"}', "Slow")).toBe(false);
	});
});
