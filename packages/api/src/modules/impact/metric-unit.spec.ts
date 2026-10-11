// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { metricUnit, nameUnit } from "./metric-unit.js";

describe("nameUnit", () => {
	it.each([
		["http_request_duration_seconds", "s"],
		["node_memory_MemAvailable_bytes", "bytes"],
		["cache_hit_ratio", "ratio"],
		["disk_used_percent", "percent"],
		["http_requests_total", "count"],
		["process_cpu_seconds_total", "s"],
		["http_request_duration_seconds_bucket", "s"],
		["http_request_duration_seconds_count", "count"],
		["http_request_duration_seconds_sum", "s"],
		["up", null],
		["queue_depth", null],
	])("%s is %s", (name, unit) => {
		expect(nameUnit(name)).toBe(unit);
	});
});

describe("metricUnit", () => {
	it.each([
		[
			'histogram_quantile(0.99, sum by (le) (rate(http_request_duration_seconds_bucket{job="api"}[5m])))',
			"s",
		],
		["node_memory_MemAvailable_bytes", "bytes"],
		["max_over_time(job_duration_seconds[10m])", "s"],
		["sum(rate(http_requests_total[5m]))", "count/s"],
		["rate(node_network_receive_bytes_total[1m])", "bytes/s"],
		["increase(http_requests_total[1h])", "count"],
		[
			'sum(rate(http_requests_total{code=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))',
			"ratio",
		],
		["cache_hit_ratio * 100", "percent"],
		["count(up == 0)", "count"],
		["topk(3, process_resident_memory_bytes)", "bytes"],
		["-(x_bytes)", "bytes"],
		["1 - cache_hit_ratio", "ratio"],
	])("%s is %s", (query, unit) => {
		expect(metricUnit(query)).toBe(unit);
	});

	it.each([
		["up"],
		["queue_depth > 5"],
		["x_seconds / 1000"],
		["a_bytes + b_seconds"],
		["rate(process_cpu_seconds_total[5m])"],
		["vector(1)"],
		["sum(rate(x_total[5m]"],
		["42"],
	])("%s has no unit", (query) => {
		expect(metricUnit(query)).toBeNull();
	});
});
