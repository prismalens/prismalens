// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScenarioApp } from "./support/scenario-app.js";

const pl = new ScenarioApp();

beforeAll(async () => {
	await pl.boot();
}, 60_000);
afterAll(async () => {
	await pl.dispose();
});

const iso = (ms: number) => new Date(ms).toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// The auto-trigger hears of a correlated alert through an event, after the response.
const RUN_DISPATCH_MS = 2_000;

/** One Alertmanager v4 delivery of one alert, shaped as the release walk sends it. */
async function deliver(
	status: "firing" | "resolved",
	fingerprint: string,
	alertname: string,
	startsAt: string,
): Promise<{ received: number; processed: number }> {
	const alert = {
		status,
		fingerprint,
		startsAt,
		...(status === "resolved" && { endsAt: iso(Date.now()) }),
		labels: { alertname, severity: "warning", service: "walk-worker" },
		annotations: { summary: `${alertname} on walk-worker` },
	};
	const res = await fetch(pl.webhookUrl, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			origin: pl.url,
			authorization: `Bearer ${pl.webhookToken}`,
		},
		body: JSON.stringify({ status, alerts: [alert] }),
	});
	expect(res.status).toBe(200);
	return (await res.json()) as { received: number; processed: number };
}

async function openIncidentsFor(fingerprint: string) {
	return (await pl.incidentFor(fingerprint)).filter(
		(i) => i.status !== "resolved" && i.status !== "closed",
	);
}

describe("Walk F1: a resolution that arrives before its firing", () => {
	it("Given a resolved delivery for an alert never seen firing, When its firing arrives late, Then no incident stays open and no run starts", async () => {
		const fp = `rf-${Date.now()}`;
		// The walk computes startsAt per delivery, so the late firing's startsAt
		// is a few seconds after the resolution's: both precede its endsAt.
		const resolved = await deliver(
			"resolved",
			fp,
			"WalkResolvedFirst",
			iso(Date.now() - 60_000),
		);
		expect(resolved).toMatchObject({ received: 1, processed: 0 });

		await sleep(1_100);
		await deliver("firing", fp, "WalkResolvedFirst", iso(Date.now() - 60_000));
		await sleep(RUN_DISPATCH_MS);

		expect(await openIncidentsFor(fp)).toEqual([]);
		const [incident, ...more] = await pl.incidentFor(fp);
		expect(more).toEqual([]);
		expect(incident.alerts?.map((a) => a.status)).toEqual(["resolved"]);
		expect(await pl.investigations(incident.id)).toEqual([]);
	}, 30_000);

	it("Given an early resolution, When PrismaLens restarts before the firing arrives, Then the resolution is still remembered", async () => {
		const fp = `rf-restart-${Date.now()}`;
		const startsAt = iso(Date.now() - 60_000);
		await deliver("resolved", fp, "WalkResolvedFirstRestart", startsAt);

		await pl.stop();
		await pl.boot();
		await deliver("firing", fp, "WalkResolvedFirstRestart", startsAt);

		expect(await openIncidentsFor(fp)).toEqual([]);
	}, 60_000);

	it("Given an early resolution, When a firing that began after it ended arrives, Then that new episode opens an incident", async () => {
		const fp = `rf-new-${Date.now()}`;
		await deliver("resolved", fp, "WalkResolvedThenNew", iso(Date.now() - 60_000));

		await sleep(1_100);
		await deliver("firing", fp, "WalkResolvedThenNew", iso(Date.now()));

		expect(await openIncidentsFor(fp)).toHaveLength(1);
	}, 30_000);

	it("Given a resolved episode, When the next episode's resolution arrives before its firing, Then the late firing does not reopen the incident", async () => {
		const fp = `rf-flap-${Date.now()}`;
		const name = "WalkFlapResolvedFirst";
		const first = iso(Date.now() - 120_000);
		await deliver("firing", fp, name, first);
		await deliver("resolved", fp, name, first);
		const [incident] = await pl.incidentFor(fp);
		expect(incident.status).toBe("resolved");
		await sleep(RUN_DISPATCH_MS);
		const runs = (await pl.investigations(incident.id)).length;

		await sleep(1_100);
		const second = iso(Date.now());
		await deliver("resolved", fp, name, second);
		await deliver("firing", fp, name, second);
		await sleep(RUN_DISPATCH_MS);

		expect(await openIncidentsFor(fp)).toEqual([]);
		expect(await pl.investigations(incident.id)).toHaveLength(runs);
	}, 30_000);
});
