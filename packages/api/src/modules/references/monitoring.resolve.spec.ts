// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { OpenedSource } from "../integrations/open-source.js";
import {
	type MonitoringSources,
	MonitoringProvider,
} from "./monitoring.provider.js";
import { SourceUnavailable } from "./reference-provider.js";

const ALERTS = [
	{
		fingerprint: "f1",
		labels: { alertname: "DiskFull", severity: "critical" },
		annotations: { summary: "Disk full on /var" },
		startsAt: "2026-11-06T10:00:00Z",
		status: { state: "active" },
	},
];

function sources(base: string | null, withBaseUrl = true): MonitoringSources {
	return {
		connections: async () => [{ id: "am-1", label: "prod" }],
		...(withBaseUrl ? { baseUrl: async () => base } : {}),
		open: async (src) => ({
			id: src.id,
			label: src.label,
			kind: "alertmanager",
			secrets: [],
			request: (async (_m: string, path: string) =>
				path.startsWith("api/v2/alerts")
					? new Response(JSON.stringify(ALERTS), { status: 200 })
					: new Response("[]", { status: 200 })) as unknown as OpenedSource["request"],
		}),
	};
}

const signal = new AbortController().signal;
const am = (base: string | null, withBaseUrl = true) =>
	new MonitoringProvider("Alertmanager", sources(base, withBaseUrl));

/** The refusal a link gets, as the resolve route reports it. */
async function refusal(p: MonitoringProvider, url: string) {
	const e = await p.resolveUrl(new URL(url), signal).catch((x: unknown) => x);
	return e instanceof SourceUnavailable
		? { source: e.source, message: e.message }
		: e;
}

const TWO_DISKS = [
	...ALERTS,
	{
		fingerprint: "f2",
		labels: { alertname: "DiskFull", instance: "db-2", severity: "critical" },
		annotations: { summary: "Disk full on /data" },
		startsAt: "2026-11-06T10:05:00Z",
		status: { state: "active" },
	},
];

