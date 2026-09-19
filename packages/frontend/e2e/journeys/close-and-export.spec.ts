// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, test } from "@playwright/test";

/**
 * #606 — after the report. Two affordances the journey trace found missing:
 * nothing closed an incident, and a report could not leave the page.
 *
 * Both are driven against the real API: the incident is authored by hand (the
 * same path `manual-authorship.spec.ts` uses), resolved, then closed. The
 * export button belongs to a completed report, which needs a harness, so the
 * spec asserts the half that is reachable without one: it is absent until a
 * report exists.
 */
test.describe("#606 — closing an incident and exporting its report", () => {
	test("resolves, then closes, a hand-authored incident", async ({ page }) => {
		const title = `Pool exhaustion ${Date.now()}`;

		await page.goto("/incidents");
		await expect(page.getByRole("heading", { name: "Incidents" })).toBeVisible({
			timeout: 15_000,
		});
		await page.getByTestId("create-incident-button").click();

		const dialog = page.getByTestId("create-incident-dialog");
		await expect(dialog).toBeVisible();
		await dialog.getByTestId("create-incident-title").fill(title);
		await dialog.getByTestId("create-incident-submit").click();

		await expect(page).toHaveURL(/\/incidents\/[0-9a-f-]{36}$/, {
			timeout: 15_000,
		});
		await expect(page.getByRole("heading", { name: title })).toBeVisible({
			timeout: 15_000,
		});

		// Close belongs to a resolved incident: it is the step after the
		// postmortem, so it is not offered while the incident is still open.
		const close = page.getByRole("button", { name: "Close", exact: true });
		await expect(close).toHaveCount(0);

		await page.getByRole("button", { name: "Resolve" }).click();
		await expect(close).toBeVisible({ timeout: 15_000 });

		await close.click();
		await expect(page.getByRole("button", { name: "Resolve" })).toHaveCount(0, {
			timeout: 15_000,
		});
		await expect(close).toHaveCount(0);
	});

	test("offers no Markdown export while the incident has no report", async ({
		page,
	}) => {
		const title = `No report yet ${Date.now()}`;

		await page.goto("/incidents");
		await page.getByTestId("create-incident-button").click();
		const dialog = page.getByTestId("create-incident-dialog");
		await dialog.getByTestId("create-incident-title").fill(title);
		await dialog.getByTestId("create-incident-submit").click();
		await expect(page).toHaveURL(/\/incidents\/[0-9a-f-]{36}$/, {
			timeout: 15_000,
		});

		await page.getByRole("tab", { name: "Investigation" }).click();
		await expect(page.getByTestId("export-report-markdown")).toHaveCount(0);
	});
});
