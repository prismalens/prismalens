// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { telemetrySources } from "@prismalens/contracts/schemas";
import { describe, expect, it, vi } from "vitest";
import { type ResolvedConnector, telemetryEndpointsFrom, telemetryOrigins } from "./connectors.js";

describe("telemetryEndpointsFrom (#633)", () => {
	it("returns undefined when connectors array is empty or has none of the observability templates", () => {
		expect(telemetryEndpointsFrom([])).toBeUndefined();

		const otherConnectors: ResolvedConnector[] = [
			{
				templateId: "github-token",
				connectionId: "conn-1",
				label: "GitHub token",
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
		expect(endpoints).toMatchObject({
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
		expect(endpoints).toMatchObject({
			prometheusUrl: "http://prom-first:9090",
			alertmanagerUrl: "http://am-first:9093",
		});
	});

	it("drops endpoints when baseUrl contains credentials (userinfo)", () => {
		const connectorsWithCreds: ResolvedConnector[] = [
			{
				templateId: "prometheus",
				connectionId: "conn-prom",
				label: "Prometheus",
				baseUrl: "https://user:pass@prometheus.internal:9090",
				segments: ["metrics"],
			},
			{
				templateId: "alertmanager",
				connectionId: "conn-am",
				label: "Alertmanager",
				baseUrl: "http://admin@alertmanager.internal:9093",
				segments: [],
			},
		];
		expect(telemetryEndpointsFrom(connectorsWithCreds)).toBeUndefined();
	});

	it("keeps clean endpoint when another endpoint has credentials", () => {
		const mixed: ResolvedConnector[] = [
			{
				templateId: "prometheus",
				connectionId: "conn-prom",
				label: "Prometheus",
				baseUrl: "https://user:pass@prometheus.internal:9090",
				segments: ["metrics"],
			},
			{
				templateId: "alertmanager",
				connectionId: "conn-am",
				label: "Alertmanager",
				baseUrl: "http://alertmanager.internal:9093/",
				segments: [],
			},
		];
		expect(telemetryEndpointsFrom(mixed)).toMatchObject({
			alertmanagerUrl: "http://alertmanager.internal:9093",
		});
		expect(telemetryEndpointsFrom(mixed)?.prometheusUrl).toBeUndefined();
	});

	it("drops endpoint when only password is present in baseUrl", () => {
		const pwOnly: ResolvedConnector[] = [
			{
				templateId: "prometheus",
				connectionId: "conn-prom",
				label: "Prometheus",
				baseUrl: "http://:secret@prometheus.internal:9090",
				segments: ["metrics"],
			},
		];
		expect(telemetryEndpointsFrom(pwOnly)).toBeUndefined();
	});

	it("drops a query or fragment and says which connection, without the secret", () => {
		const warn = vi.fn();
		const withQuery: ResolvedConnector[] = [
			{
				templateId: "prometheus",
				connectionId: "conn-prom",
				label: "Prometheus",
				baseUrl: "http://prometheus.internal:9090/?api_key=SECRET",
				segments: ["metrics"],
			},
			{
				templateId: "alertmanager",
				connectionId: "conn-am",
				label: "Alertmanager",
				baseUrl: "http://alertmanager.internal:9093/#token=SECRET",
				segments: [],
			},
		];
		expect(telemetryEndpointsFrom(withQuery, warn)).toBeUndefined();
		expect(warn).toHaveBeenCalledTimes(2);
		expect(warn.mock.calls.flat().join(" ")).toMatch(/^Prometheus: .*Alertmanager: /);
		expect(warn.mock.calls.flat().join(" ")).not.toContain("SECRET");
	});
});

describe("telemetry as a list of sources, with the old fields as a shim (#848)", () => {
	const c = (
		templateId: string,
		baseUrl: string,
		authenticated = false,
	): ResolvedConnector => ({
		templateId,
		connectionId: `${templateId}-${baseUrl}`,
		label: templateId,
		baseUrl,
		segments: [],
		authenticated,
	});

	it("lists every source and derives prometheusUrl / alertmanagerUrl from the credential-free ones", () => {
		const t = telemetryEndpointsFrom([
			c("prometheus", "https://mimir.example/", true),
			c("prometheus", "http://prom:9090"),
			c("alertmanager", "http://am:9093"),
			c("loki", "http://loki:3100"),
		]);
		expect(t?.sources?.map((s) => [s.kind, s.url, s.authenticated ?? false])).toEqual([
			["prometheus", "https://mimir.example", true],
			["prometheus", "http://prom:9090", false],
			["alertmanager", "http://am:9093", false],
			["loki", "http://loki:3100", false],
		]);
		expect(t?.prometheusUrl).toBe("http://prom:9090");
		expect(t?.alertmanagerUrl).toBe("http://am:9093");
	});

	it("a credentialed source never becomes a legacy URL or a Read-only origin", () => {
		const t = telemetryEndpointsFrom([c("prometheus", "https://mimir.example", true)]);
		expect(t?.prometheusUrl).toBeUndefined();
		expect(telemetryOrigins({ telemetry: t })).toEqual([]);
	});

	it("a context with only the old fields still reads as sources", () => {
		const legacy = { prometheusUrl: "http://prom:9090", alertmanagerUrl: "http://am:9093" };
		expect(telemetrySources(legacy).map((s) => [s.kind, s.url])).toEqual([
			["prometheus", "http://prom:9090"],
			["alertmanager", "http://am:9093"],
		]);
		expect(telemetryOrigins({ telemetry: legacy })).toEqual([
			"http://prom:9090",
			"http://am:9093",
		]);
	});
});

describe("telemetryOrigins (r4 R4.1)", () => {
	it("gives each brief address's origin, default ports dropped, hosts lowercased", () => {
		expect(
			telemetryOrigins({
				telemetry: { prometheusUrl: "http://Prom.Internal:9090/prom", alertmanagerUrl: "https://am.internal:443" },
				logs: { kind: "loki", url: "http://logs.internal:80/loki" },
			}).sort(),
		).toEqual(["http://logs.internal", "http://prom.internal:9090", "https://am.internal"]);
	});

	it("gives nothing for an empty brief or an address that does not parse", () => {
		expect(telemetryOrigins({})).toEqual([]);
		expect(telemetryOrigins({ telemetry: { apiUrl: "not a url" } })).toEqual([]);
		expect(telemetryOrigins({ telemetry: { apiUrl: "file:///etc/passwd" } })).toEqual([]);
	});
});
