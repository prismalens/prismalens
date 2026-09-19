// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page, test } from "@playwright/test";

/**
 * #602 — the telemetry question is asked once, on /incidents, and nothing is
 * sent until it is answered.
 *
 * The state lives in one settings row shared by the whole suite, so both the
 * undecided and decided cases are served through a route double; the component,
 * the mutation and the contract boundary are real. The PUT is captured rather
 * than stubbed blind, so the spec proves what the buttons actually send.
 */
async function serveTelemetry(
	page: Page,
	state: { enabled: boolean; decided: boolean; forcedOff: boolean },
): Promise<{ puts: Array<{ enabled: boolean }> }> {
	const puts: Array<{ enabled: boolean }> = [];
	await page.route("**/api/settings/telemetry", async (route) => {
		if (route.request().method() === "PUT") {
			const body = route.request().postDataJSON() as { enabled: boolean };
			puts.push(body);
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({ ...state, ...body, decided: true }),
			});
			return;
		}
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(state),
		});
	});
	return { puts };
}

test.describe("#602 — opt-in telemetry", () => {
	test("asks once on /incidents, and an answer both sends and dismisses", async ({
		page,
	}) => {
		const { puts } = await serveTelemetry(page, {
			enabled: false,
			decided: false,
			forcedOff: false,
		});

		await page.goto("/incidents");
		const consent = page.getByTestId("telemetry-consent");
		await expect(consent).toBeVisible({ timeout: 15_000 });
		// It says what it sends, and what it does not.
		await expect(consent).toContainText("random install id");
		await expect(consent).toContainText("No alert text");

		await consent.getByRole("button", { name: "Share usage data" }).click();

		await expect(consent).toHaveCount(0, { timeout: 15_000 });
		expect(puts).toEqual([{ enabled: true }]);
	});

	test("declining sends enabled:false and is remembered", async ({ page }) => {
		const { puts } = await serveTelemetry(page, {
			enabled: false,
			decided: false,
			forcedOff: false,
		});

		await page.goto("/incidents");
		const consent = page.getByTestId("telemetry-consent");
		await expect(consent).toBeVisible({ timeout: 15_000 });
		await consent.getByRole("button", { name: "No thanks" }).click();

		await expect(consent).toHaveCount(0, { timeout: 15_000 });
		expect(puts).toEqual([{ enabled: false }]);
	});

	test("never asks once answered, or when the env forces it off", async ({
		page,
	}) => {
		await serveTelemetry(page, {
			enabled: true,
			decided: true,
			forcedOff: false,
		});
		await page.goto("/incidents");
		await expect(page.getByRole("heading", { name: "Incidents" })).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.getByTestId("telemetry-consent")).toHaveCount(0);

		await serveTelemetry(page, {
			enabled: false,
			decided: false,
			forcedOff: true,
		});
		await page.reload();
		await expect(page.getByRole("heading", { name: "Incidents" })).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.getByTestId("telemetry-consent")).toHaveCount(0);
	});

	test("Settings → Usage data carries the same disclosure and the toggle", async ({
		page,
	}) => {
		await serveTelemetry(page, {
			enabled: false,
			decided: true,
			forcedOff: false,
		});

		await page.goto("/settings?tab=usage");
		const checkbox = page.getByLabel("Share anonymous usage data");
		await expect(checkbox).toBeVisible({ timeout: 15_000 });
		await expect(page.getByText("random install id")).toBeVisible();
		await expect(checkbox).not.toBeChecked();
	});
});
