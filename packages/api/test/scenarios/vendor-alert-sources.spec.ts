// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as azure from "../../src/modules/webhooks/alert-sources/fixtures/azure-monitor.js";
import * as cloudwatch from "../../src/modules/webhooks/alert-sources/fixtures/cloudwatch.js";
import * as datadog from "../../src/modules/webhooks/alert-sources/fixtures/datadog.js";
import * as grafana from "../../src/modules/webhooks/alert-sources/fixtures/grafana.js";
import * as newrelic from "../../src/modules/webhooks/alert-sources/fixtures/newrelic.js";
import * as pagerduty from "../../src/modules/webhooks/alert-sources/fixtures/pagerduty.js";
import * as sentry from "../../src/modules/webhooks/alert-sources/fixtures/sentry.js";
import { eventually, ScenarioApp } from "./support/scenario-app.js";

const pl = new ScenarioApp();

beforeAll(async () => {
	await pl.boot();
	await pl.api("/services", { method: "POST", body: { name: "checkout" } });
}, 60_000);
afterAll(async () => {
	await pl.dispose();
});

interface Detail {
	id: string;
	title: string;
	status: string;
	severity: string;
	serviceId: string | null;
	alerts?: Array<{ externalId: string | null; occurrenceCount?: number }>;
}

const bearer = () => ({ authorization: `Bearer ${pl.webhookToken}` });

async function deliver(
	route: string,
	body: unknown,
	headers: Record<string, string> = bearer(),
	contentType = "application/json",
) {
	return fetch(`${pl.url}/api/webhooks/${route}`, {
		method: "POST",
		headers: { "content-type": contentType, ...headers },
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
}

const incidentsFrom = async (source: string): Promise<Detail[]> => {
	const { data } = await pl.api<{ data: Detail[] }>("/incidents?limit=100");
	return data.filter((i) =>
		(i.alerts ?? []).some((a) => a.externalId?.startsWith(`${source}:`)),
	);
};

interface Case {
	source: string;
	route: string;
	firing: unknown;
	resolved: unknown;
	title: string;
	severity: string;
	/** Wire form: SNS posts its JSON as text/plain. */
	contentType?: string;
	mapsService: boolean;
}

const cases: Case[] = [
	{ source: "grafana", route: "grafana", firing: grafana.firing, resolved: grafana.resolved, title: "High memory usage", severity: "critical", mapsService: true },
	{ source: "datadog", route: "datadog", firing: datadog.firing, resolved: datadog.resolved, title: "CPU high on web-1", severity: "high", mapsService: true },
	{ source: "sentry", route: "sentry", firing: sentry.issueAlert, resolved: sentry.issueResolved, title: "ReferenceError: heck is not defined", severity: "high", mapsService: true },
	{ source: "pagerduty", route: "pagerduty", firing: pagerduty.triggered, resolved: pagerduty.resolved, title: "A little bump in the road", severity: "critical", mapsService: false },
	{ source: "cloudwatch", route: "cloudwatch", firing: cloudwatch.firing, resolved: cloudwatch.resolved, title: "checkout-5xx-rate", severity: "high", contentType: "text/plain; charset=UTF-8", mapsService: true },
	{ source: "azure-monitor", route: "azure-monitor", firing: azure.firing, resolved: azure.resolved, title: "WCUS-R2-Gen2", severity: "high", mapsService: true },
	{ source: "newrelic", route: "newrelic", firing: newrelic.firing, resolved: newrelic.resolved, title: "High error rate on checkout", severity: "critical", mapsService: true },
];

describe.each(cases)("$source intake (#79)", (c) => {
	it("Given a firing payload, Then one incident opens with the vendor's title, severity and service", async () => {
		const res = await deliver(c.route, c.firing, bearer(), c.contentType);
		expect(res.status).toBeLessThan(300);
		const [incident] = await eventually(
			() => incidentsFrom(c.source),
			(f) => f.length === 1,
			`a ${c.source} incident`,
		);
		expect(incident.title).toContain(c.title);
		expect(incident.severity).toBe(c.severity);
		if (c.mapsService) expect(incident.serviceId).not.toBeNull();
	});

	it("When the same alert repeats, Then it folds into the same incident", async () => {
		const [before] = await incidentsFrom(c.source);
		const res = await deliver(c.route, c.firing, bearer(), c.contentType);
		expect(res.status).toBeLessThan(300);
		const after = await incidentsFrom(c.source);
		expect(after.map((i) => i.id)).toEqual([before.id]);
	});

	it("When the vendor resolves it, Then the incident resolves", async () => {
		const res = await deliver(c.route, c.resolved, bearer(), c.contentType);
		expect(res.status).toBeLessThan(300);
		const [incident] = await eventually(
			() => incidentsFrom(c.source),
			(f) => f[0]?.status === "resolved",
			`the ${c.source} incident to resolve`,
		);
		expect(incident.status).toBe("resolved");
	});
});

describe("credentials", () => {
	it("refuses a delivery with no credential and one with a wrong token", async () => {
		expect((await deliver("grafana", grafana.firing, {})).status).toBe(401);
		expect(
			(
				await deliver("datadog", datadog.firing, {
					authorization: "Bearer not-the-secret-not-the-secret",
				})
			).status,
		).toBe(403);
	});

	it("takes the Azure token as ?token= because an action group cannot set a header", async () => {
		const url = `${pl.url}/api/webhooks/azure-monitor`;
		const body = JSON.stringify(azure.resolved);
		const post = (query: string) =>
			fetch(`${url}${query}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body,
			});
		expect((await post("")).status).toBe(401);
		expect((await post("?token=wrong")).status).toBe(401);
		expect(
			(await post(`?token=${encodeURIComponent(pl.webhookToken)}`)).status,
		).toBeLessThan(300);
	});

	it("refuses a Sentry or PagerDuty signature when no secret is configured for it", async () => {
		const body = JSON.stringify(sentry.issueAlert);
		const signature = createHmac("sha256", "x".repeat(32))
			.update(body)
			.digest("hex");
		const res = await deliver("sentry", body, {
			"sentry-hook-signature": signature,
		});
		expect([401, 403]).toContain(res.status);
	});
});

describe("SNS subscription handshake", () => {
	it("answers a SubscriptionConfirmation without opening an incident, and does not fetch a non-SNS URL", async () => {
		const forged = {
			...cloudwatch.subscriptionConfirmation,
			SubscribeURL: "http://127.0.0.1:1/?Action=ConfirmSubscription",
		};
		const res = await deliver(
			"cloudwatch",
			forged,
			bearer(),
			"text/plain; charset=UTF-8",
		);
		expect(res.status).toBeLessThan(300);
		const body = (await res.json()) as { confirmed: boolean; received: number };
		expect(body).toMatchObject({ confirmed: false, received: 0 });
	});
});
