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

describe("a monitoring link resolved to its record (#1024)", () => {
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
