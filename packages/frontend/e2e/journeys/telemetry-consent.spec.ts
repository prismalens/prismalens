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
		// The strip at the bottom of the sidebar carries a one-line summary of
		// what it is and what it never carries (#523 moved the question off the
		// page and onto the sidebar); the full disclosure lives in Settings,
		// asserted below.
		await expect(consent).toContainText("Share usage counts");
		await expect(consent).toContainText(
			"Never an alert, a repo or a report",
		);

		await consent.getByRole("button", { name: "Share", exact: true }).click();

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
		await expect(page.getByTestId("incident-list-pane").getByRole("heading", { name: "Incidents", exact: true })).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.getByTestId("telemetry-consent")).toHaveCount(0);

		await serveTelemetry(page, {
			enabled: false,
			decided: false,
			forcedOff: true,
		});
		await page.reload();
		await expect(page.getByTestId("incident-list-pane").getByRole("heading", { name: "Incidents", exact: true })).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.getByTestId("telemetry-consent")).toHaveCount(0);
	});

	test("Settings → Usage data carries the full disclosure and the toggle", async ({
		page,
	}) => {
		await serveTelemetry(page, {
			enabled: false,
			decided: true,
			forcedOff: false,
		});

		await page.goto("/settings?tab=usage");
		const checkbox = page.getByLabel("Share usage data");
		await expect(checkbox).toBeVisible({ timeout: 15_000 });
		// Each thing the disclosure has to name (#602): what is sent, that the
		// id is stable and pseudonymous, the basis, the retention, the withdrawal.
		// Exact, because "what is sent" also appears inside the "Never sent"
		// paragraph and a substring match would resolve to both.
		await expect(
			page.getByText("What is sent", { exact: true }),
		).toBeVisible();
		await expect(
			page.getByText("The install id, and your consent", { exact: true }),
		).toBeVisible();
		await expect(page.getByText("An install id:")).toBeVisible();
		await expect(page.getByText("Never sent:")).toBeVisible();
		await expect(
			page.getByText("pseudonymous rather than anonymous"),
		).toBeVisible();
		await expect(page.getByText("is the only basis")).toBeVisible();
		await expect(
			page.getByText("kept for as long as PostHog's plan retains them"),
		).toBeVisible();
		await expect(page.getByText("withdraws consent")).toBeVisible();
		await expect(checkbox).not.toBeChecked();
	});
});
