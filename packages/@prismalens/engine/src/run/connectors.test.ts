// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { type ResolvedConnector, telemetryEndpointsFrom } from "./connectors.js";

describe("telemetryEndpointsFrom (#633)", () => {
	it("returns undefined when connectors array is empty or has none of the observability templates", () => {
		expect(telemetryEndpointsFrom([])).toBeUndefined();

		const otherConnectors: ResolvedConnector[] = [
			{
				templateId: "github-app",
				connectionId: "conn-1",
				label: "GitHub App",
				baseUrl: "https://api.github.com",
				segments: ["vcs"],
			},
			{
				templateId: "render",
				connectionId: "conn-2",
				label: "Render",
				baseUrl: "https://api.render.com",
				segments: ["deployment"],
			},
		];
		expect(telemetryEndpointsFrom(otherConnectors)).toBeUndefined();
	});

	it("strips trailing slash from baseUrl", () => {
		const connectors: ResolvedConnector[] = [
			{
				templateId: "prometheus",
				connectionId: "conn-prom",
				label: "Prometheus",
				baseUrl: "http://prometheus.internal:9090/",
				segments: ["metrics"],
			},
			{
				templateId: "alertmanager",
				connectionId: "conn-am",
				label: "Alertmanager",
				baseUrl: "http://alertmanager.internal:9093///",
				segments: [],
			},
		];

		const endpoints = telemetryEndpointsFrom(connectors);
		expect(endpoints).toEqual({
			prometheusUrl: "http://prometheus.internal:9090",
			alertmanagerUrl: "http://alertmanager.internal:9093",
		});
	});

	it("follows first-of-each rule when multiple connectors of the same template exist", () => {
		const connectors: ResolvedConnector[] = [
			{
				templateId: "prometheus",
				connectionId: "conn-prom-1",
				label: "Prometheus First",
				baseUrl: "http://prom-first:9090",
				segments: ["metrics"],
			},
			{
				templateId: "prometheus",
				connectionId: "conn-prom-2",
				label: "Prometheus Second",
				baseUrl: "http://prom-second:9090",
				segments: ["metrics"],
			},
			{
				templateId: "alertmanager",
				connectionId: "conn-am-1",
				label: "Alertmanager First",
				baseUrl: "http://am-first:9093",
				segments: [],
			},
			{
				templateId: "alertmanager",
				connectionId: "conn-am-2",
				label: "Alertmanager Second",
				baseUrl: "http://am-second:9093",
				segments: [],
			},
		];

		const endpoints = telemetryEndpointsFrom(connectors);
		expect(endpoints).toEqual({
			prometheusUrl: "http://prom-first:9090",
			alertmanagerUrl: "http://am-first:9093",
		});
	});
});
