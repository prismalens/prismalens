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
		await expect(
			page
				.getByTestId("incident-state-band")
				.getByRole("heading", { name: title }),
		).toBeVisible({
			timeout: 15_000,
		});

		// The band's one action follows the status: Acknowledge, then Resolve
		// (R1a d7). Nothing reads "Close" any more.
		const resolve = page.getByTestId("band-resolve");
		await expect(resolve).toHaveCount(0);
		await page.getByTestId("band-acknowledge").click();
		await expect(resolve).toBeVisible({ timeout: 15_000 });

		// #338's question rides on Resolve; both fields blank is allowed.
		await resolve.click();
		await page.getByTestId("confirm-resolve").click();
		await expect(resolve).toHaveCount(0, { timeout: 15_000 });
		await expect(page.getByTestId("band-status")).toHaveText("Resolved");
		await expect(page.getByTestId("band-reopen")).toBeVisible();
		// A resolved incident can still take a new run (#673, gate step 9): the
		// band's menu opens the draft, and its status stays Resolved.
		await page.getByTestId("band-more").click();
		await page.getByTestId("band-menu-new-run").click();
		await expect(await investigateButton(page)).toBeVisible();
		await expect(page.getByTestId("band-status")).toHaveText("Resolved");
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

		await expect(page.getByTestId("export-report-markdown")).toHaveCount(0);
	});
});
