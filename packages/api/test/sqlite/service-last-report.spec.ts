// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ServiceListResponse } from "@prismalens/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScenarioApp } from "../scenarios/support/scenario-app.js";

// Pins the GROUP BY on real SQLite: alerts at exact past times, which no
// product path writes, decide each service's last report on the Services list.
const pl = new ScenarioApp();
const HOUR_MS = 3_600_000;

beforeAll(async () => {
	await pl.boot();
}, 60_000);
afterAll(async () => {
	await pl.dispose();
});

async function alert(
	serviceId: string,
	key: string,
	triggeredAt: Date,
	lastOccurrence: Date,
) {
	const prisma = await pl.prisma();
	await prisma.alert.create({
		data: {
			dedupKey: key,
			title: key,
			serviceId,
			triggeredAt,
			lastOccurrence,
		},
	});
}

describe("Services list lastReportAt on SQLite", () => {
	it("Given alerts for two services and none for a third, When the list loads, Then each carries its newest occurrence and the quiet one null", async () => {
		const prisma = await pl.prisma();
		const [refired, steady] = await Promise.all(
			["lr-refired", "lr-steady", "lr-quiet"].map((name) =>
				prisma.service.create({ data: { name } }),
			),
		);
		const now = Date.now();
		const refiredAt = new Date(now - 2 * HOUR_MS);
		const steadyAt = new Date(now - 72 * HOUR_MS);
		// Triggered first but refired last: the newest report is its lastOccurrence, not the newest row.
		await alert(refired.id, "a-old-refired", new Date(now - 120 * HOUR_MS), refiredAt);
		await alert(refired.id, "a-newer-row", new Date(now - 24 * HOUR_MS), new Date(now - 24 * HOUR_MS));
		await alert(steady.id, "b-older", new Date(now - 96 * HOUR_MS), new Date(now - 96 * HOUR_MS));
		await alert(steady.id, "b-newest", steadyAt, steadyAt);

		const list = await pl.api<ServiceListResponse>("/services?limit=100");
		const lastReport = Object.fromEntries(
			list.data
				.filter((s) => s.name.startsWith("lr-"))
				.map((s) => [s.name, s.lastReportAt]),
		);

		expect(lastReport).toEqual({
			"lr-refired": refiredAt.toISOString(),
			"lr-steady": steadyAt.toISOString(),
			"lr-quiet": null,
		});
	});
});
