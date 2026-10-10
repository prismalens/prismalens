// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, test } from "@playwright/test";
import { investigateButton } from "./verb";

/**
 * #606 — after the report. Two affordances the journey trace found missing:
 * nothing ended an incident, and a report could not leave the page.
 *
 * Both are driven against the real API: the incident is authored by hand (the
 * same path `manual-authorship.spec.ts` uses), then resolved in one step. The
 * export button belongs to a completed report, which needs a harness, so the
 * spec asserts the half that is reachable without one: it is absent until a
 * report exists.
 */
test.describe("#606 — closing an incident and exporting its report", () => {
	test("resolves a hand-authored incident in one step", async ({ page }) => {
		const title = `Pool exhaustion ${Date.now()}`;

		await page.goto("/incidents");
		await page.getByTestId("create-incident-button").click({ timeout: 15_000 });

		const dialog = page.getByTestId("create-incident-dialog");
		await expect(dialog).toBeVisible();
		await dialog.getByTestId("create-incident-title").fill(title);
		await dialog.getByTestId("create-incident-submit").click();

		await expect(page).toHaveURL(/\/incidents\/[0-9a-f-]{36}$/, {
			timeout: 15_000,
		});
		await expect(page.getByTestId("crumb-incident")).toHaveText(title);

		// The header's action: Resolve
		const resolve = page.getByTestId("header-resolve");
		await expect(resolve).toBeVisible({ timeout: 15_000 });

		// #338's question rides on Resolve; both fields blank is allowed.
		await resolve.click();
		await page.getByTestId("confirm-resolve").click();
		await expect(resolve).toHaveCount(0, { timeout: 15_000 });
		await expect(page.getByTestId("header-reopen")).toBeVisible();

		// A resolved incident can still take a new run (#673, gate step 9): the
		// overview composer offers investigate, and its status stays resolved.
		await expect(await investigateButton(page)).toBeVisible();
		await expect(page.getByTestId("header-reopen")).toBeVisible();
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

		// Export as Markdown is in the header menu (header-more → header-export); absent without a report
		await page.getByTestId("header-more").click();
		await expect(page.getByTestId("header-export")).toHaveCount(0);
		await expect(page.getByTestId("export-report-markdown")).toHaveCount(0);
	});
});
