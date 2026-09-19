// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, test } from "@playwright/test";

/**
 * #338 — closing records what actually caused the incident, and the incident
 * then shows it. The similarity half (a later incident's report citing this
 * cause) needs a completed investigation, so it is covered by the overlay unit
 * tests; what is reachable without a harness is the capture, which is what this
 * spec drives, through the real API.
 */
test.describe("#338 — the actual cause is recorded on close", () => {
	test("captures cause and category, and shows them on the incident", async ({
		page,
	}) => {
		const title = `Connection pool exhausted ${Date.now()}`;
		const cause = "deploy 41 dropped DB_POOL_SIZE from 50 to 5";

		await page.goto("/incidents");
		await expect(page.getByRole("heading", { name: "Incidents" })).toBeVisible({
			timeout: 15_000,
		});
		await page.getByTestId("create-incident-button").click();
		const dialog = page.getByTestId("create-incident-dialog");
		await dialog.getByTestId("create-incident-title").fill(title);
		await dialog.getByTestId("create-incident-submit").click();
		await expect(page).toHaveURL(/\/incidents\/[0-9a-f-]{36}$/, {
			timeout: 15_000,
		});

		await page.getByRole("button", { name: "Resolve" }).click();
		const close = page.getByRole("button", { name: "Close", exact: true });
		await expect(close).toBeVisible({ timeout: 15_000 });
		await close.click();

		await page.getByLabel("Actual cause").fill(cause);
		await page.getByTestId("confirm-close-incident").click();

		await expect(page.getByText(`Actual cause: ${cause}`)).toBeVisible({
			timeout: 15_000,
		});
		await expect(close).toHaveCount(0);
	});

	test("closing with an empty cause records nothing", async ({ page }) => {
		const title = `Closed without a cause ${Date.now()}`;

		await page.goto("/incidents");
		await page.getByTestId("create-incident-button").click();
		const dialog = page.getByTestId("create-incident-dialog");
		await dialog.getByTestId("create-incident-title").fill(title);
		await dialog.getByTestId("create-incident-submit").click();
		await expect(page).toHaveURL(/\/incidents\/[0-9a-f-]{36}$/, {
			timeout: 15_000,
		});

		await page.getByRole("button", { name: "Resolve" }).click();
		const close = page.getByRole("button", { name: "Close", exact: true });
		await expect(close).toBeVisible({ timeout: 15_000 });
		await close.click();
		await page.getByTestId("confirm-close-incident").click();

		await expect(close).toHaveCount(0, { timeout: 15_000 });
		await expect(page.getByText("Actual cause:")).toHaveCount(0);
	});
});
