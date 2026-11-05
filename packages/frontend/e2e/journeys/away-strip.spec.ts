// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect } from "@playwright/test";
import { test } from "../steps/fixtures";
import { fireIncident, openBoard, QUIET } from "../steps/product";

test("the board says what arrived while you were away, and links to it (#1020)", async ({
	page,
	alertmanager,
	deliverWebhook,
	unique,
}) => {
	// A visit a minute ago; nothing is stored on the server for this yet.
	await page.addInitScript(() => {
		if (!sessionStorage.getItem("seeded")) {
			localStorage.setItem("pl.home.seenAt", String(Date.now() - 60_000));
			sessionStorage.setItem("seeded", "1");
		}
	});
	const made = await fireIncident(page, alertmanager, deliverWebhook, {
		name: unique("AwayArrival"),
		service: QUIET,
		severity: "warning",
		quiet: true,
	});
	await openBoard(page);
	const strip = page.getByTestId("away-strip");
	await expect(strip).toBeVisible();
	await expect(strip).toContainText(/^Since \S/);
	await expect(strip.getByTestId("away-arrived")).toContainText(/arrived/);
	// Seen now: a reload with nothing new shows no strip.
	await page.reload();
	await expect(page.getByTestId("inbox")).toBeVisible();
	await expect(page.getByTestId("away-strip")).toHaveCount(0);
	expect(made.id).toBeTruthy();
});