describe("a monitoring link resolved to its record (#1024)", () => {
	it("refuses a link whose alert name matches two alerts on the connection", async () => {
		const p = new MonitoringProvider("Alertmanager", {
			connections: async () => [{ id: "am-1", label: "prod" }],
			baseUrl: async () => "http://am.example.com/",
			open: async (src) => ({
				id: src.id,
				label: src.label,
				kind: "alertmanager",
				secrets: [],
				request: (async () =>
					new Response(JSON.stringify(TWO_DISKS), { status: 200 })) as unknown as OpenedSource["request"],
			}),
		});
		expect(
			await refusal(
				p,
				"http://am.example.com/#/alerts?filter=%7Balertname%3D%22DiskFull%22%7D",
			),
		).toEqual({
			source: "Alertmanager",
			message: "2 items match this link; it names no single one",
		});
	});

	describe("an alert link's other matchers", () => {
		const url = (filter: string) =>
			`http://am.example.com/#/alerts?filter=${encodeURIComponent(filter)}`;
		const p = () =>
			new MonitoringProvider("Alertmanager", {
				connections: async () => [{ id: "am-1", label: "prod" }],
				baseUrl: async () => "http://am.example.com/",
				open: async (src) => ({
					id: src.id,
					label: src.label,
					kind: "alertmanager",
					secrets: [],
					request: (async () =>
						new Response(JSON.stringify(TWO_DISKS), { status: 200 })) as unknown as OpenedSource["request"],
				}),
			});

		it("resolves the alert whose instance the link names", async () => {
			const hit = await p().resolveUrl(
				new URL(url('{alertname="DiskFull",instance="db-2"}')),
				signal,
			);
			expect(hit?.ref.id).toBe("am-1:f2");
		});

		it("refuses a link whose instance no alert has, even when the name matches", async () => {
			expect(await refusal(p(), url('{alertname="DiskFull",instance="db-3"}'))).toEqual({
				source: "Alertmanager",
				message: "nothing on it matches this link",
			});
		});

		it("reads an alert's own labels: exported_instance does not stand in for instance", async () => {
			const lookalike = new MonitoringProvider("Alertmanager", {
				connections: async () => [{ id: "am-1", label: "prod" }],
				baseUrl: async () => "http://am.example.com/",
				open: async (src) => ({
					id: src.id,
					label: src.label,
					kind: "alertmanager",
					secrets: [],
					request: (async () =>
						new Response(
							JSON.stringify([
								{
									fingerprint: "f9",
									labels: { alertname: "DiskFull", instance: "db-1", exported_instance: "db-2" },
									annotations: {},
									startsAt: "2026-11-06T10:00:00Z",
									status: { state: "active" },
								},
							]),
							{ status: 200 },
						)) as unknown as OpenedSource["request"],
				}),
			});
			expect(await refusal(lookalike, url('{alertname="DiskFull",instance="db-2"}'))).toEqual({
				source: "Alertmanager",
				message: "nothing on it matches this link",
			});
		});

		it("refuses a filter with a second alertname matcher, even a pattern one", async () => {
			expect(await refusal(p(), url('{alertname="DiskFull",alertname=~"Other"}'))).toEqual({
				source: "Alertmanager",
				message: "this link filters by a pattern, which cannot name a single alert",
			});
		});

		it("refuses a link that filters by a pattern", async () => {
			expect(await refusal(p(), url('{alertname="DiskFull",instance=~"db-.*"}'))).toEqual({
				source: "Alertmanager",
				message: "this link filters by a pattern, which cannot name a single alert",
			});
		});
	});

	it("reports the linked connection's own failure, not 'nothing matches', when another connection answers", async () => {
		const p = new MonitoringProvider("Alertmanager", {
			connections: async () => [
				{ id: "am-1", label: "prod" },
				{ id: "am-2", label: "stage" },
			],
			baseUrl: async (id) => (id === "am-1" ? "http://am.example.com/" : "http://stage.example.com/"),
			open: async (src) => ({
				id: src.id,
				label: src.label,
				kind: "alertmanager",
				secrets: [],
				request: (async () =>
					src.id === "am-1"
						? new Response("down", { status: 503 })
						: new Response(JSON.stringify(ALERTS), { status: 200 })) as unknown as OpenedSource["request"],
			}),
		});
		const got = await refusal(
			p,
			"http://am.example.com/#/alerts?filter=%7Balertname%3D%22DiskFull%22%7D",
		);
		expect(got).toMatchObject({ source: "Alertmanager" });
		expect((got as { message: string }).message).not.toBe("nothing on it matches this link");
	});

	it("answers null when the sources cannot name a connection's base URL", async () => {
		const p = am("http://am.example.com", false);
		expect(
			await p.resolveUrl(new URL("http://am.example.com/#/alerts"), signal),
		).toBeNull();
	});

	it("answers null for a connection whose saved base URL does not parse", async () => {
		const p = am("not a url");
		expect(
			await p.resolveUrl(new URL("http://am.example.com/#/alerts"), signal),
		).toBeNull();
	});

	it("answers null for a link outside the connection's path", async () => {
		const p = am("http://am.example.com/alertmanager");
		expect(
			await p.resolveUrl(new URL("http://am.example.com/other/#/alerts"), signal),
		).toBeNull();
	});

	it("refuses a link on the connection that names no single alert, silence or rule", async () => {
		expect(await refusal(am("http://am.example.com/"), "http://am.example.com/#/status")).toEqual({
			source: "Alertmanager",
			message: "this link names no single alert, silence or rule",
		});
	});

	it("refuses an alert link that nothing on the connection matches", async () => {
		expect(
			await refusal(
				am("http://am.example.com"),
				"http://am.example.com/#/alerts?filter=%7Balertname%3D%22DiskEmpty%22%7D",
			),
		).toEqual({
			source: "Alertmanager",
			message: "nothing on it matches this link",
		});
	});

	it("refuses a silence link whose silence the connection does not hold", async () => {
		expect(
			await refusal(am("http://am.example.com"), "http://am.example.com/#/silences/s-404"),
		).toEqual({
			source: "Alertmanager",
			message: "nothing on it matches this link",
		});
	});

	it("refuses a Prometheus page that names no rule", async () => {
		const p = new MonitoringProvider("Prometheus", {
			...sources("http://prom.example.com"),
		});
		expect(await refusal(p, "http://prom.example.com/graph?search=HighLatency")).toEqual({
			source: "Prometheus",
			message: "this link names no single alert, silence or rule",
		});
		expect(await refusal(p, "http://prom.example.com/alerts")).toEqual({
			source: "Prometheus",
			message: "this link names no single alert, silence or rule",
		});
	});
});
